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

		// Support multi-select filters (comma-separated)
		const usernames = url.searchParams.get('usernames');
		if (usernames) filters.usernames = usernames.split(',').filter(Boolean);

		const entityTypes = url.searchParams.get('entityTypes');
		if (entityTypes) filters.entityTypes = entityTypes.split(',').filter(Boolean) as AuditEntityType[];

		const actions = url.searchParams.get('actions');
		if (actions) filters.actions = actions.split(',').filter(Boolean) as AuditAction[];

		// Legacy single-value support
		const username = url.searchParams.get('username');
		if (username) filters.usernames = [username];

		const entityType = url.searchParams.get('entityType');
		if (entityType) filters.entityTypes = [entityType as AuditEntityType];

		const action = url.searchParams.get('action');
		if (action) filters.actions = [action as AuditAction];

		const envId = url.searchParams.get('environmentId');
		if (envId) filters.environmentId = parseInt(envId);

		// Labels filter (comma-separated)
		const labels = url.searchParams.get('labels');
		if (labels) filters.labels = labels.split(',').filter(Boolean);

		const fromDate = url.searchParams.get('fromDate');
		if (fromDate) filters.fromDate = fromDate;

		const toDate = url.searchParams.get('toDate');
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
