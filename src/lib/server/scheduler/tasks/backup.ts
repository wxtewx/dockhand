/**
 * Backup Scheduler Task
 *
 * Handles scheduled backup execution.
 */

import type { ScheduleTrigger } from '../../db';
import { runBackup } from '../../backups';

/**
 * Execute a scheduled backup.
 */
export async function runScheduledBackup(
	configId: number,
	entityName: string,
	environmentId: number | null | undefined,
	triggeredBy: ScheduleTrigger = 'cron'
): Promise<void> {
	console.log(`[备份] 配置 ${configId} (${entityName}) 定时备份已触发，触发方式：${triggeredBy}`);

	const validTrigger = triggeredBy === 'cron' || triggeredBy === 'manual' || triggeredBy === 'webhook'
		? triggeredBy
		: 'manual';

	const result = await runBackup(configId, validTrigger);

	if (result.status === 'success' || result.status === 'warning') {
		console.log(`[备份] 配置 ${configId} (${entityName}) 定时备份执行完成，快照ID：${result.snapshotId}`);
	} else if (result.status === 'skipped') {
		// A benign overlap (one already running) — not a failure.
		console.log(`[备份] 配置 ${configId} (${entityName}) 定时备份已跳过：${result.reason}`);
	} else if (result.status === 'error') {
		console.error(`[备份] 配置 ${configId} (${entityName}) 定时备份执行失败：${result.error}`);
	}
}
