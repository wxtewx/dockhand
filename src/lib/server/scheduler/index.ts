/**
 * Unified Scheduler Service
 *
 * Manages all scheduled tasks using croner with automatic job lifecycle:
 * - System cleanup jobs (static cron schedules)
 * - Container auto-updates (dynamic schedules from database)
 * - Git stack auto-sync (dynamic schedules from database)
 *
 * All execution logic is in separate task files for clean architecture.
 */

import { Cron } from 'croner';
import {
	getEnabledAutoUpdateSettings,
	getEnabledAutoUpdateGitStacks,
	getAutoUpdateSettingById,
	getGitStack,
	getScheduleCleanupCron,
	getEventCleanupCron,
	getScheduleRetentionDays,
	getEventRetentionDays,
	getScheduleCleanupEnabled,
	getEventCleanupEnabled,
	getEnvironments,
	getEnvUpdateCheckSettings,
	getAllEnvUpdateCheckSettings,
	getImagePruneSettings,
	getAllImagePruneSettings,
	getEnvironment,
	getEnvironmentTimezone,
	getDefaultTimezone
} from '../db';
import { db, gitStacks, eq } from '../db/drizzle.js';
import {
	cleanupStaleVolumeHelpers,
	cleanupExpiredVolumeHelpers
} from '../docker';

// Import task execution functions
import { runContainerUpdate } from './tasks/container-update';
import { runGitStackSync } from './tasks/git-stack-sync';
import { runEnvUpdateCheckJob } from './tasks/env-update-check';
import { runImagePrune } from './tasks/image-prune';
import {
	runScheduleCleanupJob,
	runEventCleanupJob,
	runVolumeHelperCleanupJob,
	SYSTEM_SCHEDULE_CLEANUP_ID,
	SYSTEM_EVENT_CLEANUP_ID,
	SYSTEM_VOLUME_HELPER_CLEANUP_ID
} from './tasks/system-cleanup';

// Store all active cron jobs
const activeJobs: Map<string, Cron> = new Map();

// System cleanup jobs
let cleanupJob: Cron | null = null;
let eventCleanupJob: Cron | null = null;
let volumeHelperCleanupJob: Cron | null = null;

// Scheduler state
let isRunning = false;

/**
 * Clean up stale 'syncing' states from git stacks.
 * Called on startup to recover from crashes during sync operations.
 */
async function cleanupStaleSyncStates(): Promise<void> {
	const staleStacks = await db.select().from(gitStacks).where(eq(gitStacks.syncStatus, 'syncing'));

	if (staleStacks.length === 0) {
		return;
	}

	console.log(`[调度器] 正在恢复 ${staleStacks.length} 个处于异常同步状态的 Git 堆栈`);

	for (const stack of staleStacks) {
		await db.update(gitStacks).set({
			syncStatus: 'pending',
			syncError: '启动时从中断的同步中恢复',
			updatedAt: new Date().toISOString()
		}).where(eq(gitStacks.id, stack.id));

		console.log(`[调度器] 已重置 Git 堆栈 "${stack.stackName}" (ID: ${stack.id}) 为待处理状态`);
	}
}

/**
 * Start the unified scheduler service.
 * Registers all schedules with croner for automatic execution.
 */
