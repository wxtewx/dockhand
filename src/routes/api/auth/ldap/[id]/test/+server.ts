import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { testLdapConnection } from '$lib/server/auth';
import { authorize } from '$lib/server/authorize';
import { getLdapConfig } from '$lib/server/db';

// POST /api/auth/ldap/[id]/test - Test LDAP connection
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
