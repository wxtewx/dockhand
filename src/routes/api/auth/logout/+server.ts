import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { destroySession } from '$lib/server/auth';
import { authorize } from '$lib/server/authorize';
import { auditAuth } from '$lib/server/audit';

// POST /api/auth/logout - End session
export const POST: RequestHandler = async (event) => {
	const { cookies } = event;
	try {
		// Get current user before destroying session for audit log
		const auth = await authorize(cookies);
		const username = auth.user?.username || 'unknown';
		const clientIp = event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
			|| event.request.headers.get('x-real-ip')
			|| event.getClientAddress();

		await destroySession(cookies);
		console.log(`[Auth] 退出登录: 用户=${username} IP=${clientIp}`);

		// Audit log
		await auditAuth(event, 'logout', username);

		return json({ success: true });
	} catch (error) {
		console.error('退出登录错误:', error);
		return json({ error: '退出登录失败' }, { status: 500 });
	}
};
