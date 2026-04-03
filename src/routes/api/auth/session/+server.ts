import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { validateSession, isAuthEnabled } from '$lib/server/auth';
import { getAuthSettings } from '$lib/server/db';

// GET /api/auth/session - Get current session/user
export const GET: RequestHandler = async ({ cookies }) => {
	try {
		const authEnabled = await isAuthEnabled();

		if (!authEnabled) {
			// Auth is disabled, return anonymous session
			return json({
				authenticated: false,
				authEnabled: false
			});
		}

		const user = await validateSession(cookies);

		if (!user) {
			return json({
				authenticated: false,
				authEnabled: true
			});
		}

		return json({
			authenticated: true,
			authEnabled: true,
			user: {
				id: user.id,
				username: user.username,
				email: user.email,
				displayName: user.displayName,
				avatar: user.avatar,
				isAdmin: user.isAdmin,
				provider: user.provider,
				permissions: user.permissions
			}
		});
	} catch (error) {
		console.error('会话检查错误:', error);
		return json({ error: '检查会话失败' }, { status: 500 });
	}
};
