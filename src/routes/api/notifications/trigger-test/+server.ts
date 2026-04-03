import { json, type RequestHandler } from '@sveltejs/kit';
import { sendEventNotification, sendEnvironmentNotification } from '$lib/server/notifications';
import { NOTIFICATION_EVENT_TYPES, type NotificationEventType } from '$lib/server/db';

/**
 * Test endpoint to trigger notifications for any event type.
 * This is intended for development/testing purposes only.
 *
 * POST /api/notifications/trigger-test
 * Body: {
 *   eventType: string,
 *   environmentId?: number,
 *   payload: { title: string, message: string, type?: string }
 * }
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { eventType, environmentId, payload } = body;

		if (!eventType) {
			return json({ error: 'eventType 为必填项' }, { status: 400 });
		}

		if (!payload || !payload.title || !payload.message) {
			return json({ error: '必须提供包含 title 和 message 的 payload' }, { status: 400 });
		}

		// Validate event type - NOTIFICATION_EVENT_TYPES is array of {id, label, ...}
		const validEventIds = NOTIFICATION_EVENT_TYPES.map(e => e.id);
		if (!validEventIds.includes(eventType)) {
			return json({
				error: `无效的事件类型：${eventType}`,
				validTypes: validEventIds
			}, { status: 400 });
		}

		// Determine if this is a system event or environment event
		const isSystemEvent = eventType === 'license_expiring';

		let result;

		if (isSystemEvent) {
			// System events don't have an environment
			result = await sendEventNotification(
				eventType as NotificationEventType,
				{
					title: payload.title,
					message: payload.message,
					type: payload.type || 'info'
				}
			);
		} else if (environmentId) {
			// Environment-scoped events
			result = await sendEventNotification(
				eventType as NotificationEventType,
				{
					title: payload.title,
					message: payload.message,
					type: payload.type || 'info'
				},
				environmentId
			);
		} else {
			return json({
				error: '非系统事件必须提供 environmentId'
			}, { status: 400 });
		}

		return json({
			success: result.success,
			sent: result.sent,
			eventType,
			environmentId: isSystemEvent ? null : environmentId
		});
	} catch (error) {
		console.error('[通知测试] 错误:', error);
		return json({
			error: error instanceof Error ? error.message : '未知错误'
		}, { status: 500 });
	}
};

/**
 * GET endpoint to list all available event types
 */
export const GET: RequestHandler = async () => {
	return json({
		eventTypes: NOTIFICATION_EVENT_TYPES,
		categories: {
			容器: [
				'container_started',
				'container_stopped',
				'container_restarted',
				'container_exited',
				'container_unhealthy',
				'container_oom',
				'container_updated',
				'image_pulled',
			],
			自动更新: [
				'auto_update_success',
				'auto_update_failed',
				'auto_update_blocked',
			],
			"Git 栈": [
				'git_sync_success',
				'git_sync_failed',
				'git_sync_skipped',
			],
			栈: [
				'stack_started',
				'stack_stopped',
				'stack_deployed',
				'stack_deploy_failed',
			],
			安全: [
				'vulnerability_critical',
				'vulnerability_high',
				'vulnerability_any',
			],
			系统: [
				'environment_offline',
				'environment_online',
				'disk_space_warning',
				'license_expiring',
			],
		}
	});
};
