import { json } from '@sveltejs/kit';
import { getContainerEvents, getContainerEventContainers, getContainerEventActions, getContainerEventStats, clearContainerEvents, type ContainerEventFilters, type ContainerEventAction } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	// Parse query parameters
	const filters: ContainerEventFilters = {};

	const envId = url.searchParams.get('environmentId');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('activity', 'view', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		if (envIdNum) {
			// Specific environment requested - use it
			filters.environmentId = envIdNum;
		} else if (auth.isEnterprise && auth.authEnabled && !auth.isAdmin) {
			// Enterprise with auth enabled and non-admin: filter by accessible environments
			const accessibleEnvIds = await auth.getAccessibleEnvironmentIds();
			if (accessibleEnvIds !== null) {
				// User has limited access - filter by their accessible environments
				if (accessibleEnvIds.length === 0) {
					// No access to any environment - return empty
					return json({ events: [], total: 0, limit: 100, offset: 0 });
				}
				filters.environmentIds = accessibleEnvIds;
			}
			// If accessibleEnvIds is null, user has access to all environments
		}

		const containerId = url.searchParams.get('containerId');
		if (containerId) filters.containerId = containerId;

		const containerName = url.searchParams.get('containerName');
		if (containerName) filters.containerName = containerName;

		// Support multi-select actions filter (comma-separated)
		const actions = url.searchParams.get('actions');
		if (actions) filters.actions = actions.split(',').filter(Boolean) as ContainerEventAction[];

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

		const result = await getContainerEvents(filters);
		return json(result);
	} catch (error) {
		console.error('获取容器事件失败:', error);
		return json({ error: '获取容器事件失败' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);

	// Check permission - admins or users with activity delete permission
	// In free edition, all authenticated users can delete
	if (auth.authEnabled && !await auth.can('activity', 'delete')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		await clearContainerEvents();
		return json({ success: true });
	} catch (error) {
		console.error('清空容器事件失败:', error);
		return json({ error: '清空容器事件失败' }, { status: 500 });
	}
};
