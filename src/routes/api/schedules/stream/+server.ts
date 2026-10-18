/**
 * Schedules Stream API - Real-time schedule updates via SSE
 *
 * GET /api/schedules/stream - Server-Sent Events stream for schedule updates
 */

import type { RequestHandler } from './$types';
import {
	getAllAutoUpdateSettings,
	getAllAutoUpdateGitStacks,
	getAllEnvUpdateCheckSettings,
	getAllImagePruneSettings,
	getBackupConfigs,
	getBackupDestination,
	getBackupDestinations,
	getLastExecutionForSchedule,
	getRecentExecutionsForSchedule,
	getEnvironment,
	getEnvironmentTimezone,
	type VulnerabilityCriteria
} from '$lib/server/db';
import { getNextRun, getSystemSchedules } from '$lib/server/scheduler';
import { getGlobalScannerDefaults, getScannerSettingsWithDefaults } from '$lib/server/scanner';
import { authorize } from '$lib/server/authorize';
import type { ScheduleInfo } from '../+server';

async function getSchedulesData(): Promise<ScheduleInfo[]> {
	const schedules: ScheduleInfo[] = [];

	// Pre-fetch global scanner defaults ONCE (CLI args are global, not per-environment)
	const globalScannerDefaults = await getGlobalScannerDefaults();

	// Get container auto-update schedules
	const containerSettings = await getAllAutoUpdateSettings();
	const containerSchedules = await Promise.all(
		containerSettings.map(async (setting) => {
			const [env, lastExecution, recentExecutions, scannerSettings, timezone] = await Promise.all([
				setting.environmentId ? getEnvironment(setting.environmentId) : null,
				getLastExecutionForSchedule('container_update', setting.id),
				getRecentExecutionsForSchedule('container_update', setting.id, 5),
				getScannerSettingsWithDefaults(setting.environmentId ?? undefined, globalScannerDefaults),
				setting.environmentId ? getEnvironmentTimezone(setting.environmentId) : 'UTC'
			]);
			const isEnabled = setting.enabled ?? false;
			const nextRun = isEnabled && setting.cronExpression ? getNextRun(setting.cronExpression, timezone) : null;
			const envHasScanning = scannerSettings.scanner !== 'none';

			return {
				id: setting.id,
				type: 'container_update' as const,
				name: `更新容器: ${setting.containerName}`,
				entityName: setting.containerName,
				environmentId: setting.environmentId ?? null,
				environmentName: env?.name ?? null,
				enabled: isEnabled,
				scheduleType: setting.scheduleType ?? 'daily',
				cronExpression: setting.cronExpression ?? null,
				nextRun: nextRun?.toISOString() ?? null,
				lastExecution: lastExecution ?? null,
				recentExecutions,
				isSystem: false,
				envHasScanning,
				vulnerabilityCriteria: setting.vulnerabilityCriteria ?? null
			};
		})
	);
	schedules.push(...containerSchedules);

	// Get git stack auto-sync schedules
	const gitStacks = await getAllAutoUpdateGitStacks();
	const gitSchedules = await Promise.all(
		gitStacks.map(async (stack) => {
			const [env, lastExecution, recentExecutions, timezone] = await Promise.all([
				stack.environmentId ? getEnvironment(stack.environmentId) : null,
				getLastExecutionForSchedule('git_stack_sync', stack.id),
				getRecentExecutionsForSchedule('git_stack_sync', stack.id, 5),
				stack.environmentId ? getEnvironmentTimezone(stack.environmentId) : 'UTC'
			]);
			const isEnabled = stack.autoUpdate ?? false;
			const nextRun = isEnabled && stack.autoUpdateCron ? getNextRun(stack.autoUpdateCron, timezone) : null;

			return {
				id: stack.id,
				type: 'git_stack_sync' as const,
				name: `Git 同步: ${stack.stackName}`,
				entityName: stack.stackName,
				environmentId: stack.environmentId ?? null,
				environmentName: env?.name ?? null,
				enabled: isEnabled,
				scheduleType: stack.autoUpdateSchedule ?? 'daily',
				cronExpression: stack.autoUpdateCron ?? null,
				nextRun: nextRun?.toISOString() ?? null,
				lastExecution: lastExecution ?? null,
				recentExecutions,
				isSystem: false
			};
		})
	);
	schedules.push(...gitSchedules);

	// Get environment update check schedules
	const envUpdateCheckConfigs = await getAllEnvUpdateCheckSettings();
	const envUpdateCheckSchedules = await Promise.all(
		envUpdateCheckConfigs.map(async ({ envId, settings }) => {
			const [env, lastExecution, recentExecutions, scannerSettings, timezone] = await Promise.all([
				getEnvironment(envId),
				getLastExecutionForSchedule('env_update_check', envId),
				getRecentExecutionsForSchedule('env_update_check', envId, 5),
				getScannerSettingsWithDefaults(envId, globalScannerDefaults),
				getEnvironmentTimezone(envId)
			]);
			const isEnabled = settings.enabled ?? false;
			const nextRun = isEnabled && settings.cron ? getNextRun(settings.cron, timezone) : null;
			const envHasScanning = scannerSettings.scanner !== 'none';

			// Build description based on autoUpdate and scanning status
			let description: string;
			if (settings.autoUpdate) {
				description = envHasScanning ? '检查、扫描并自动更新容器' : '检查并自动更新容器';
			} else {
				description = '检查容器更新 (仅通知)';
			}

			return {
				id: envId,
				type: 'env_update_check' as const,
				name: `更新环境：${env?.name || '未知环境'}`,
				entityName: env?.name || 'Unknown',
				description,
				environmentId: envId,
				environmentName: env?.name ?? null,
				enabled: isEnabled,
				scheduleType: 'custom',
				cronExpression: settings.cron ?? null,
				nextRun: nextRun?.toISOString() ?? null,
				lastExecution: lastExecution ?? null,
				recentExecutions,
				isSystem: false,
				autoUpdate: settings.autoUpdate,
				envHasScanning,
				vulnerabilityCriteria: settings.autoUpdate ? (settings.vulnerabilityCriteria ?? null) : null
			};
		})
	);
	schedules.push(...envUpdateCheckSchedules);

	// Get image prune schedules
	const imagePruneConfigs = await getAllImagePruneSettings();
	const imagePruneSchedules = await Promise.all(
		imagePruneConfigs.map(async ({ envId, settings }) => {
			const [env, lastExecution, recentExecutions, timezone] = await Promise.all([
				getEnvironment(envId),
				getLastExecutionForSchedule('image_prune', envId),
				getRecentExecutionsForSchedule('image_prune', envId, 5),
				getEnvironmentTimezone(envId)
			]);
			const isEnabled = settings.enabled ?? false;
			const nextRun = isEnabled && settings.cronExpression ? getNextRun(settings.cronExpression, timezone) : null;

			// Build description based on prune mode
		const description = settings.pruneMode === 'all'
				? '清理所有未使用的镜像'
				: '仅清理悬空镜像';

			return {
				id: envId,
				type: 'image_prune' as const,
				name: `清理镜像：${env?.name || '未知环境'}`,
				entityName: env?.name || 'Unknown',
				description,
				environmentId: envId,
				environmentName: env?.name ?? null,
				enabled: isEnabled,
				scheduleType: 'custom',
				cronExpression: settings.cronExpression ?? null,
				nextRun: nextRun?.toISOString() ?? null,
				lastExecution: lastExecution ?? null,
				recentExecutions,
				isSystem: false,
				pruneMode: settings.pruneMode
			};
		})
	);
	schedules.push(...imagePruneSchedules);

	// Get backup schedules
	const allBackupConfigs = await getBackupConfigs();
	const backupSchedules = await Promise.all(
		allBackupConfigs
			.filter(c => c.schedule)
			.map(async (config) => {
				const [env, dest, lastExecution, recentExecutions] = await Promise.all([
					config.environmentId ? getEnvironment(config.environmentId) : null,
					getBackupDestination(config.destinationId),
					getLastExecutionForSchedule('backup', config.id),
					getRecentExecutionsForSchedule('backup', config.id, 5)
				]);
				const timezone = config.environmentId ? await getEnvironmentTimezone(config.environmentId) : 'UTC';
				const isEnabled = config.enabled ?? false;
				const nextRun = isEnabled && config.schedule ? getNextRun(config.schedule, timezone) : null;

				return {
					id: config.id,
					type: 'backup' as const,
					name: `备份: ${config.targetName}`,
					entityName: config.targetName,
					description: `将 ${config.type} 备份至 ${dest?.name || '未知目标存储位置'}`,
					environmentId: config.environmentId,
					environmentName: env?.name ?? null,
					enabled: isEnabled,
					scheduleType: 'custom',
					cronExpression: config.schedule ?? null,
					nextRun: nextRun?.toISOString() ?? null,
					lastExecution: lastExecution ?? null,
					recentExecutions,
					isSystem: false
				};
			})
	);
	schedules.push(...backupSchedules);

	// Get repo maintenance schedules (prune + check from destination policies)
	const allDestinations = await getBackupDestinations();
	for (const dest of allDestinations) {
		const policies = dest.policies ? (() => { try { return JSON.parse(dest.policies); } catch { return {}; } })() : {};
		if (policies.pruneEnabled && policies.pruneSchedule) {
			const [lastExec, recentExecs] = await Promise.all([
				getLastExecutionForSchedule('repo_prune', dest.id),
				getRecentExecutionsForSchedule('repo_prune', dest.id, 5)
			]);
			const nextRun = getNextRun(policies.pruneSchedule, 'UTC');
			const maxUnused = policies.pruneMaxUnused ?? '10';
			schedules.push({
				id: dest.id + 100000,
				type: 'repo_prune' as any,
				name: `清理: ${dest.name}`,
				entityName: dest.name,
				description: `清理 ${dest.name} 内未使用的数据 (最大保留未使用数据 ${maxUnused}%)`,
				maxUnused: String(maxUnused),
				environmentId: null,
				environmentName: null,
				enabled: true,
				scheduleType: 'custom',
				cronExpression: policies.pruneSchedule,
				nextRun: nextRun?.toISOString() ?? null,
				lastExecution: lastExec ?? null,
				recentExecutions: recentExecs,
				isSystem: false
			});
		}
		if (policies.checkEnabled && policies.checkSchedule) {
			const [lastExec, recentExecs] = await Promise.all([
				getLastExecutionForSchedule('repo_check', dest.id),
				getRecentExecutionsForSchedule('repo_check', dest.id, 5)
			]);
			const nextRun = getNextRun(policies.checkSchedule, 'UTC');
			schedules.push({
				id: dest.id + 200000,
				type: 'repo_check' as any,
				name: `校验: ${dest.name}`,
				entityName: dest.name,
				description: `检查 ${dest.name} 的数据完整性`,
				environmentId: null,
				environmentName: null,
				enabled: true,
				scheduleType: 'custom',
				cronExpression: policies.checkSchedule,
				nextRun: nextRun?.toISOString() ?? null,
				lastExecution: lastExec ?? null,
				recentExecutions: recentExecs,
				isSystem: false
			});
		}
		if (policies.verifyEnabled && policies.verifySchedule) {
			const [lastExec, recentExecs] = await Promise.all([
				getLastExecutionForSchedule('repo_verify', dest.id),
				getRecentExecutionsForSchedule('repo_verify', dest.id, 5)
			]);
			const nextRun = getNextRun(policies.verifySchedule, 'UTC');
			const subset = policies.verifyDataSubset || '5%';
			schedules.push({
				id: dest.id + 300000,
				type: 'repo_verify' as any,
				name: `验证: ${dest.name}`,
				entityName: dest.name,
				description: `验证 ${dest.name} 中 ${subset} 的数据`,
				dataSubset: subset,
				environmentId: null,
				environmentName: null,
				enabled: true,
				scheduleType: 'custom',
				cronExpression: policies.verifySchedule,
				nextRun: nextRun?.toISOString() ?? null,
				lastExecution: lastExec ?? null,
				recentExecutions: recentExecs,
				isSystem: false
			});
		}
	}

	// Get system schedules
	const systemSchedules = await getSystemSchedules();
	const sysSchedules = await Promise.all(
		systemSchedules.map(async (sys) => {
			const [lastExecution, recentExecutions] = await Promise.all([
				getLastExecutionForSchedule(sys.type, sys.id),
				getRecentExecutionsForSchedule(sys.type, sys.id, 5)
			]);

			return {
				id: sys.id,
				type: sys.type,
				name: sys.name,
				entityName: sys.name,
				description: sys.description,
				environmentId: null,
				environmentName: null,
				enabled: sys.enabled,
				scheduleType: 'custom',
				cronExpression: sys.cronExpression,
				nextRun: sys.nextRun,
				lastExecution: lastExecution ?? null,
				recentExecutions,
				isSystem: true
			};
		})
	);
	schedules.push(...sysSchedules);

	// Sort: system jobs last, then by name
	schedules.sort((a, b) => {
		if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;
		return a.name.localeCompare(b.name);
	});

	return schedules;
}

