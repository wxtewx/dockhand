import { json } from '@sveltejs/kit';
import { authorize, enterpriseRequired } from '$lib/server/authorize';
import { getAuditLogUsers } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);

	// Audit log is Enterprise-only
	if (!auth.isEnterprise) {
		return json(enterpriseRequired(), { status: 403 });
	}

	// Check permission
	if (!await auth.canViewAuditLog()) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const users = await getAuditLogUsers();
		return json(users);
	} catch (error) {
		console.error('获取审计日志用户失败:', error);
		return json({ error: '获取用户失败' }, { status: 500 });
	}
};
