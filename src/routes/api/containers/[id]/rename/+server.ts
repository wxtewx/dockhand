import { json } from '@sveltejs/kit';
import { renameContainer, inspectContainer } from '$lib/server/docker';
import { renameAutoUpdateSchedule } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import { auditContainer } from '$lib/server/audit';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { params, request, url, cookies } = event;
	const invalid = validateDockerIdParam(params.id, 'container');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context (renaming requires create permission)
	if (auth.authEnabled && !await auth.can('containers', 'create', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const { name } = await request.json();
		if (!name || typeof name !== 'string') {
			return json({ error: '新名称为必填项' }, { status: 400 });
		}

		// Get old container name before renaming
		let oldName = params.id;
		try {
			const details = await inspectContainer(params.id, envIdNum);
			oldName = details.Name?.replace(/^\//, '') || params.id;
		} catch {
			// Container might not exist or other error, use ID
		}

		await renameContainer(params.id, name, envIdNum);

		// Audit log
		await auditContainer(event, 'rename', params.id, name, envIdNum, { previousId: params.id, newName: name });

		// Update schedule if exists
		try {
			await renameAutoUpdateSchedule(oldName, name, envIdNum);
		} catch (error) {
			console.error('更新计划名称失败:', error);
			// Don't fail the rename if schedule update fails
		}

		return json({ success: true });
	} catch (error: any) {
		if (error?.statusCode === 404) {
			return json({ error: error.json?.message || '容器未找到' }, { status: 404 });
		}
		console.error('重命名容器错误:', error?.message || error);
		return json({ error: '重命名容器失败' }, { status: 500 });
	}
};