/**
 * @openapi
 * summary: Server-Sent Events stream that polls and pushes schedule updates (same shape as GET /api/schedules)
 * resp-200: text/event-stream response, periodically emitting the current schedule list as SSE "data:" messages
 * resp-403: Permission denied (RBAC 'schedules:view' missing)
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('schedules', 'view')) {
		return new Response(JSON.stringify({ error: '权限不足' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let controllerClosed = false;
	let intervalId: ReturnType<typeof setInterval> | null = null;
	let isPolling = false;
	let initialDataSent = false;

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			console.log('[定时任务流] 新连接已打开');

			const safeEnqueue = (data: string): boolean => {
				if (controllerClosed) {
					return false;
				}
				try {
					controller.enqueue(encoder.encode(data));
					return true;
				} catch (err) {
					console.log('[定时任务流] 发送数据时连接已关闭，正在清理');
					controllerClosed = true;
					if (intervalId) {
						clearInterval(intervalId);
						intervalId = null;
					}
					return false;
				}
			};

			if (!safeEnqueue(`event: connected\ndata: {}\n\n`)) {
				return;
			}

			let retryCount = 0;
			const maxRetries = 2;

			while (!initialDataSent && retryCount <= maxRetries && !controllerClosed) {
				try {
					const schedules = await getSchedulesData();

					if (controllerClosed) {
						console.log('[定时任务流] 发送初始数据前连接已关闭');
						return;
					}

					if (safeEnqueue(`event: schedules\ndata: ${JSON.stringify({ schedules })}\n\n`)) {
						initialDataSent = true;
						console.log('[定时任务流] 初始数据发送成功');
					} else {
						console.log('[定时任务流] 无法发送初始数据，连接已关闭');
						return;
					}
				} catch (error) {
					console.error(`[定时任务流] 获取初始定时任务失败（第 ${retryCount + 1} 次重试）:`, error);
					retryCount++;

					if (retryCount > maxRetries) {
						safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: String(error), fatal: true })}\n\n`);
						return;
					}

					await new Promise(resolve => setTimeout(resolve, 500));
				}
			}

			if (!initialDataSent) {
				console.log('[定时任务流] 未成功发送初始数据，不启动轮询');
				return;
			}

			intervalId = setInterval(async () => {
				if (isPolling || controllerClosed) {
					if (controllerClosed && intervalId) {
						clearInterval(intervalId);
						intervalId = null;
					}
					return;
				}

				isPolling = true;
				try {
					const schedules = await getSchedulesData();
					safeEnqueue(`event: schedules\ndata: ${JSON.stringify({ schedules })}\n\n`);
				} catch (error) {
					console.error('[定时任务流] 轮询时获取定时任务失败:', error);
				} finally {
					isPolling = false;
				}
			}, 2000);
		},
		cancel() {
			console.log('[定时任务流] 连接已取消，正在清理');
			controllerClosed = true;
			if (intervalId) {
				clearInterval(intervalId);
				intervalId = null;
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
