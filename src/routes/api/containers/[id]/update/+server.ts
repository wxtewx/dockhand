import { json } from '@sveltejs/kit';
import { pullImage, updateContainer, type CreateContainerOptions } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { auditContainer } from '$lib/server/audit';
import { removePendingContainerUpdate } from '$lib/server/db';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { params, request, url, cookies } = event;
	const invalid = validateDockerIdParam(params.id, 'container');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context (update requires create permission)
	if (auth.authEnabled && !await auth.can('containers', 'create', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const body = await request.json();
		const { startAfterUpdate, repullImage, ...options } = body;

		if (repullImage) {
			console.log(`正在拉取镜像...`);
			try {
				await pullImage(options.image, undefined, envIdNum);
				console.log(`镜像拉取成功`);
			} catch (pullError: any) {
				console.log(`拉取失败: ${pullError.message}`);
				throw pullError;
			}
		}

		console.log(`正在更新容器 ${params.id}，名称: ${options.name}`);

		const container = await updateContainer(params.id, options, startAfterUpdate, envIdNum);

		// Clear pending update indicator (if any) since container was just updated
		if (envIdNum) {
			await removePendingContainerUpdate(envIdNum, params.id).catch(() => {
				// Ignore errors - record may not exist
			});
		}

		// Audit log - include full options to see what was modified
		await auditContainer(event, 'update', container.id, options.name, envIdNum, { ...options, startAfterUpdate });

		return json({ success: true, id: container.id });
	} catch (error: any) {
		if (error?.statusCode === 404) {
			return json({ error: error.json?.message || '容器未找到' }, { status: 404 });
		}
		console.error('更新容器错误:', error?.message || error);
		return json({ error: '更新容器失败', details: error?.message || String(error) }, { status: 500 });
	}
};
