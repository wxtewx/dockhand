import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getAuthSettings, updateAuthSettings, countAdminUsers } from '$lib/server/db';
import { isEnterprise } from '$lib/server/license';
import { authorize } from '$lib/server/authorize';

// GET /api/auth/settings - Get auth settings
// Public when auth is disabled, requires authentication when enabled
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);

	// When auth is enabled, require authentication first, then settings:view permission
	if (auth.authEnabled) {
		if (!auth.isAuthenticated) {
			return json({ error: '需要身份验证' }, { status: 401 });
		}
		if (!await auth.can('settings', 'view')) {
			return json({ error: '权限不足' }, { status: 403 });
		}
	}

	try {
		const settings = await getAuthSettings();
		return json(settings);
	} catch (error) {
		console.error('获取身份验证设置失败:', error);
		return json({ error: '获取身份验证设置失败' }, { status: 500 });
	}
};

// PUT /api/auth/settings - Update auth settings
// Requires authentication and settings:edit permission
export const PUT: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);

	// When auth is enabled, require authentication first, then settings:edit permission
	if (auth.authEnabled) {
		if (!auth.isAuthenticated) {
			return json({ error: '需要身份验证' }, { status: 401 });
		}
		if (!await auth.can('settings', 'edit')) {
			return json({ error: '权限不足' }, { status: 403 });
		}
	}

	try {
		const data = await request.json();

		// Check if trying to enable auth without required users
		if (data.authEnabled === true) {
			const userCount = await countAdminUsers();
			// PostgreSQL returns bigint for count(*), convert to number for comparison
			if (Number(userCount) === 0) {
				const enterprise = await isEnterprise();
				const errorMessage = enterprise
					? '无法启用身份验证，缺少管理员用户。请先创建一个用户并为其分配管理员角色。'
					: '无法启用身份验证，未创建任何用户。请先创建用户。';
				return json({
					error: errorMessage,
					requiresUser: true
				}, { status: 400 });
			}
		}

		// Enforce minimum session timeout of 1 hour
		if (data.sessionTimeout !== undefined) {
			data.sessionTimeout = Math.max(3600, Math.min(604800, parseInt(data.sessionTimeout) || 86400));
		}

		const settings = await updateAuthSettings(data);
		return json(settings);
	} catch (error) {
		console.error('更新身份验证设置失败:', error);
		return json({ error: '更新身份验证设置失败' }, { status: 500 });
	}
};
