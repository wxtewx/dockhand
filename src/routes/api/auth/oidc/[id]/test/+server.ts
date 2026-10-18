import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { validateSession, testOidcConnection, isAuthEnabled } from '$lib/server/auth';

// POST /api/auth/oidc/[id]/test - Test OIDC connection
/**
 * @openapi
 * summary: Test the discovery/connection of a stored OIDC configuration by id
 * path: id:integer! Numeric id of the OIDC configuration to test (from GET /api/auth/oidc)
 * resp-200: Connection test result (success flag plus diagnostic detail from the provider)
 * resp-400: Invalid configuration id (not a number)
 * resp-403: Admin access required (auth is enabled and the caller is not an admin)
 * resp-500: Failed to test the OIDC connection
 */
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
