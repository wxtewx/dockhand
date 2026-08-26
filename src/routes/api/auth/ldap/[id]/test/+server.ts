import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { testLdapConnection } from '$lib/server/auth';
import { authorize } from '$lib/server/authorize';
import { getLdapConfig } from '$lib/server/db';

// POST /api/auth/ldap/[id]/test - Test LDAP connection
/**
 * @openapi
 * summary: Test connectivity of a stored LDAP configuration by id (enterprise only)
 * path: id:integer! Numeric id of the LDAP configuration to test (from GET /api/auth/ldap)
 * resp-200: Connection test result (success flag plus diagnostic detail from the LDAP server)
 * resp-400: Invalid id (not a number)
 * resp-401: Authentication required (auth is enabled and the caller is not an authenticated admin)
 * resp-403: Enterprise license required
 * resp-404: LDAP configuration not found
 * resp-500: Failed to test the LDAP connection
 */
export const POST: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	// Allow access when auth is disabled (setup mode) or when user is admin
	if (auth.authEnabled && (!auth.isAuthenticated || !auth.isAdmin)) {
		return json({ error: '未授权' }, { status: 401 });
	}

	if (!auth.isEnterprise) {
		return json({ error: '需要企业版许可证' }, { status: 403 });
	}

	const id = parseInt(params.id!, 10);
	if (isNaN(id)) {
		return json({ error: '无效的 ID' }, { status: 400 });
	}

	try {
		const config = await getLdapConfig(id);
		if (!config) {
			return json({ error: '未找到 LDAP 配置' }, { status: 404 });
		}

		const result = await testLdapConnection(id);
		return json(result);
	} catch (error) {
		console.error('测试 LDAP 连接失败:', error);
		return json({ error: '测试 LDAP 连接失败' }, { status: 500 });
	}
};
