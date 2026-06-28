import { json } from '@sveltejs/kit';
import { listImages, EnvironmentNotFoundError, DockerConnectionError } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { hasEnvironments } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('images', 'view', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	// Environment access check (enterprise only)
	if (envIdNum && auth.isEnterprise && !await auth.canAccessEnvironment(envIdNum)) {
		return json({ error: '无权访问此环境' }, { status: 403 });
	}

	// Early return if no environment specified
	if (!envIdNum) {
		return json([]);
	}

	try {
		const images = await listImages(envIdNum);
		return json(images);
	} catch (error) {
		if (error instanceof EnvironmentNotFoundError) {
			return json({ error: '环境不存在' }, { status: 404 });
		}
		if (!(error instanceof DockerConnectionError)) {
			console.error('获取镜像列表失败:', error);
		}
		if (!(error instanceof DockerConnectionError)) {
			console.error('列出镜像时出错:', error);
		}
		// Return empty array instead of error to allow UI to load
		return json([]);
	}
};
