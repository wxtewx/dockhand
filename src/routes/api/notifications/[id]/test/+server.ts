import { json } from '@sveltejs/kit';
import { getNotificationSetting } from '$lib/server/db';
import { testNotification } from '$lib/server/notifications';
import type { RequestHandler } from './$types';

/**
 * @openapi
 * summary: Send a test notification through an already-saved notification setting
 * path: id:integer! Notification setting ID (from GET /api/notifications)
 * resp-200: {success:boolean!, message:string, error:string}
 * resp-200-example: {"success":true,"message":"Test notification sent successfully"}
 * resp-400: Invalid ID (not a number)
 * resp-404: Notification setting not found
 * resp-500: Failed to test notification
 */
export const POST: RequestHandler = async ({ params }) => {
	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的 ID' }, { status: 400 });
		}

		const setting = await getNotificationSetting(id);
		if (!setting) {
			return json({ error: '未找到通知设置' }, { status: 404 });
		}

		const result = await testNotification(setting);

		return json({
			success: result.success,
			message: result.success
				? '测试通知发送成功'
				: '发送测试通知失败',
			error: result.error
		});
	} catch (error: any) {
		console.error('测试通知失败:', error);
		return json({
			success: false,
			error: error.message || '测试通知失败'
		}, { status: 500 });
	}
};
