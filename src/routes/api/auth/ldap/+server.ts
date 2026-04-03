import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { authorize } from '$lib/server/authorize';
import { getLdapConfigs, createLdapConfig } from '$lib/server/db';
import { auditLdapConfig } from '$lib/server/audit';

// GET /api/auth/ldap - List all LDAP configurations
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);

	// Allow access when auth is disabled (setup mode) or when user is admin
	if (auth.authEnabled && (!auth.isAuthenticated || !auth.isAdmin)) {
		return json({ error: '未授权' }, { status: 401 });
	}

	if (!auth.isEnterprise) {
		return json({ error: '需要企业版许可证' }, { status: 403 });
	}

	try {
		const configs = await getLdapConfigs();
		// Don't return passwords
		const sanitized = configs.map(config => ({
			...config,
			bindPassword: config.bindPassword ? '********' : undefined
		}));
		return json(sanitized);
	} catch (error) {
		console.error('获取LDAP配置失败: ', error);
		return json({ error: '获取LDAP配置失败' }, { status: 500 });
	}
};

// POST /api/auth/ldap - Create a new LDAP configuration
export const POST: RequestHandler = async (event) => {
	const { request, cookies } = event;
	const auth = await authorize(cookies);

	// Allow access when auth is disabled (setup mode) or when user is admin
	if (auth.authEnabled && (!auth.isAuthenticated || !auth.isAdmin)) {
		return json({ error: '未授权' }, { status: 401 });
	}

	if (!auth.isEnterprise) {
		return json({ error: '需要企业版许可证' }, { status: 403 });
	}

	try {
		const data = await request.json();

		// Validate required fields
		if (!data.name || !data.serverUrl || !data.baseDn) {
			return json({ error: '名称、服务器 URL 和基础 DN 为必填项' }, { status: 400 });
		}

		const config = await createLdapConfig({
			name: data.name,
			enabled: data.enabled ?? false,
			serverUrl: data.serverUrl,
			bindDn: data.bindDn || undefined,
			bindPassword: data.bindPassword || undefined,
			baseDn: data.baseDn,
			userFilter: data.userFilter || '(uid={{username}})',
			usernameAttribute: data.usernameAttribute || 'uid',
			emailAttribute: data.emailAttribute || 'mail',
			displayNameAttribute: data.displayNameAttribute || 'cn',
			groupBaseDn: data.groupBaseDn || undefined,
			groupFilter: data.groupFilter || undefined,
			adminGroup: data.adminGroup || undefined,
			roleMappings: data.roleMappings || undefined,
			tlsEnabled: data.tlsEnabled ?? false,
			tlsCa: data.tlsCa || undefined
		});

		// Audit log
		await auditLdapConfig(event, 'create', config.id, config.name);

		return json({
			...config,
			bindPassword: config.bindPassword ? '********' : undefined
		}, { status: 201 });
	} catch (error) {
		console.error('创建 LDAP 配置失败：', error);
		return json({ error: '创建 LDAP 配置失败' }, { status: 500 });
	}
};
