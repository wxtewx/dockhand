import { json } from '@sveltejs/kit';
import {
	getEnvironmentNotifications,
	createEnvironmentNotification,
	getEnvironment,
	getNotificationSettings,
	type NotificationEventType
} from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import type { RequestHandler } from './$types';

// GET /api/environments/[id]/notifications - List all notification configurations for an environment
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('notifications', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	const envId = parseInt(params.id);
	if (isNaN(envId)) {
		return json({ error: '环境 ID 无效' }, { status: 400 });
	}

	const env = await getEnvironment(envId);
	if (!env) {
		return json({ error: '环境不存在' }, { status: 404 });
	}

	try {
		const notifications = await getEnvironmentNotifications(envId);
		return json(notifications);
	} catch (error) {
		console.error('获取环境通知失败:', error);
		return json({ error: '获取环境通知失败' }, { status: 500 });
	}
};

// POST /api/environments/[id]/notifications - Add a notification channel to an environment
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('notifications', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	const envId = parseInt(params.id);
	if (isNaN(envId)) {
		return json({ error: '环境 ID 无效' }, { status: 400 });
	}

	const env = await getEnvironment(envId);
	if (!env) {
		return json({ error: '环境不存在' }, { status: 404 });
	}

	try {
		const body = await request.json();
		const { notificationId, enabled, eventTypes } = body;

		if (!notificationId) {
			return json({ error: 'notificationId 为必填项' }, { status: 400 });
		}

		const notification = await createEnvironmentNotification({
			environmentId: envId,
			notificationId,
			enabled: enabled !== false,
			eventTypes: eventTypes as NotificationEventType[]
		});

		return json(notification);
	} catch (error: any) {
		console.error('创建环境通知失败:', error);
		if (error.message?.includes('UNIQUE constraint failed')) {
			return json({ error: '该通知渠道已为此环境配置' }, { status: 409 });
		}
		return json({ error: error.message || '创建环境通知失败' }, { status: 500 });
	}
};
