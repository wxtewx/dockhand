import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listContainersWithSize } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('containers', 'view', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const sizes = await listContainersWithSize(true, envIdNum);
		return json(sizes);
	} catch (error) {
		console.error('获取容器大小失败:', error);
		return json({}, { status: 500 });
	}
};
