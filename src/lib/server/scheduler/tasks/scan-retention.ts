/**
 * Scan retention.
 *
 * Every vulnerability scan stores its whole findings document, and scans are
 * append-only, so a host that scans nightly accumulates gigabytes of results
 * that nothing reads. This keeps the current state of each image plus enough
 * history for the scan export, and drops what belongs to images the host no
 * longer has.
 *
 * The image list comes from the live daemons, so an environment that does not
 * answer contributes nothing and its scans are left untouched.
 */

import type { ScheduleTrigger } from '../../db';
import {
	listScanRecords,
	deleteScans,
	getEnvironments,
	createScheduleExecution,
	updateScheduleExecution,
	appendScheduleExecutionLog,
	getScanRetentionEnabled,
	getScanRetentionKeep,
	getScanRetentionGraceDays
} from '../../db';
import { listImages, DockerConnectionError, EnvironmentNotFoundError } from '../../docker';
import { answerIsUsable, planRetention } from '../../scan-retention-core';
import { invalidateVulnerabilitiesCache } from '../../vulnerabilities-cache';

export const SYSTEM_SCAN_RETENTION_ID = 5;

/**
 * Which environments gave a usable answer, and every image they hold.
 *
 * An environment counts only when it returned at least one image. A daemon can
 * answer with an empty list for reasons that have nothing to do with the scans -
 * a fresh store, a prune, a host still starting - and treating that as "none of
 * these images exist" would delete the environment's entire scan history on the
 * strength of a reply that says nothing.
 */
async function collectLiveImages(): Promise<{
	liveImageIds: Set<string>;
	reachableEnvIds: Set<number | null>;
	skipped: string[];
}> {
	const liveImageIds = new Set<string>();
	const reachableEnvIds = new Set<number | null>();
	const skipped: string[] = [];

	const environments = await getEnvironments();
	for (const env of environments) {
		try {
			const images = await listImages(env.id);
			if (!answerIsUsable(images)) {
				skipped.push(`${env.name} (未返回镜像列表)`);
				continue;
			}
			for (const image of images) liveImageIds.add(image.id);
			reachableEnvIds.add(env.id);
		} catch (error: unknown) {
			skipped.push(`${env.name} (无响应)`);
			if (!(error instanceof DockerConnectionError) && !(error instanceof EnvironmentNotFoundError)) {
				console.error(`[漏洞扫描保留策略] 获取 ${env.name} 的镜像列表时出错:`, error);
			}
		}
	}

	return { liveImageIds, reachableEnvIds, skipped };
}

export async function runScanRetentionJob(triggeredBy: ScheduleTrigger = 'cron'): Promise<void> {
	if (triggeredBy === 'cron' && !(await getScanRetentionEnabled())) return;

	const startTime = Date.now();
	const execution = await createScheduleExecution({
		scheduleType: 'system_cleanup',
		scheduleId: SYSTEM_SCAN_RETENTION_ID,
		environmentId: null,
		entityName: '漏洞扫描结果保留策略',
		triggeredBy,
		status: 'running'
	});

	await updateScheduleExecution(execution.id, { startedAt: new Date().toISOString() });

	const log = async (message: string) => {
		console.log(`[漏洞扫描保留策略] ${message}`);
		await appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${message}`);
	};

	try {
		const [keepPerImage, graceDays] = await Promise.all([
			getScanRetentionKeep(),
			getScanRetentionGraceDays()
		]);

		const { liveImageIds, reachableEnvIds, skipped } = await collectLiveImages();
		if (skipped.length > 0) {
			await log(`保留以下环境的扫描记录不作清理: ${skipped.join(', ')}`);
		}

		const scans = await listScanRecords();
		const plan = planRetention(scans, liveImageIds, reachableEnvIds, new Date(), {
			keepPerImage,
			graceDays
		});

		await log(
			`共 ${scans.length} 条扫描记录，每个镜像与扫描器保留 ${keepPerImage} 条记录，` +
			`已移除镜像设置 ${graceDays} 天宽限期`
		);

		if (plan.deleteIds.length === 0) {
			await log('无需删除任何记录');
		} else {
			await deleteScans(plan.deleteIds);
			// The dashboard caches findings; a delete makes that stale.
			invalidateVulnerabilitiesCache();
			await log(
				`已清理 ${plan.deleteIds.length} 条扫描记录：其中 ${plan.supersededCount} 条为被新记录取代，` +
				`${plan.goneImageCount} 条对应已消失的镜像`
			);
		}

		await updateScheduleExecution(execution.id, {
			status: 'success',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			details: {
				deletedCount: plan.deleteIds.length,
				superseded: plan.supersededCount,
				goneImages: plan.goneImageCount,
				keepPerImage,
				graceDays
			}
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		await log(`错误: ${message}`);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: message
		});
	}
}
