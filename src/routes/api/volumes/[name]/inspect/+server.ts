import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { inspectVolume } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const invalid = validateDockerIdParam(params.name, 'volume');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('volumes', 'inspect', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const volumeData = await inspectVolume(params.name, envIdNum);
		return json(volumeData);
	} catch (error) {
		console.error('查看数据卷详情失败：', error);
		return json({ error: '查看数据卷详情失败' }, { status: 500 });
	}
};
