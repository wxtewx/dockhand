import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { validateSession, testOidcConnection, isAuthEnabled } from '$lib/server/auth';

// POST /api/auth/oidc/[id]/test - Test OIDC connection
export const POST: RequestHandler = async ({ params, cookies }) => {
	// When auth is disabled, allow access (for initial setup)
	// When auth is enabled, require admin
	if (await isAuthEnabled()) {
		const user = await validateSession(cookies);
		if (!user || !user.isAdmin) {
			return json({ error: '需要管理员权限' }, { status: 403 });
		}
	}

	const id = parseInt(params.id || '');
	if (isNaN(id)) {
		return json({ error: '无效的配置 ID' }, { status: 400 });
	}

	try {
		const result = await testOidcConnection(id);
		return json(result);
	} catch (error: any) {
		console.error('测试 OIDC 连接失败:', error);
		return json({ success: false, error: error.message || '测试失败' }, { status: 500 });
	}
};
