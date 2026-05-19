import { json } from '@sveltejs/kit';
import { getContainerLogs } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const invalid = validateDockerIdParam(params.id, 'container');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const tail = parseInt(url.searchParams.get('tail') || '100');
	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('containers', 'logs', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const logs = await getContainerLogs(params.id, tail, envIdNum);
		return json({ logs });
	} catch (error: any) {
		console.error('获取容器日志错误:', error?.message || error, error?.stack);
		return json({ error: '获取容器日志失败', details: error?.message }, { status: 500 });
	}
};
