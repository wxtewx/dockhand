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
/**
 * @openapi
 * summary: Get one notification-channel link for an environment
 * path: id:integer! Environment id (from GET /api/environments)
 * path: notificationId:integer! Notification channel id (from GET /api/notifications)
 * resp-200: {id:integer!, notificationId:integer!, enabled:boolean!, eventTypes:array<string>}
 * resp-400: Invalid id or notificationId
 * resp-403: Permission denied (RBAC 'notifications:view' missing)
 * resp-404: Environment not found, or no such notification link for this environment
 * resp-500: Unexpected error while loading the notification link
 */
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
	const envAccessDenied = await auth.requireEnvAccess(envId);
	if (envAccessDenied) return envAccessDenied;

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
/**
 * @openapi
 * summary: Update a notification-channel link (enabled state and/or event type filter)
 * path: id:integer! Environment id (from GET /api/environments)
 * path: notificationId:integer! Notification channel id (from GET /api/notifications)
 * body: {enabled:boolean, eventTypes:array<string>}
 * body-example: {"enabled":false}
 * resp-200: {id:integer!, notificationId:integer!, enabled:boolean!, eventTypes:array<string>}
 * resp-400: Invalid id or notificationId
 * resp-403: Permission denied (RBAC 'notifications:edit' missing)
 * resp-404: Environment not found, or no such notification link for this environment
 * resp-500: Unexpected error while updating the notification link
 */
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
	const envAccessDenied = await auth.requireEnvAccess(envId);
	if (envAccessDenied) return envAccessDenied;

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
/**
 * @openapi
 * summary: Remove a notification-channel link from an environment
 * path: id:integer! Environment id (from GET /api/environments)
 * path: notificationId:integer! Notification channel id (from GET /api/notifications)
 * resp-200: {success:boolean!}
 * resp-400: Invalid id or notificationId
 * resp-403: Permission denied (RBAC 'notifications:delete' missing)
 * resp-404: No such notification link for this environment
 * resp-500: Unexpected error while deleting the notification link
 */
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
	const envAccessDenied = await auth.requireEnvAccess(envId);
	if (envAccessDenied) return envAccessDenied;

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
