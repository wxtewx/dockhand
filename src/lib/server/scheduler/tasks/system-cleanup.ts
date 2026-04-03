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
