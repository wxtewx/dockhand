/**
 * Schedule Execution Detail API
 *
 * GET /api/schedules/executions/[id] - Returns execution details including logs
 * DELETE /api/schedules/executions/[id] - Delete a schedule execution
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getScheduleExecution, deleteScheduleExecution } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const id = parseInt(params.id, 10);
		if (isNaN(id)) {
			return json({ error: '无效的执行 ID' }, { status: 400 });
		}

		const execution = await getScheduleExecution(id);
		if (!execution) {
			return json({ error: '未找到执行记录' }, { status: 404 });
		}

		return json(execution);
	} catch (error: any) {
		console.error('获取定时任务执行记录失败:', error);
		return json({ error: error.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('schedules', 'edit')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id, 10);
		if (isNaN(id)) {
			return json({ error: '无效的执行 ID' }, { status: 400 });
		}

		await deleteScheduleExecution(id);

		return json({ success: true });
	} catch (error: any) {
		console.error('删除定时任务执行记录失败:', error);
		return json({ error: error.message }, { status: 500 });
	}
};
