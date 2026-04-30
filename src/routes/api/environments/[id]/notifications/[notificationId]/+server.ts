import { json } from '@sveltejs/kit';
import {
	getEnvironmentNotification,
	updateEnvironmentNotification,
	deleteEnvironmentNotification,
	getEnvironment,
	type NotificationEventType
} from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import type { RequestHandler } from './$types';

// GET /api/environments/[id]/notifications/[notificationId] - Get a specific environment notification
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('notifications', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	const envId = parseInt(params.id);
	const notifId = parseInt(params.notificationId);
	if (isNaN(envId) || isNaN(notifId)) {
		return json({ error: '无效的 ID' }, { status: 400 });
	}

	const env = await getEnvironment(envId);
	if (!env) {
		return json({ error: '环境不存在' }, { status: 404 });
	}

	try {
		const notification = await getEnvironmentNotification(envId, notifId);
		if (!notification) {
			return json({ error: '环境通知不存在' }, { status: 404 });
		}
		return json(notification);
	} catch (error) {
		console.error('获取环境通知失败:', error);
		return json({ error: '获取环境通知失败' }, { status: 500 });
	}
};

// PUT /api/environments/[id]/notifications/[notificationId] - Update an environment notification
export const PUT: RequestHandler = async ({ params, request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('notifications', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	const envId = parseInt(params.id);
	const notifId = parseInt(params.notificationId);
	if (isNaN(envId) || isNaN(notifId)) {
		return json({ error: '无效的 ID' }, { status: 400 });
	}

	const env = await getEnvironment(envId);
	if (!env) {
		return json({ error: '环境不存在' }, { status: 404 });
	}

	try {
		const body = await request.json();
		const { enabled, eventTypes } = body;

		const notification = await updateEnvironmentNotification(envId, notifId, {
			enabled,
			eventTypes: eventTypes as NotificationEventType[]
		});

		if (!notification) {
			return json({ error: '环境通知不存在' }, { status: 404 });
		}

		return json(notification);
	} catch (error: any) {
		console.error('更新环境通知失败:', error);
		return json({ error: error.message || '更新环境通知失败' }, { status: 500 });
	}
};

// DELETE /api/environments/[id]/notifications/[notificationId] - Remove a notification from an environment
export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('notifications', 'delete')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	const envId = parseInt(params.id);
	const notifId = parseInt(params.notificationId);
	if (isNaN(envId) || isNaN(notifId)) {
		return json({ error: '无效的 ID' }, { status: 400 });
	}

	try {
		const deleted = await deleteEnvironmentNotification(envId, notifId);
		if (!deleted) {
			return json({ error: '环境通知不存在' }, { status: 404 });
		}
		return json({ success: true });
	} catch (error: any) {
		console.error('删除环境通知失败:', error);
		return json({ error: error.message || '删除环境通知失败' }, { status: 500 });
	}
};
