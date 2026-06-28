/**
 * Git Stack Auto-Sync Task
 *
 * Handles automatic syncing and deploying of git-based compose stacks.
 */

import type { ScheduleTrigger } from '../../db';
import {
	createScheduleExecution,
	updateScheduleExecution,
	appendScheduleExecutionLog
} from '../../db';
import { deployGitStack } from '../../git';
import { sendEventNotification } from '../../notifications';

/**
 * Execute a git stack sync.
 */
export async function runGitStackSync(
	stackId: number,
	stackName: string,
	environmentId: number | null | undefined,
	triggeredBy: ScheduleTrigger
): Promise<void> {
	const startTime = Date.now();

	// Create execution record
	const execution = await createScheduleExecution({
		scheduleType: 'git_stack_sync',
		scheduleId: stackId,
		environmentId: environmentId ?? null,
		entityName: stackName,
		triggeredBy,
		status: 'running'
	});

	await updateScheduleExecution(execution.id, {
		startedAt: new Date().toISOString()
	});

	const log = (message: string) => {
		console.log(`[Git 同步] ${message}`);
		appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${message}`);
	};

	try {
		log(`开始同步堆栈：${stackName}`);

		// Deploy the git stack (only if there are changes)
		const result = await deployGitStack(stackId, { force: false });

		const envId = environmentId ?? undefined;

		if (result.success) {
			if (result.skipped) {
				log(`未检测到堆栈变更：${stackName}，跳过重新部署`);

				// Send notification for skipped sync
				await sendEventNotification('git_sync_skipped', {
					title: '已跳过 Git 同步',
					message: `堆栈 "${stackName}" 同步已跳过：未检测到变更`,
					type: 'info'
				}, envId);
			} else {
				log(`堆栈部署成功：${stackName}`);

				// Send notification for successful sync
				await sendEventNotification('git_sync_success', {
					title: 'Git 堆栈已部署',
					message: `堆栈 "${stackName}" 已同步并成功部署`,
					type: 'success'
				}, envId);
			}
			if (result.output) log(result.output);

			await updateScheduleExecution(execution.id, {
				status: result.skipped ? 'skipped' : 'success',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: { output: result.output }
			});
		} else {
			throw new Error(result.error || '部署失败');
		}
	} catch (error: any) {
		log(`错误：${error.message}`);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: error.message
		});

		// Send notification for failed sync
		const envId = environmentId ?? undefined;
		await sendEventNotification('git_sync_failed', {
			title: 'Git 同步失败',
			message: `堆栈 "${stackName}" 同步失败：${error.message}`,
			type: 'error'
		}, envId);
	}
}
