import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listVolumeDirectory, getVolumeUsage } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const invalid = validateDockerIdParam(params.name, 'volume');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;
	const path = url.searchParams.get('path') || '/';

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('volumes', 'inspect', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		// Check if volume is in use by any containers
		const usage = await getVolumeUsage(params.name, envIdNum);
		const isInUse = usage.length > 0;

		// Mount read-only if in use, otherwise writable
		const result = await listVolumeDirectory(params.name, path, envIdNum, isInUse);

		// Note: Helper container is cached and reused for subsequent requests.
		// Cache TTL handles cleanup automatically.

		return json({
			path: result.path,
			entries: result.entries,
			usage,
			isInUse,
			// Expose helper container ID so frontend can use container file endpoints
			helperId: result.containerId
		});
	} catch (error: any) {
		console.error('浏览数据卷失败：', error);

		if (error.message?.includes('No such file or directory')) {
			return json({ error: '目录不存在', path: url.searchParams.get('path') || '/' }, { status: 404 });
		}
		if (error.message?.includes('Permission denied')) {
			return json({ error: '访问此路径权限不足' }, { status: 403 });
		}

		return json({
			error: '浏览数据卷失败',
			details: error.message || String(error)
		}, { status: 500 });
	}
};
