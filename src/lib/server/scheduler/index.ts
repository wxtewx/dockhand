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
	getScannerCleanupCron,
	getScheduleRetentionDays,
	getEventRetentionDays,
	getScheduleCleanupEnabled,
	getEventCleanupEnabled,
	getScannerCleanupEnabled,
	getEnvironments,
	getEnvUpdateCheckSettings,
	getAllEnvUpdateCheckSettings,
	getImagePruneSettings,
	getAllImagePruneSettings,
	getEnvironment,
	getEnvironmentTimezone,
	getDefaultTimezone,
	getBackupConfig,
	getEnabledBackupConfigs,
	getBackupDestinations,
	getBackupDestination
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
import { runScheduledBackup } from './tasks/backup';
import { runRepoPrune, runRepoCheck, runRepoVerify } from './tasks/repo-maintenance';
import { parsePoliciesJson } from '../backups/helpers';
import { BACKUPS_ENABLED } from '../features';
import {
	runScheduleCleanupJob,
	runEventCleanupJob,
	runVolumeHelperCleanupJob,
	runScannerCacheCleanupJob,
	SYSTEM_SCHEDULE_CLEANUP_ID,
	SYSTEM_EVENT_CLEANUP_ID,
	SYSTEM_VOLUME_HELPER_CLEANUP_ID,
	SYSTEM_SCANNER_CLEANUP_ID
} from './tasks/system-cleanup';

// Store all active cron jobs
const activeJobs: Map<string, Cron> = new Map();

// System cleanup jobs
let cleanupJob: Cron | null = null;
let eventCleanupJob: Cron | null = null;
let volumeHelperCleanupJob: Cron | null = null;
let scannerCacheCleanupJob: Cron | null = null;

// Scheduler state
let isRunning = false;

/**
 * Scanner cache cleanup function that cleans local and all remote environments.
 * Shared between cron job, timezone refresh, and manual trigger.
 */
