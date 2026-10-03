/**
 * Vulnerability block decision with a fresh current-image scan.
 *
 * Kept separate from update-utils.ts so that the pure decision logic
 * (shouldBlockUpdate, combineScanSummaries) stays free of DB/scanner runtime
 * deps and remains unit-testable. This module is allowed to touch the DB and
 * the scanner.
 */

import type { VulnerabilityCriteria } from '../../db';
import { type VulnerabilitySeverity, scanImage } from '../../scanner';
import { getCombinedScanForImage, saveVulnerabilityScan } from '../../db';
import { shouldBlockUpdate, combineScanSummaries } from './update-utils';

/**
 * Resolve the block decision for a new image, handling the 'more_than_current'
 * criteria robustly.
 *
 * For 'more_than_current' the new image's vuln count is compared against the
 * CURRENT image's count. The current count comes from the scan cache, which can
 * be (a) stale — vuln DBs grow, so an old cached scan understates the current
 * image and falsely makes the new image look worse (#1022), or (b) missing — no
 * scan exists, so the comparison is skipped and a genuinely more-vulnerable
 * update slips through. Both are fixed here: when the cached comparison would
 * block (or there is no cache), the current image is RE-SCANNED fresh and the
 * comparison is redone against up-to-date numbers.
 *
 * For all other criteria this is a thin wrapper around shouldBlockUpdate.
 *
 * @param newSummary      combined scan summary of the new image
 * @param currentImageId  sha256 image id of the currently-running image
 * @param envId           environment id (for scanner settings + cache scoping)
 * @param criteria        the configured vulnerability criteria
 * @param log             log sink for human-readable progress
 */
export async function resolveBlockDecision(
	newSummary: VulnerabilitySeverity,
	currentImageId: string,
	envId: number | null | undefined,
	criteria: VulnerabilityCriteria,
	log: (msg: string) => void
): Promise<{ blocked: boolean; reason: string }> {
	if (criteria !== 'more_than_current') {
		return shouldBlockUpdate(criteria, newSummary);
	}

	const total = (s: VulnerabilitySeverity) => s.critical + s.high + s.medium + s.low;
	const newTotal = total(newSummary);

	// 1. Start from the cached scan of the current image, if any.
	let currentSummary: VulnerabilitySeverity | undefined;
	let currentFromCache = false;
	try {
		const cached = await getCombinedScanForImage(currentImageId, envId ?? null);
		if (cached) {
			currentSummary = cached;
			currentFromCache = true;
			log(`more_than_current: 当前镜像缓存扫描 = ${total(cached)} 个漏洞 (${cached.critical}C/${cached.high}H/${cached.medium}M/${cached.low}L)`);
		} else {
			log(`more_than_current: 当前镜像没有缓存扫描`);
		}
	} catch (err: any) {
		log(`more_than_current: 缓存查询失败 (${err.message})`);
	}

	const wouldBlock = currentSummary !== undefined && newTotal > total(currentSummary);

	// 2. Re-scan the current image when the cached comparison would block, or
	//    when there is no cached scan at all. A fresh scan of the SAME current
	//    image is the only trustworthy basis for blocking (#1022).
	if (!currentFromCache || wouldBlock) {
		log(
			currentFromCache
				? `more_than_current: 缓存比较结果将阻断 (新镜像 ${newTotal} > 当前 ${total(currentSummary!)}) — 重新扫描当前镜像以确认`
				: `more_than_current: 扫描当前镜像 (${currentImageId.substring(0, 19)}) 用于比较`
		);
		try {
			const results = await scanImage(currentImageId, envId ?? undefined, (p) => {
				if (p.message) log(`  [${p.scanner || 'scan'}] ${p.message}`);
			});
			if (results.length > 0) {
				const fresh = combineScanSummaries(results.map((r) => ({ summary: r.summary })));
				log(`more_than_current: 当前镜像全新扫描 = ${total(fresh)} 个漏洞 (${fresh.critical}C/${fresh.high}H/${fresh.medium}M/${fresh.low}L)`);
				currentSummary = fresh;
				// Persist so the next cycle starts from a current value.
				for (const r of results) {
					try {
						await saveVulnerabilityScan({
							environmentId: envId ?? null,
							imageId: currentImageId,
							imageName: r.imageName,
							scanner: r.scanner,
							scannedAt: r.scannedAt,
							scanDuration: r.scanDuration,
							criticalCount: r.summary.critical,
							highCount: r.summary.high,
							mediumCount: r.summary.medium,
							lowCount: r.summary.low,
							negligibleCount: r.summary.negligible,
							unknownCount: r.summary.unknown,
							vulnerabilities: r.vulnerabilities,
							error: r.error ?? null
						});
					} catch { /* ignore save errors */ }
				}
			} else {
				log(`more_than_current: 当前镜像扫描未返回结果`);
			}
		} catch (err: any) {
			log(`more_than_current: 当前镜像扫描失败 (${err.message})`);
		}
	}

	const decision = shouldBlockUpdate('more_than_current', newSummary, currentSummary);
	const curTotal = currentSummary ? total(currentSummary) : 'unknown';
	log(
		decision.blocked
			? `more_than_current: 已阻断 — 新镜像 ${newTotal} > 当前 ${curTotal}`
			: `more_than_current: 已放行 — 新镜像 ${newTotal} <= 当前 ${curTotal}${currentSummary === undefined ? ' (当前数量不可用；不阻断)' : ''}`
	);
	return decision;
}
