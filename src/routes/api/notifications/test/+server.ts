import { json } from '@sveltejs/kit';
import { testNotification } from '$lib/server/notifications';
import { authorize } from '$lib/server/authorize';
import type { RequestHandler } from './$types';

// Test notification with provided config (without saving)
/**
 * @openapi
 * summary: Send a test notification using an ad-hoc config supplied in the body (nothing is saved)
 * body: {type:string!, name:string, config:{host:string, port:integer, secure:boolean, username:string, password:string, from_email:string, from_name:string, to_emails:array<string>, urls:array<string>}}
 * body-example: {"type":"smtp","name":"Test","config":{"host":"smtp.example.com","port":587,"from_email":"dockhand@example.com","to_emails":["ops@example.com"],"password":"***"}}
 * resp-200: {success:boolean!, message:string, error:string}
 * resp-200-example: {"success":true,"message":"Test notification sent successfully"}
 * resp-400: Missing/invalid fields — type and config required; SMTP needs host/from_email/to_emails; Apprise needs at least one URL
 * resp-403: Permission denied (requires the settings:edit permission)
 * resp-500: Failed to test notification
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const data = await request.json();

		if (!data.type || !data.config) {
			return json({ error: '类型和配置为必填项' }, { status: 400 });
		}

		// Validate SMTP config
		if (data.type === 'smtp') {
			const config = data.config;
			if (!config.host || !config.from_email || !config.to_emails?.length) {
				return json({ error: '主机、发件邮箱和至少一个收件人为必填项' }, { status: 400 });
			}
		}

		// Validate Apprise config
		if (data.type === 'apprise') {
			const config = data.config;
			if (!config.urls?.length) {
				return json({ error: '至少需要填写一条 Webhook 地址' }, { status: 400 });
			}
		}

		// Create a fake notification setting object for testing
		const setting = {
			id: 0,
			name: data.name || 'Test',
			type: data.type as 'smtp' | 'apprise',
			enabled: true,
			config: data.config,
			eventTypes: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		const result = await testNotification(setting);

		return json({
			success: result.success,
			message: result.success ? '测试通知发送成功' : undefined,
			error: result.error || (result.success ? undefined : '发送测试通知失败')
		});
	} catch (error: any) {
		console.error('测试通知失败:', error);
		return json({
			success: false,
			error: error.message || '测试通知失败'
		}, { status: 500 });
	}
};
