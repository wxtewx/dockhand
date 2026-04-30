import { json } from '@sveltejs/kit';
import { testNotification } from '$lib/server/notifications';
import { authorize } from '$lib/server/authorize';
import type { RequestHandler } from './$types';

// Test notification with provided config (without saving)
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
				return json({ error: '至少需要一个 Apprise URL' }, { status: 400 });
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