export async function startScheduler(): Promise<void> {
	if (isRunning) {
		console.log('[调度器] 已在运行中');
		return;
	}

	console.log('[调度器] 正在启动调度服务...');
	isRunning = true;

	// Clean up stale sync states from previous crashed processes
	await cleanupStaleSyncStates();

	// Get cron expressions and default timezone from database
	const scheduleCleanupCron = await getScheduleCleanupCron();
	const eventCleanupCron = await getEventCleanupCron();
	const defaultTimezone = await getDefaultTimezone();

	// Start system cleanup jobs (static schedules with default timezone)
	cleanupJob = new Cron(scheduleCleanupCron, { timezone: defaultTimezone, legacyMode: false }, async () => {
		await runScheduleCleanupJob();
	});

	eventCleanupJob = new Cron(eventCleanupCron, { timezone: defaultTimezone, legacyMode: false }, async () => {
		await runEventCleanupJob();
	});

	// Cleanup functions to pass to the job (avoids dynamic import issues in production)
	// Wrap cleanupStaleVolumeHelpers to pre-fetch environments
	const wrappedCleanupStale = async () => {
		const envs = await getEnvironments();
		await cleanupStaleVolumeHelpers(envs);
	};
	const volumeCleanupFns = {
		cleanupStaleVolumeHelpers: wrappedCleanupStale,
		cleanupExpiredVolumeHelpers
	};

	// Volume helper cleanup runs every 30 minutes to clean up expired browse containers
	volumeHelperCleanupJob = new Cron('*/30 * * * *', { timezone: defaultTimezone, legacyMode: false }, async () => {
		await runVolumeHelperCleanupJob('cron', volumeCleanupFns);
	});


	console.log(`[调度器] 系统计划任务清理：${scheduleCleanupCron} [${defaultTimezone}]`);
	console.log(`[调度器] 系统事件清理：${eventCleanupCron} [${defaultTimezone}]`);
	console.log(`[调度器] 数据卷辅助容器清理：每 30 分钟 [${defaultTimezone}]`);

	// Register all dynamic schedules from database
	await refreshAllSchedules();

	console.log('[调度器] 服务已启动');
}

/**
 * Stop the scheduler service and cleanup all jobs.
 */
export function stopScheduler(): void {
	if (!isRunning) return;

	console.log('[调度器] 正在停止调度服务...');
	isRunning = false;

	// Stop system jobs
	if (cleanupJob) {
		cleanupJob.stop();
		cleanupJob = null;
	}
	if (eventCleanupJob) {
		eventCleanupJob.stop();
		eventCleanupJob = null;
	}
	if (volumeHelperCleanupJob) {
		volumeHelperCleanupJob.stop();
		volumeHelperCleanupJob = null;
	}

	// Stop all dynamic jobs
	for (const [key, job] of activeJobs.entries()) {
		job.stop();
	}
	activeJobs.clear();

	console.log('[调度器] 服务已停止');
}

/**
 * Refresh all dynamic schedules from database.
 * Called on startup and optionally for recovery.
 */
