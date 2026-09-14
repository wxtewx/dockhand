/**
 * Repository maintenance tasks — scheduled prune, check, auto-unlock.
 * Run per-destination based on destination policies.
 */

import { runRepoTask, verifyBackup } from '$lib/server/backups';
import { parsePoliciesJson } from '$lib/server/backups/helpers';
import { getBackupDestination } from '$lib/server/db';
import { createScheduleExecution, updateScheduleExecution, appendScheduleExecutionLog } from '$lib/server/db';
import { sendEventNotification } from '$lib/server/notifications';

async function runMaintenanceTask(
	destinationId: number,
	destinationName: string,
	task: 'prune' | 'check',
	scheduleType: 'repo_prune' | 'repo_check',
	triggeredBy: 'cron' | 'manual' = 'cron'
): Promise<void> {
	const label = task === 'prune' ? '空间清理' : '仓库检查';
	const execution = await createScheduleExecution({
		scheduleType,
		scheduleId: destinationId,
		environmentId: null,
		entityName: `${label}: ${destinationName}`,
		triggeredBy,
		status: 'running'
	});
	await updateScheduleExecution(execution.id, { startedAt: new Date().toISOString() });
	const startTime = Date.now();
	const log = (msg: string) => appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${msg}`);

	try {
		const dest = await getBackupDestination(destinationId);
		if (!dest) throw new Error('未找到该备份存储位置');

		console.log(`[备份] 仓库${task === 'prune' ? '空间清理' : '检查'}任务开始："${destinationName}" (触发方式：${triggeredBy})`);

		// Auto-unlock before task if enabled in policies
		const policies = parsePoliciesJson(dest.policies); // (audit #26/#37) safe-degrade + log on malformed
		if (policies.autoUnlock) {
			log('自动解锁仓库...');
			await runRepoTask(destinationId, 'unlock', { staleOnly: true }); // plain unlock: never wipe a live foreign lock on a shared repo
		}

		log(`正在执行 ${task}...`);
		const result = await runRepoTask(destinationId, task);

		if (result.success) {
			log(`${label} 执行完成: ${result.output}`);
			console.log(`[备份] 仓库${task === 'prune' ? '空间清理' : '检查'}任务完成："${destinationName}"`);
			await updateScheduleExecution(execution.id, {
				status: 'success',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime
			});
			await sendEventNotification(`${scheduleType}_success` as 'repo_prune_success' | 'repo_check_success', {
				title: `${label} 执行完成 — ${destinationName}`,
				message: result.output || `${label} 执行成功`,
				type: 'success'
			});
		} else {
			throw new Error(result.error || `${label} 执行失败`);
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		log(`${label} 执行失败: ${msg}`);
		console.log(`[备份] 仓库${task === 'prune' ? '空间清理' : '检查'}任务失败："${destinationName}"：${msg}`);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: msg
		});
		await sendEventNotification(`${scheduleType}_failed` as 'repo_prune_failed' | 'repo_check_failed', {
			title: `${label} 执行失败 — ${destinationName}`,
			message: msg,
			type: 'error'
		});
	}
}

export async function runRepoPrune(
	destinationId: number,
	destinationName: string,
	triggeredBy: 'cron' | 'manual' = 'cron'
): Promise<void> {
	return runMaintenanceTask(destinationId, destinationName, 'prune', 'repo_prune', triggeredBy);
}

export async function runRepoCheck(
	destinationId: number,
	destinationName: string,
	triggeredBy: 'cron' | 'manual' = 'cron'
): Promise<void> {
	return runMaintenanceTask(destinationId, destinationName, 'check', 'repo_check', triggeredBy);
}

export async function runRepoVerify(
	destinationId: number,
	destinationName: string,
	dataSubset: string,
	triggeredBy: 'cron' | 'manual' = 'cron'
): Promise<void> {
	const execution = await createScheduleExecution({
		scheduleType: 'repo_verify',
		scheduleId: destinationId,
		environmentId: null,
		entityName: `数据校验: ${destinationName}`,
		triggeredBy,
		status: 'running'
	});
	await updateScheduleExecution(execution.id, { startedAt: new Date().toISOString() });
	const startTime = Date.now();
	const log = (msg: string) => appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${msg}`);

	try {
		const dest = await getBackupDestination(destinationId);
		if (!dest) throw new Error('未找到该备份存储位置');

		console.log(`[备份] 仓库数据校验任务开始："${destinationName}" (触发方式：${triggeredBy}，校验范围：${dataSubset})`);

		const policies = parsePoliciesJson(dest.policies); // (audit #26/#37) safe-degrade + log on malformed
		if (policies.autoUnlock) {
			log('自动解锁仓库...');
			await runRepoTask(destinationId, 'unlock', { staleOnly: true }); // plain unlock: never wipe a live foreign lock on a shared repo
		}

		log(`正在校验 ${dataSubset} 的数据...`);
		const result = await verifyBackup(destinationId, {
			dataSubset,
			onProgress: (m) => log(m)
		});

		if (result.success) {
			log(`数据校验完成: ${result.output}`);
			console.log(`[备份] 仓库数据校验任务完成："${destinationName}"`);
			await updateScheduleExecution(execution.id, {
				status: 'success',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime
			});
			await sendEventNotification('repo_verify_success', {
				title: `数据校验完成 — ${destinationName}`,
				message: `${dataSubset} 范围数据校验成功`,
				type: 'success'
			});
		} else {
			throw new Error(result.error || '数据校验失败');
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		log(`数据校验失败: ${msg}`);
		console.log(`[备份] 仓库数据校验任务失败："${destinationName}"：${msg}`);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: msg
		});
		await sendEventNotification('repo_verify_failed', {
			title: `数据校验失败 — ${destinationName}`,
			message: msg,
			type: 'error'
		});
	}
}
