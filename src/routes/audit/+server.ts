import { json } from '@sveltejs/kit';
import { authorize, enterpriseRequired } from '$lib/server/authorize';
import { getAuditLogs, getAuditLogUsers, type AuditLogFilters, type AuditEntityType, type AuditAction } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
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
		// Parse query parameters
		const filters: AuditLogFilters = {};

		const username = url.searchParams.get('username');
		if (username) filters.username = username;

		const entityType = url.searchParams.get('entity_type');
		if (entityType) filters.entityType = entityType as AuditEntityType;

		const action = url.searchParams.get('action');
		if (action) filters.action = action as AuditAction;

		const envId = url.searchParams.get('environment_id');
		if (envId) filters.environmentId = parseInt(envId);

		const fromDate = url.searchParams.get('from_date');
		if (fromDate) filters.fromDate = fromDate;

		const toDate = url.searchParams.get('to_date');
		if (toDate) filters.toDate = toDate;

		const limit = url.searchParams.get('limit');
		if (limit) filters.limit = parseInt(limit);

		const offset = url.searchParams.get('offset');
		if (offset) filters.offset = parseInt(offset);

		const result = await getAuditLogs(filters);
		return json(result);
	} catch (error) {
		console.error('获取审计日志失败:', error);
		return json({ error: '获取审计日志失败' }, { status: 500 });
	}
};
