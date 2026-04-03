import { json } from '@sveltejs/kit';
import { getContainerEventStats } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	const envId = url.searchParams.get('environment_id');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check for activity viewing
	if (auth.authEnabled && !await auth.can('activity', 'view', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		let environmentIds: number[] | undefined;

		if (envIdNum) {
			// Specific environment requested
			const stats = await getContainerEventStats(envIdNum);
			return json(stats);
		} else if (auth.isEnterprise && auth.authEnabled && !auth.isAdmin) {
			// Enterprise with auth enabled and non-admin: filter by accessible environments
			const accessibleEnvIds = await auth.getAccessibleEnvironmentIds();
			if (accessibleEnvIds !== null) {
				if (accessibleEnvIds.length === 0) {
					// No access to any environment - return empty stats
					return json({ total: 0, today: 0, byAction: {} });
				}
				environmentIds = accessibleEnvIds;
			}
		}

		const stats = await getContainerEventStats(undefined, environmentIds);
		return json(stats);
	} catch (error) {
		console.error('获取容器事件统计数据失败:', error);
		return json({ error: '获取统计数据失败' }, { status: 500 });
	}
};
