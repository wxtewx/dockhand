/**
 * System Cleanup Tasks
 *
 * Handles system cleanup jobs (schedule executions, container events).
 */

import type { ScheduleTrigger } from '../../db';
import {
	getScheduleRetentionDays,
	cleanupOldExecutions,
	getEventRetentionDays,
	getScheduleCleanupEnabled,
	getEventCleanupEnabled,
	createScheduleExecution,
	updateScheduleExecution,
	appendScheduleExecutionLog
} from '../../db';

// System job IDs
export const SYSTEM_SCHEDULE_CLEANUP_ID = 1;
export const SYSTEM_EVENT_CLEANUP_ID = 2;
export const SYSTEM_VOLUME_HELPER_CLEANUP_ID = 3;
export const SYSTEM_SCANNER_CLEANUP_ID = 4;

/**
 * Execute schedule execution cleanup job.
 */
export async function runScheduleCleanupJob(triggeredBy: ScheduleTrigger = 'cron'): Promise<void> {
	// Check if cleanup is enabled (skip check if manually triggered)
	if (triggeredBy === 'cron') {
		const enabled = await getScheduleCleanupEnabled();
		if (!enabled) {
			return; // Skip execution if disabled
		}
	}

	const startTime = Date.now();

	// Create execution record
	const execution = await createScheduleExecution({
		scheduleType: 'system_cleanup',
		scheduleId: SYSTEM_SCHEDULE_CLEANUP_ID,
		environmentId: null,
		entityName: '计划任务执行记录清理',
		triggeredBy,
		status: 'running'
	});

	await updateScheduleExecution(execution.id, {
		startedAt: new Date().toISOString()
	});

	const log = async (message: string) => {
		console.log(`[计划任务清理] ${message}`);
		await appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${message}`);
	};

	try {
		const retentionDays = await getScheduleRetentionDays();
		await log(`开始清理，保留天数：${retentionDays} 天`);

		await cleanupOldExecutions(retentionDays);

		await log('清理完成');
		await updateScheduleExecution(execution.id, {
			status: 'success',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			details: { retentionDays }
		});
	} catch (error: any) {
		await log(`错误：${error.message}`);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: error.message
		});
	}
}

/**
 * Execute event cleanup job.
 */
export async function runEventCleanupJob(triggeredBy: ScheduleTrigger = 'cron'): Promise<void> {
	// Check if cleanup is enabled (skip check if manually triggered)
	if (triggeredBy === 'cron') {
		const enabled = await getEventCleanupEnabled();
		if (!enabled) {
			return; // Skip execution if disabled
		}
	}

	const startTime = Date.now();

	// Create execution record
	const execution = await createScheduleExecution({
		scheduleType: 'system_cleanup',
		scheduleId: SYSTEM_EVENT_CLEANUP_ID,
		environmentId: null,
		entityName: '容器事件清理',
		triggeredBy,
		status: 'running'
	});

	await updateScheduleExecution(execution.id, {
		startedAt: new Date().toISOString()
	});

	const log = async (message: string) => {
		console.log(`[事件清理] ${message}`);
		await appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${message}`);
	};

	try {
		const { deleteOldContainerEvents } = await import('../../db');
		const retentionDays = await getEventRetentionDays();

		await log(`开始清理超过 ${retentionDays} 天的旧事件`);

		const deleted = await deleteOldContainerEvents(retentionDays);

		await log(`已移除 ${deleted} 条旧容器事件`);
		await updateScheduleExecution(execution.id, {
			status: 'success',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			details: { deletedCount: deleted, retentionDays }
		});
	} catch (error: any) {
		await log(`错误：${error.message}`);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: error.message
		});
	}
}

/**
 * Execute volume helper cleanup job.
 * Cleans up stale dockhand-browse-* containers used for volume browsing.
 * @param triggeredBy - What triggered this execution
 * @param cleanupFns - Optional cleanup functions (passed from scheduler to avoid dynamic import issues)
 */
export async function runVolumeHelperCleanupJob(
	triggeredBy: ScheduleTrigger = 'cron',
	cleanupFns?: {
		cleanupStaleVolumeHelpers: () => Promise<void>;
		cleanupExpiredVolumeHelpers: () => Promise<void>;
	}
): Promise<void> {
	const startTime = Date.now();

	// Create execution record
	const execution = await createScheduleExecution({
		scheduleType: 'system_cleanup',
		scheduleId: SYSTEM_VOLUME_HELPER_CLEANUP_ID,
		environmentId: null,
		entityName: '数据卷辅助容器清理',
		triggeredBy,
		status: 'running'
	});

	await updateScheduleExecution(execution.id, {
		startedAt: new Date().toISOString()
	});

	const log = async (message: string) => {
		console.log(`[数据卷辅助容器清理] ${message}`);
		await appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${message}`);
	};

	try {
		await log('开始清理失效与过期的数据卷辅助容器');

		if (cleanupFns) {
			// Use provided functions (from scheduler static imports)
			await cleanupFns.cleanupStaleVolumeHelpers();
			await cleanupFns.cleanupExpiredVolumeHelpers();
		} else {
			// Fallback to dynamic import (may not work in production)
			const { runVolumeHelperCleanup } = await import('../../db');
			await runVolumeHelperCleanup();
		}

		await log('清理完成');
		await updateScheduleExecution(execution.id, {
			status: 'success',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime
		});
	} catch (error: any) {
		await log(`错误：${error.message}`);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: error.message
		});
	}
}

/**
 * Execute scanner cache cleanup job.
 * Removes scanner database volumes and bind mount directories to reclaim disk space.
 */
export async function runScannerCacheCleanupJob(
	triggeredBy: ScheduleTrigger = 'cron',
	cleanupFn?: () => Promise<{ volumes: string[]; dirs: string[] }>
): Promise<void> {
	const startTime = Date.now();

	const execution = await createScheduleExecution({
		scheduleType: 'system_cleanup',
		scheduleId: SYSTEM_SCANNER_CLEANUP_ID,
		environmentId: null,
		entityName: '扫描器缓存清理',
		triggeredBy,
		status: 'running'
	});

	await updateScheduleExecution(execution.id, {
		startedAt: new Date().toISOString()
	});

	const log = async (message: string) => {
		console.log(`[扫描器缓存清理] ${message}`);
		await appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${message}`);
	};

	try {
		await log('开始执行扫描器缓存清理');

		let result: { volumes: string[]; dirs: string[] };
		if (cleanupFn) {
			result = await cleanupFn();
		} else {
			const { cleanupScannerCache } = await import('../../scanner');
			result = await cleanupScannerCache();
		}

		if (result.volumes.length > 0) {
			await log(`已移除数据卷：${result.volumes.join(', ')}`);
		}
		if (result.dirs.length > 0) {
			await log(`已移除目录：${result.dirs.join(', ')}`);
		}
		await log(`清理完成：已移除 ${result.volumes.length} 个数据卷，${result.dirs.length} 个目录`);
		await updateScheduleExecution(execution.id, {
			status: 'success',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			details: { removedVolumes: result.volumes, removedDirs: result.dirs }
		});
	} catch (error: any) {
		await log(`错误：${error.message}`);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: error.message
		});
	}
}