export async function refreshAllSchedules(): Promise<void> {
	console.log('[调度器] 正在刷新所有计划任务...');

	// Clear existing dynamic jobs
	for (const [key, job] of activeJobs.entries()) {
		job.stop();
	}
	activeJobs.clear();

	let containerCount = 0;
	let gitStackCount = 0;

	// Register container auto-update schedules
	try {
		const containerSettings = await getEnabledAutoUpdateSettings();
		for (const setting of containerSettings) {
			if (setting.cronExpression) {
				const registered = await registerSchedule(
					setting.id,
					'container_update',
					setting.environmentId
				);
				if (registered) containerCount++;
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[调度器] 加载容器计划任务失败：', errorMsg);
	}

	// Register git stack auto-sync schedules
	try {
		const gitStacks = await getEnabledAutoUpdateGitStacks();
		for (const stack of gitStacks) {
			if (stack.autoUpdateCron) {
				const registered = await registerSchedule(
					stack.id,
					'git_stack_sync',
					stack.environmentId
				);
				if (registered) gitStackCount++;
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[调度器] 加载 Git 堆栈计划任务失败：', errorMsg);
	}

	// Register environment update check schedules
	let envUpdateCheckCount = 0;
	try {
		const envConfigs = await getAllEnvUpdateCheckSettings();
		for (const { envId, settings } of envConfigs) {
			if (settings.enabled && settings.cron) {
				const registered = await registerSchedule(
					envId,
					'env_update_check',
					envId
				);
				if (registered) envUpdateCheckCount++;
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[调度器] 加载环境更新检查计划任务失败：', errorMsg);
	}

	// Register image prune schedules
	let imagePruneCount = 0;
	try {
		const pruneConfigs = await getAllImagePruneSettings();
		for (const { envId, settings } of pruneConfigs) {
			if (settings.enabled && settings.cronExpression) {
				const registered = await registerSchedule(
					envId,
					'image_prune',
					envId
				);
				if (registered) imagePruneCount++;
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[调度器] 加载镜像清理计划任务失败：', errorMsg);
	}

	console.log(`[调度器] 已注册 ${containerCount} 个容器任务、${gitStackCount} 个 Git 堆栈任务、${envUpdateCheckCount} 个环境更新检查任务、${imagePruneCount} 个镜像清理任务`);
}

/**
 * Register or update a schedule with automatic croner execution.
 * Idempotent - can be called multiple times safely.
 */
export async function registerSchedule(
	scheduleId: number,
	type: 'container_update' | 'git_stack_sync' | 'env_update_check' | 'image_prune',
	environmentId: number | null
): Promise<boolean> {
	const key = `${type}-${scheduleId}`;

	try {
		// Unregister existing job if present
		unregisterSchedule(scheduleId, type);

		// Fetch schedule data from database
		let cronExpression: string | null = null;
		let entityName: string | null = null;
		let enabled = false;

		if (type === 'container_update') {
			const setting = await getAutoUpdateSettingById(scheduleId);
			if (!setting) return false;
			cronExpression = setting.cronExpression;
			entityName = setting.containerName;
			enabled = setting.enabled;
		} else if (type === 'git_stack_sync') {
			const stack = await getGitStack(scheduleId);
			if (!stack) return false;
			cronExpression = stack.autoUpdateCron;
			entityName = stack.stackName;
			enabled = stack.autoUpdate;
		} else if (type === 'env_update_check') {
			const config = await getEnvUpdateCheckSettings(scheduleId);
			if (!config) return false;
			const env = await getEnvironment(scheduleId);
			if (!env) return false;
			cronExpression = config.cron;
			entityName = `更新检查：${env.name}`;
			enabled = config.enabled;
		} else if (type === 'image_prune') {
			const config = await getImagePruneSettings(scheduleId);
			if (!config) return false;
			const env = await getEnvironment(scheduleId);
			if (!env) return false;
			cronExpression = config.cronExpression;
			entityName = `镜像清理：${env.name}`;
			enabled = config.enabled;
		}

		// Don't create job if disabled or no cron expression
		if (!enabled || !cronExpression) {
			return false;
		}

		// Get timezone for this environment
		const timezone = environmentId ? await getEnvironmentTimezone(environmentId) : 'UTC';

		// Create new Cron instance with timezone
		const job = new Cron(cronExpression, { timezone, legacyMode: false }, async () => {
			// Defensive check: verify schedule still exists and is enabled
			if (type === 'container_update') {
				const setting = await getAutoUpdateSettingById(scheduleId);
				if (!setting || !setting.enabled) return;
				await runContainerUpdate(scheduleId, setting.containerName, environmentId, 'cron');
			} else if (type === 'git_stack_sync') {
				const stack = await getGitStack(scheduleId);
				if (!stack || !stack.autoUpdate) return;
				await runGitStackSync(scheduleId, stack.stackName, environmentId, 'cron');
			} else if (type === 'env_update_check') {
				const config = await getEnvUpdateCheckSettings(scheduleId);
				if (!config || !config.enabled) return;
				await runEnvUpdateCheckJob(scheduleId, 'cron');
			} else if (type === 'image_prune') {
				const config = await getImagePruneSettings(scheduleId);
				if (!config || !config.enabled) return;
				await runImagePrune(scheduleId, 'cron');
			}
		});

		// Store in active jobs map
		activeJobs.set(key, job);
		console.log(`[调度器] 已注册 ${type} 计划任务 ${scheduleId} (${entityName}): ${cronExpression} [${timezone}]`);
		return true;
	} catch (error: any) {
		console.error(`[调度器] 注册 ${type} 计划任务 ${scheduleId} 失败：`, error.message);
		return false;
	}
}

/**
 * Unregister a schedule and stop its croner job.
 * Idempotent - safe to call even if not registered.
 */
export function unregisterSchedule(
	scheduleId: number,
	type: 'container_update' | 'git_stack_sync' | 'env_update_check' | 'image_prune'
): void {
	const key = `${type}-${scheduleId}`;
	const job = activeJobs.get(key);

	if (job) {
		job.stop();
		activeJobs.delete(key);
		console.log(`[调度器] 已注销 ${type} 计划任务 ${scheduleId}`);
	}
}

/**
 * Refresh all schedules for a specific environment.
 * Called when an environment's timezone changes to re-register jobs with the new timezone.
 */
export async function refreshSchedulesForEnvironment(environmentId: number): Promise<void> {
	console.log(`[调度器] 正在刷新环境 ${environmentId} 的计划任务 (时区已变更)`);

	let refreshedCount = 0;

	// Re-register container auto-update schedules for this environment
	try {
		const containerSettings = await getEnabledAutoUpdateSettings();
		for (const setting of containerSettings) {
			if (setting.environmentId === environmentId && setting.cronExpression) {
				const registered = await registerSchedule(
					setting.id,
					'container_update',
					setting.environmentId
				);
				if (registered) refreshedCount++;
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[调度器] 刷新容器计划任务失败：', errorMsg);
	}

	// Re-register git stack auto-sync schedules for this environment
	try {
		const gitStacks = await getEnabledAutoUpdateGitStacks();
		for (const stack of gitStacks) {
			if (stack.environmentId === environmentId && stack.autoUpdateCron) {
				const registered = await registerSchedule(
					stack.id,
					'git_stack_sync',
					stack.environmentId
				);
				if (registered) refreshedCount++;
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[调度器] 刷新 Git 堆栈计划任务失败：', errorMsg);
	}

	// Re-register environment update check schedule for this environment
	try {
		const config = await getEnvUpdateCheckSettings(environmentId);
		if (config && config.enabled && config.cron) {
			const registered = await registerSchedule(
				environmentId,
				'env_update_check',
				environmentId
			);
			if (registered) refreshedCount++;
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[调度器] 刷新环境更新检查计划任务失败：', errorMsg);
	}

	// Re-register image prune schedule for this environment
	try {
		const config = await getImagePruneSettings(environmentId);
		if (config && config.enabled && config.cronExpression) {
			const registered = await registerSchedule(
				environmentId,
				'image_prune',
				environmentId
			);
			if (registered) refreshedCount++;
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[调度器] 刷新镜像清理计划任务失败：', errorMsg);
	}

	console.log(`[调度器] 已刷新环境 ${environmentId} 的 ${refreshedCount} 个计划任务`);
}

/**
 * Refresh system cleanup jobs with the new default timezone.
 * Called when the default timezone setting changes.
 */
export async function refreshSystemJobs(): Promise<void> {
	console.log('[调度器] 正在刷新系统任务 (默认时区已变更)');

	// Get current settings
	const scheduleCleanupCron = await getScheduleCleanupCron();
	const eventCleanupCron = await getEventCleanupCron();
	const defaultTimezone = await getDefaultTimezone();

	// Cleanup functions to pass to the job
	const wrappedCleanupStale = async () => {
		const envs = await getEnvironments();
		await cleanupStaleVolumeHelpers(envs);
	};
	const volumeCleanupFns = {
		cleanupStaleVolumeHelpers: wrappedCleanupStale,
		cleanupExpiredVolumeHelpers
	};

	// Stop existing system jobs
	if (cleanupJob) {
		cleanupJob.stop();
	}
	if (eventCleanupJob) {
		eventCleanupJob.stop();
	}
	if (volumeHelperCleanupJob) {
		volumeHelperCleanupJob.stop();
	}

	// Re-create with new timezone
	cleanupJob = new Cron(scheduleCleanupCron, { timezone: defaultTimezone, legacyMode: false }, async () => {
		await runScheduleCleanupJob();
	});

	eventCleanupJob = new Cron(eventCleanupCron, { timezone: defaultTimezone, legacyMode: false }, async () => {
		await runEventCleanupJob();
	});

	volumeHelperCleanupJob = new Cron('*/30 * * * *', { timezone: defaultTimezone, legacyMode: false }, async () => {
		await runVolumeHelperCleanupJob('cron', volumeCleanupFns);
	});

	console.log(`[调度器] 系统计划任务清理：${scheduleCleanupCron} [${defaultTimezone}]`);
	console.log(`[调度器] 系统事件清理：${eventCleanupCron} [${defaultTimezone}]`);
	console.log(`[调度器] 数据卷辅助容器清理：每 30 分钟 [${defaultTimezone}]`);
}

// =============================================================================
// MANUAL TRIGGER FUNCTIONS (for API endpoints)
// =============================================================================

/**
 * Manually trigger a container update.
 */
export async function triggerContainerUpdate(settingId: number): Promise<{ success: boolean; executionId?: number; error?: string }> {
	try {
		const setting = await getAutoUpdateSettingById(settingId);
		if (!setting) {
			return { success: false, error: '未找到自动更新配置' };
		}

		// Run in background
		runContainerUpdate(settingId, setting.containerName, setting.environmentId, 'manual');

		return { success: true };
	} catch (error: any) {
		return { success: false, error: error.message };
	}
}

/**
 * Manually trigger a git stack sync.
 */
export async function triggerGitStackSync(stackId: number): Promise<{ success: boolean; executionId?: number; error?: string }> {
	try {
		const stack = await getGitStack(stackId);
		if (!stack) {
			return { success: false, error: '未找到 Git 堆栈' };
		}

		// Run in background
		runGitStackSync(stackId, stack.stackName, stack.environmentId, 'manual');

		return { success: true };
	} catch (error: any) {
		return { success: false, error: error.message };
	}
}

/**
 * Trigger git stack sync from webhook (called from webhook endpoint).
 */
export async function triggerGitStackSyncFromWebhook(stackId: number): Promise<{ success: boolean; executionId?: number; error?: string }> {
	try {
		const stack = await getGitStack(stackId);
		if (!stack) {
			return { success: false, error: '未找到 Git 堆栈' };
		}

		// Run in background
		runGitStackSync(stackId, stack.stackName, stack.environmentId, 'webhook');

		return { success: true };
	} catch (error: any) {
		return { success: false, error: error.message };
	}
}

/**
 * Manually trigger an environment update check.
 */
export async function triggerEnvUpdateCheck(environmentId: number): Promise<{ success: boolean; executionId?: number; error?: string }> {
	try {
		const config = await getEnvUpdateCheckSettings(environmentId);
		if (!config) {
			return { success: false, error: '未找到该环境的更新检查配置' };
		}

		const env = await getEnvironment(environmentId);
		if (!env) {
			return { success: false, error: '未找到环境' };
		}

		// Run in background
		runEnvUpdateCheckJob(environmentId, 'manual');

		return { success: true };
	} catch (error: any) {
		return { success: false, error: error.message };
	}
}

/**
 * Manually trigger an image prune for an environment.
 */
export async function triggerImagePrune(environmentId: number): Promise<{ success: boolean; executionId?: number; error?: string }> {
	try {
		const config = await getImagePruneSettings(environmentId);
		if (!config) {
			return { success: false, error: '未找到该环境的镜像清理配置' };
		}

		const env = await getEnvironment(environmentId);
		if (!env) {
			return { success: false, error: '未找到环境' };
		}

		// Run in background
		runImagePrune(environmentId, 'manual');

		return { success: true };
	} catch (error: any) {
		return { success: false, error: error.message };
	}
}

/**
 * Manually trigger a system job (schedule cleanup, event cleanup, etc.).
 */
export async function triggerSystemJob(jobId: string): Promise<{ success: boolean; executionId?: number; error?: string }> {
	try {
		if (jobId === String(SYSTEM_SCHEDULE_CLEANUP_ID) || jobId === 'schedule-cleanup') {
			runScheduleCleanupJob('manual');
			return { success: true };
		} else if (jobId === String(SYSTEM_EVENT_CLEANUP_ID) || jobId === 'event-cleanup') {
			runEventCleanupJob('manual');
			return { success: true };
		} else if (jobId === String(SYSTEM_VOLUME_HELPER_CLEANUP_ID) || jobId === 'volume-helper-cleanup') {
			// Wrap to pre-fetch environments (avoids dynamic import in production)
			const wrappedCleanupStale = async () => {
				const envs = await getEnvironments();
				await cleanupStaleVolumeHelpers(envs);
			};
			runVolumeHelperCleanupJob('manual', {
				cleanupStaleVolumeHelpers: wrappedCleanupStale,
				cleanupExpiredVolumeHelpers
			});
			return { success: true };
		} else {
			return { success: false, error: '未知的系统任务 ID' };
		}
	} catch (error: any) {
		return { success: false, error: error.message };
	}
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

// Imported from cron-utils.ts (isolated from DB deps for unit test compatibility)
import { getNextRun, isValidCron } from './cron-utils';
export { getNextRun, isValidCron };

/**
 * Get system schedules info for the API.
 */
export async function getSystemSchedules(): Promise<SystemScheduleInfo[]> {
	const scheduleRetention = await getScheduleRetentionDays();
	const eventRetention = await getEventRetentionDays();
	const scheduleCleanupCron = await getScheduleCleanupCron();
	const eventCleanupCron = await getEventCleanupCron();
	const scheduleCleanupEnabled = await getScheduleCleanupEnabled();
	const eventCleanupEnabled = await getEventCleanupEnabled();

	return [
		{
			id: SYSTEM_SCHEDULE_CLEANUP_ID,
			type: 'system_cleanup' as const,
			name: '计划任务执行记录清理',
			description: `移除超过 ${scheduleRetention} 天的执行日志`,
			cronExpression: scheduleCleanupCron,
			nextRun: scheduleCleanupEnabled ? getNextRun(scheduleCleanupCron)?.toISOString() ?? null : null,
			isSystem: true,
			enabled: scheduleCleanupEnabled
		},
		{
			id: SYSTEM_EVENT_CLEANUP_ID,
			type: 'system_cleanup' as const,
			name: '容器事件清理',
			description: `移除超过 ${eventRetention} 天的容器事件`,
			cronExpression: eventCleanupCron,
			nextRun: eventCleanupEnabled ? getNextRun(eventCleanupCron)?.toISOString() ?? null : null,
			isSystem: true,
			enabled: eventCleanupEnabled
		},
		{
			id: SYSTEM_VOLUME_HELPER_CLEANUP_ID,
			type: 'system_cleanup' as const,
			name: '数据卷辅助容器清理',
			description: '清理临时数据卷浏览容器',
			cronExpression: '*/30 * * * *',
			nextRun: getNextRun('*/30 * * * *')?.toISOString() ?? null,
			isSystem: true,
			enabled: true
		}
	];
}

export interface SystemScheduleInfo {
	id: number;
	type: 'system_cleanup';
	name: string;
	description: string;
	cronExpression: string;
	nextRun: string | null;
	isSystem: true;
	enabled: boolean;
}