async function scannerCleanupAllEnvs(): Promise<{ volumes: string[]; dirs: string[] }> {
	const { cleanupScannerCache } = await import('../scanner');
	const envs = await getEnvironments();

	// Clean local cache (volumes + bind mount dirs)
	const localResult = await cleanupScannerCache();

	// Clean remote environment volumes
	for (const env of envs) {
		try {
			const envResult = await cleanupScannerCache(env.id);
			localResult.volumes.push(...envResult.volumes);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.log(`[扫描器] 跳过环境 "${env.name}" (id=${env.id}) 的缓存清理：${msg}`);
		}
	}

	return localResult;
}

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

	// Mark any schedule execution still 'queued'/'running' as failed (audit
	// #49/#50) — a crash mid-run otherwise leaves the row perpetually in-progress.
	try {
		const { failStaleRunningExecutions } = await import('../db');
		const swept = await failStaleRunningExecutions();
		if (swept > 0) console.log(`[调度器] 将 ${swept} 条中断的执行任务标记为失败`);
	} catch (err) {
		console.warn(`[调度器] 清理过期执行任务失败：${err instanceof Error ? err.message : String(err)}`);
	}

	// BETA GATE: backup startup recovery only runs when FEAT_BACKUPS_ENABLED (see features.ts).
	if (BACKUPS_ENABLED) {
		// Reap orphan backup/restore helper containers left by a crashed process BEFORE
		// any backup can run — otherwise the next backup's repo unlock could wipe a lock
		// an orphan restic is still holding. Runs before the engine reconciliation below
		// so no live helper from a crashed run is still mid-operation.
		try {
			const { cleanupStaleBackupHelpers } = await import('../docker');
			const envs = await getEnvironments();
			const reaped = await cleanupStaleBackupHelpers(envs);
			if (reaped > 0) console.log(`[调度器] 回收了上一轮残留的 ${reaped} 个备份辅助容器`);
		} catch (err) {
			console.warn(`[调度器] 回收残留辅助容器失败：${err instanceof Error ? err.message : String(err)}`);
		}

		// New backup/restore engine: roll back any restore swap it left interrupted,
		// then scrub operations left `running` by a dead process. Runs after the orphan
		// helper reap above; it recovers swaps recorded by the engine's journal.
		try {
			const { reconcileOnStartup } = await import('../backups');
			const { swapsRolledBack, containersRestarted, opsScrubbed } = await reconcileOnStartup();
			if (swapsRolledBack > 0) console.log(`[调度器] 回滚了 ${swapsRolledBack} 次被中断的数据交换操作`);
			if (containersRestarted > 0) console.log(`[调度器] 重启 ${containersRestarted} 个因备份/恢复而暂停的目标实例`);
			if (opsScrubbed > 0) console.log(`[调度器] 清理 ${opsScrubbed} 条中断的操作记录`);
		} catch (err) {
			console.warn(`[调度器] 备份引擎启动自检恢复失败：${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// Get cron expressions and default timezone from database
	const scheduleCleanupCron = await getScheduleCleanupCron();
	const eventCleanupCron = await getEventCleanupCron();
	const scannerCleanupCron = await getScannerCleanupCron();
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

	// Scanner cache cleanup to prevent DB volume bloat (configurable schedule)
	const scannerCleanupEnabled = await getScannerCleanupEnabled();
	if (scannerCleanupEnabled) {
		scannerCacheCleanupJob = new Cron(scannerCleanupCron, { timezone: defaultTimezone, legacyMode: false }, async () => {
			await runScannerCacheCleanupJob('cron', scannerCleanupAllEnvs);
		});
	}

	console.log(`[调度器] 系统计划清理：${scheduleCleanupCron} [${defaultTimezone}]`);
	console.log(`[调度器] 系统事件清理：${eventCleanupCron} [${defaultTimezone}]`);
	console.log(`[调度器] 数据卷助手清理：每 30 分钟 [${defaultTimezone}]`);
	console.log(`[调度器] 扫描器缓存清理：${scannerCleanupEnabled ? scannerCleanupCron : '已禁用'} [${defaultTimezone}]`);

	// Register all dynamic schedules from database
	await refreshAllSchedules();

	console.log('[调度器] 服务已启动');
}

/**
 * Stop the scheduler service and cleanup all jobs.
 */
/** Scheduler state — for the metrics endpoint. */
export function getSchedulerStats(): { running: boolean; activeJobs: number } {
	return { running: isRunning, activeJobs: activeJobs.size };
}

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
	if (scannerCacheCleanupJob) {
		scannerCacheCleanupJob.stop();
		scannerCacheCleanupJob = null;
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

	// Register backup + repo-maintenance schedules.
	// BETA GATE: skip entirely unless FEAT_BACKUPS_ENABLED (see features.ts).
	let backupCount = 0;
	let repoPruneCount = 0;
	let repoCheckCount = 0;
	let repoVerifyCount = 0;
	if (BACKUPS_ENABLED) {
		try {
			const backupConfigs = await getEnabledBackupConfigs();
			for (const config of backupConfigs) {
				if (config.schedule) {
					const registered = await registerSchedule(
						config.id,
						'backup',
						config.environmentId
					);
					if (registered) backupCount++;
				}
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error('[调度器] 加载备份定时任务时出错:', errorMsg);
		}

		// Register repo maintenance schedules (prune + check + verify from destination policies)
		try {
			const destinations = await getBackupDestinations();
			for (const dest of destinations) {
				const policies = parsePoliciesJson(dest.policies); // (audit #26) logs on malformed JSON
				if (policies.pruneEnabled && policies.pruneSchedule) {
					const registered = await registerSchedule(dest.id, 'repo_prune', null);
					if (registered) repoPruneCount++;
				}
				if (policies.checkEnabled && policies.checkSchedule) {
					const registered = await registerSchedule(dest.id, 'repo_check', null);
					if (registered) repoCheckCount++;
				}
				if (policies.verifyEnabled && policies.verifySchedule) {
					const registered = await registerSchedule(dest.id, 'repo_verify', null);
					if (registered) repoVerifyCount++;
				}
			}
		} catch (error) {
			console.error('[调度器] 加载仓库维护定时任务时出错:', error instanceof Error ? error.message : String(error));
		}
	}

	console.log(`[调度器] 已注册 ${containerCount} 个容器定时任务、${gitStackCount} 个Git堆栈定时任务、${envUpdateCheckCount} 个环境更新检测定时任务、${imagePruneCount} 个镜像清理定时任务、${backupCount} 个备份定时任务、${repoPruneCount} 个仓库清理定时任务、${repoCheckCount} 个仓库检测定时任务、${repoVerifyCount} 个仓库校验定时任务`);
}

/**
 * Register or update a schedule with automatic croner execution.
 * Idempotent - can be called multiple times safely.
 */
export async function registerSchedule(
	scheduleId: number,
	type: 'container_update' | 'git_stack_sync' | 'env_update_check' | 'image_prune' | 'backup' | 'repo_prune' | 'repo_check' | 'repo_verify',
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
		} else if (type === 'image_prune') {
			const config = await getImagePruneSettings(scheduleId);
			if (!config) return false;
			const env = await getEnvironment(scheduleId);
			if (!env) return false;
			cronExpression = config.cronExpression;
			entityName = `清理: ${env.name}`;
			enabled = config.enabled;
		} else if (type === 'backup') {
			const config = await getBackupConfig(scheduleId);
			if (!config) return false;
			cronExpression = config.schedule;
			entityName = `Backup: ${config.targetName}`;
			enabled = config.enabled ?? false;
		} else if (type === 'repo_prune' || type === 'repo_check' || type === 'repo_verify') {
			const dest = await getBackupDestination(scheduleId);
			if (!dest) return false;
			const policies = parsePoliciesJson(dest.policies); // (audit #26) logs on malformed JSON
			if (type === 'repo_prune') {
				cronExpression = policies.pruneSchedule || null;
				entityName = `Prune: ${dest.name}`;
				enabled = policies.pruneEnabled ?? false;
			} else if (type === 'repo_check') {
				cronExpression = policies.checkSchedule || null;
				entityName = `Check: ${dest.name}`;
				enabled = policies.checkEnabled ?? false;
			} else {
				cronExpression = policies.verifySchedule || null;
				entityName = `Verify: ${dest.name}`;
				enabled = policies.verifyEnabled ?? false;
			}
		}

		// Don't create job if disabled or no cron expression
		if (!enabled || !cronExpression) {
			return false;
		}

		// Get timezone for this environment. Env-scoped jobs use the environment's
		// timezone; env-less jobs (repo maintenance) fall back to the configured
		// default timezone rather than a hardcoded 'UTC' (audit #5).
		const timezone = environmentId ? await getEnvironmentTimezone(environmentId) : await getDefaultTimezone();

		// Create new Cron instance with timezone.
		// protect: skip a scheduled tick if the previous run is still in progress
		// (prevents a slow update/sync from overlapping itself — duplicate
		// container recreation, concurrent git pull on the same stack dir).
		const job = new Cron(cronExpression, { timezone, legacyMode: false, protect: true }, async () => {
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
			} else if (type === 'backup') {
				const config = await getBackupConfig(scheduleId);
				if (!config || !config.enabled) return;
				await runScheduledBackup(scheduleId, config.targetName, environmentId, 'cron');
			} else if (type === 'repo_prune') {
				const dest = await getBackupDestination(scheduleId);
				if (!dest) return;
				const pol = parsePoliciesJson(dest.policies); // (audit #26) logs on malformed JSON
				if (!pol.pruneEnabled) return;
				await runRepoPrune(scheduleId, dest.name, 'cron');
			} else if (type === 'repo_check') {
				const dest = await getBackupDestination(scheduleId);
				if (!dest) return;
				const pol = parsePoliciesJson(dest.policies); // (audit #26) logs on malformed JSON
				if (!pol.checkEnabled) return;
				await runRepoCheck(scheduleId, dest.name, 'cron');
			} else if (type === 'repo_verify') {
				const dest = await getBackupDestination(scheduleId);
				if (!dest) return;
				const pol = parsePoliciesJson(dest.policies); // (audit #26) logs on malformed JSON
				if (!pol.verifyEnabled) return;
				await runRepoVerify(scheduleId, dest.name, pol.verifyDataSubset || '5%', 'cron');
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
	type: 'container_update' | 'git_stack_sync' | 'env_update_check' | 'image_prune' | 'backup' | 'repo_prune' | 'repo_check' | 'repo_verify'
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
		console.error('[调度器] 刷新环境更新检查定时任务时出错:', errorMsg);
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
		console.error('[调度器] 刷新镜像清理定时任务时出错:', errorMsg);
	}

	// Re-register backup schedules for this environment (audit #11)
	// BETA GATE: skip unless FEAT_BACKUPS_ENABLED (see features.ts).
	if (BACKUPS_ENABLED) {
		try {
			const backupConfigs = await getEnabledBackupConfigs();
			for (const config of backupConfigs) {
				if (config.environmentId === environmentId && config.schedule) {
					const registered = await registerSchedule(
						config.id,
						'backup',
						config.environmentId
					);
					if (registered) refreshedCount++;
				}
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error('[调度器] 刷新备份定时任务时出错:', errorMsg);
		}
	}

	console.log(`[调度器] 已为环境 ${environmentId} 刷新 ${refreshedCount} 个定时任务`);
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
	const scannerCleanupCron = await getScannerCleanupCron();
	const scannerCleanupEnabled = await getScannerCleanupEnabled();
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
	if (scannerCacheCleanupJob) {
		scannerCacheCleanupJob.stop();
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

	if (scannerCleanupEnabled) {
		scannerCacheCleanupJob = new Cron(scannerCleanupCron, { timezone: defaultTimezone, legacyMode: false }, async () => {
			await runScannerCacheCleanupJob('cron', scannerCleanupAllEnvs);
		});
	}

	console.log(`[调度器] 系统计划清理：${scheduleCleanupCron} [${defaultTimezone}]`);
	console.log(`[调度器] 系统事件清理：${eventCleanupCron} [${defaultTimezone}]`);
	console.log(`[调度器] 数据卷助手清理：每 30 分钟 [${defaultTimezone}]`);
	console.log(`[调度器] 扫描器缓存清理：${scannerCleanupEnabled ? scannerCleanupCron : '已禁用'} [${defaultTimezone}]`);
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
		} else if (jobId === String(SYSTEM_SCANNER_CLEANUP_ID) || jobId === 'scanner-cache-cleanup') {
			runScannerCacheCleanupJob('manual', scannerCleanupAllEnvs);
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
	const scannerCleanupCron = await getScannerCleanupCron();
	const scheduleCleanupEnabled = await getScheduleCleanupEnabled();
	const eventCleanupEnabled = await getEventCleanupEnabled();
	const scannerCleanupEnabled = await getScannerCleanupEnabled();

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
		},
		{
			id: SYSTEM_SCANNER_CLEANUP_ID,
			type: 'system_cleanup' as const,
			name: '扫描器缓存清理',
			description: '移除扫描器漏洞数据库缓存以释放磁盘空间',
			cronExpression: scannerCleanupCron,
			nextRun: scannerCleanupEnabled ? getNextRun(scannerCleanupCron)?.toISOString() ?? null : null,
			isSystem: true,
			enabled: scannerCleanupEnabled
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
