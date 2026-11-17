/**
 * The environment report: what is deployed, how exposed it is, and - for the
 * tier entitled to it - who changed it.
 *
 * Pure, so the shape of a report is a unit test rather than something only a
 * live export reveals. The caller gathers the data; this decides what a report
 * contains and how it renders.
 */

import { rowsToCSV } from './csv';
import { getLabelText } from '$lib/types';	

export type ReportTier = 'smb' | 'enterprise';

export interface ReportContainer {
	name: string;
	image: string;
	status: string;
	stack: string | null;
	updateAvailable?: boolean;
}

export interface ReportImageScan {
	image: string;
	critical: number;
	high: number;
	medium: number;
	low: number;
	scannedAt: string | null;
}

export interface ReportChange {
	at: string;
	username: string;
	action: string;
	entityType: string;
	entityName: string;
}

export interface ReportEnvironment {
	id: number | null;
	name: string;
	containers: ReportContainer[];
	stacks: string[];
	scans: ReportImageScan[];
	/**
	 * Set when the environment could not be read. Its empty lists then mean "not
	 * known", not "nothing deployed" - the difference a compliance reader needs.
	 */
	unreachable?: boolean;
	unreachableReason?: string;
	/** Omitted below the enterprise tier - see includeChanges. */
	changes?: ReportChange[];
}

export interface EnvironmentReport {
	generatedAt: string;
	appVersion: string;
	environments: ReportEnvironment[];
	totals: ReportTotals;
	includesChanges: boolean;
}

export interface ReportTotals {
	environments: number;
	containers: number;
	stacks: number;
	scannedImages: number;
	critical: number;
	high: number;
	medium: number;
	low: number;
	unscannedImages: number;
	/**
	 * Environments that could not be read. Their zeroes are absences, not clean
	 * results, so a reader can tell "no findings" from "no answer".
	 */
	unreachableEnvironments: number;
}

/**
 * Whether the report carries the change history. Enterprise only: the audit log
 * is an enterprise feature, and an export must not hand the same data to a tier
 * that cannot open the audit page.
 */
/**
 * The report tier a licence grants, or null when none does.
 *
 * Both the download route and the scheduler have to answer this, from different
 * sources (the caller's licence vs the installation's), so the mapping lives here
 * rather than being spelled out twice.
 */
export function reportTier(licenseType: string | null | undefined): ReportTier | null {
	if (licenseType === 'enterprise') return 'enterprise';
	if (licenseType === 'smb') return 'smb';
	return null;
}

export function includeChanges(tier: ReportTier): boolean {
	return tier === 'enterprise';
}

/** The images a container list refers to, deduplicated, in first-seen order. */
export function imagesInUse(containers: ReportContainer[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const c of containers) {
		if (c.image && !seen.has(c.image)) {
			seen.add(c.image);
			out.push(c.image);
		}
	}
	return out;
}

/** Images running here that no scan covers - the gap a reviewer asks about first. */
export function unscannedImages(env: ReportEnvironment): string[] {
	const scanned = new Set(env.scans.map((s) => s.image));
	return imagesInUse(env.containers).filter((image) => !scanned.has(image));
}

export function summarise(environments: ReportEnvironment[]): ReportTotals {
	const totals: ReportTotals = {
		environments: environments.length,
		containers: 0,
		stacks: 0,
		scannedImages: 0,
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
		unscannedImages: 0,
		unreachableEnvironments: 0
	};
	for (const env of environments) {
		if (env.unreachable) {
			totals.unreachableEnvironments++;
			continue;
		}
		totals.containers += env.containers.length;
		totals.stacks += env.stacks.length;
		totals.scannedImages += env.scans.length;
		totals.unscannedImages += unscannedImages(env).length;
		for (const s of env.scans) {
			totals.critical += s.critical;
			totals.high += s.high;
			totals.medium += s.medium;
			totals.low += s.low;
		}
	}
	return totals;
}

/**
 * `withChanges` is passed in rather than derived from the tier alone: the caller
 * also has to satisfy the audit permission, so only it knows the real answer.
 */
export function buildReport(
	environments: ReportEnvironment[],
	withChanges: boolean,
	meta: { generatedAt: string; appVersion: string }
): EnvironmentReport {
	return {
		generatedAt: meta.generatedAt,
		appVersion: meta.appVersion,
		includesChanges: withChanges,
		environments: environments.map((env) => {
			const { changes, ...rest } = env;
			return withChanges ? { ...rest, changes: changes ?? [] } : rest;
		}),
		totals: summarise(environments)
	};
}

/** One flat CSV, environment-qualified, so a spreadsheet can pivot on it. */
export function reportToCSV(report: EnvironmentReport): string {
	const sections: string[] = [];

	sections.push(
		'容器\n' +
			rowsToCSV(
				['环境', '容器', '状态', '堆栈', '有可用更新'],
				report.environments.flatMap((env) =>
					env.containers.map((c) => [
						env.name,
						c.name,
						c.image,
						getLabelText(c.status),
						c.stack ?? '',
						c.updateAvailable === undefined ? '' : c.updateAvailable ? '是' : '否'
					])
				)
			)
	);

	sections.push(
		'漏洞\n' +
			rowsToCSV(
				['环境', '镜像', '严重', '高危', '中危', '低危', '扫描时间'],
				report.environments.flatMap((env) =>
					env.scans.map((s) => [
						env.name,
						s.image,
						s.critical,
						s.high,
						s.medium,
						s.low,
						s.scannedAt ? (s.scannedAt || '').replace('T', ' ').slice(0, 16) : ''
					])
				)
			)
	);

	const unreachable = report.environments
		.filter((env) => env.unreachable)
		.map((env) => [env.name, env.unreachableReason ?? '无法访问']);
	if (unreachable.length > 0) {
		sections.push(
			'无法读取的环境\n' + rowsToCSV(['环境', '原因'], unreachable)
		);
	}

	const unscanned = report.environments.flatMap((env) =>
		unscannedImages(env).map((image) => [env.name, image])
	);
	sections.push('未扫描镜像\n' + rowsToCSV(['环境', '镜像'], unscanned));

	if (report.includesChanges) {
		sections.push(
			'变更记录\n' +
				rowsToCSV(
					['环境', '时间', '用户', '操作', '实体类型', '实体'],
					report.environments.flatMap((env) =>
						(env.changes ?? []).map((c) => [
							env.name,
							(c.at || '').replace('T', ' ').slice(0, 16),
							c.username,
							getLabelText(c.action),
							c.entityType,
							c.entityName
						])
					)
				)
		);
	}

	return '\ufeff' + sections.join('\n\n');
}

/** The filename an export downloads as. */
export function reportFilename(scope: string, generatedAt: string, format: string): string {
	const day = generatedAt.slice(0, 10);
	// Dots are dropped rather than kept: the name reaches a Content-Disposition
	// header, and a run of them there reads as a path traversal attempt.
	const safe =
		scope
			.replace(/[^A-Za-z0-9_-]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-+|-+$/g, '') || 'environments';
	// The extension is sanitised as well: it reaches a Content-Disposition header,
	// and a caller passing anything but a plain word must not be able to shape it.
	const ext = /^[a-z0-9]+$/.test(format) ? format : 'txt';
	return `dockhand-report-${safe}-${day}.${ext}`;
}
