/**
 * Scheduled container start and stop. A run starts or stops one container
 * by name, records the execution, and notifies through its own event types; the
 * Docker start/stop events it causes are marked expected so they do not notify a
 * second time as an ordinary start or stop.
 */
import type { ScheduleTrigger } from '../../db';
import {
	getScheduledContainerActionById,
	getScheduledContainerActions,
	upsertScheduledContainerAction,
	deleteScheduledContainerActionById,
	recordScheduledContainerActionRun,
	createScheduleExecution,
	updateScheduleExecution,
	appendScheduleExecutionLog,
	getEnvironments
} from '../../db';
import { listContainers, startContainer, stopContainer } from '../../docker';
import { sendEventNotification } from '../../notifications';
import { expectedEvents, EXPECTED_EVENT_TTL_MS } from '../../expected-events-core';
import { isSystemContainer } from './update-utils';
import { actionDecision, planLabelSync, type ScheduledAction } from '../../scheduled-actions-core';

/** How long a scheduled stop's own events stay silenced: covers a slow graceful stop. */
const SCHEDULED_STOP_EVENT_TTL_MS = 10 * 60 * 1000;

/** Start or stop the container a schedule row names. */
export async function runScheduledContainerAction(
	rowId: number,
	action: ScheduledAction,
	triggeredBy: ScheduleTrigger
): Promise<void> {
	const row = await getScheduledContainerActionById(rowId);
	if (!row) return;
	const startTime = Date.now();
	const envId = row.environmentId;
	const containerName = row.containerName;

	const execution = await createScheduleExecution({
		scheduleType: action === 'start' ? 'container_start' : 'container_stop',
		scheduleId: rowId,
		environmentId: envId,
		entityName: containerName,
		triggeredBy,
		status: 'running'
	});
	await updateScheduleExecution(execution.id, { startedAt: new Date().toISOString() });

	const log = (message: string) => {
		console.log(`[定时 ${action === 'start' ? '启动' : '停止'}] ${message}`);
		appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${message}`);
	};
	const finish = (status: 'success' | 'skipped' | 'failed', errorMessage?: string) =>
		updateScheduleExecution(execution.id, {
			status,
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			...(errorMessage ? { errorMessage } : {})
		});

	try {
		const container = (await listContainers(true, envId)).find((c) => c.name === containerName);
		if (!container) {
			log(`未找到容器: ${containerName}`);
			await finish('skipped');
			return;
		}
		if (isSystemContainer(container.image)) {
			log(`${containerName} 是系统容器，不会按计划执行启动或停止操作`);
			await finish('skipped');
			return;
		}
		if (actionDecision(action, container.state) === 'already') {
			log(`${containerName} 已经 ${action === 'start' ? '正在运行' : '已停止'}（${container.state}）`);
			await finish('skipped');
			return;
		}

		log(`${action === 'start' ? '正在启动' : '正在停止'} ${containerName}`);
		// The events this causes are this run's own; it notifies below instead. A stop's
		// die/stop arrive only when the process exits, which a long stop_grace_period delays.
		if (action === 'start') expectedEvents.markExpected(container.id, Date.now(), EXPECTED_EVENT_TTL_MS, ['start']);
		else expectedEvents.markExpected(container.id, Date.now(), SCHEDULED_STOP_EVENT_TTL_MS);
		if (action === 'start') await startContainer(container.id, envId);
		else await stopContainer(container.id, envId);

		await recordScheduledContainerActionRun(rowId, action);
		log(`${containerName} ${action === 'start' ? '已启动' : '已停止'}`);
		await finish('success');
		await sendEventNotification(action === 'start' ? 'container_scheduled_start' : 'container_scheduled_stop', {
			title: action === 'start' ? '定时启动' : '定时停止',
			message: `容器 "${containerName}" 已按计划${action === 'start' ? '启动' : '停止'}`,
			type: 'info'
		}, envId);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log(`错误: ${message}`);
		await finish('failed', message);
		await sendEventNotification('container_scheduled_failed', {
			title: `定时${action === 'start' ? '启动' : '停止'} 失败`,
			message: `容器 "${containerName}" 无法按计划${action === 'start' ? '启动' : '停止'}：${message}`,
			type: 'error'
		}, envId);
	}
}

/**
 * Bring the schedule rows in line with every reachable environment's
 * dockhand.start.at / dockhand.stop.at labels. Returns the rows to register again
 * and the ids whose jobs must go; the caller owns the scheduler.
 */
export async function syncScheduledActionLabels(): Promise<{ changed: number[]; removed: number[] }> {
	const changed: number[] = [];
	const removed: number[] = [];
	for (const env of await getEnvironments()) {
		let containers;
		try {
			containers = await listContainers(true, env.id);
		} catch (error) {
			console.warn(`[定时任务] 无法读取 ${env.name} 的标签: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		const rows = await getScheduledContainerActions(env.id);
		const plan = planLabelSync(
			containers.map((c) => ({ name: c.name, image: c.image, labels: c.labels })),
			rows.map((r) => ({ id: r.id, containerName: r.containerName, source: r.source as 'ui' | 'label', startAt: r.startAt, stopAt: r.stopAt }))
		);
		for (const warning of plan.warnings) console.warn(`[定时任务] ${env.name}: ${warning}`);
		for (const upsert of plan.upserts) {
			// enabled is left as it is on an existing row, so a schedule switched off stays off.
			const row = await upsertScheduledContainerAction(upsert.containerName, env.id, { ...upsert, source: 'label' });
			changed.push(row.id);
		}
		for (const id of plan.deletes) {
			await deleteScheduledContainerActionById(id);
			removed.push(id);
		}
	}
	return { changed, removed };
}
