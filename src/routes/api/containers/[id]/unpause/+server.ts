import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unpauseContainer, inspectContainer } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { auditContainer } from '$lib/server/audit';
import { validateDockerIdParam } from '$lib/server/docker-validation';

export const POST: RequestHandler = async (event) => {
	const { params, url, cookies } = event;
	const invalid = validateDockerIdParam(params.id, 'container');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context (unpause uses 'start' permission)
	if (auth.authEnabled && !await auth.can('containers', 'start', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const details = await inspectContainer(params.id, envIdNum);
		const containerName = details.Name.replace(/^\//, '');
		await unpauseContainer(params.id, envIdNum);

		// Audit log
		await auditContainer(event, 'unpause', params.id, containerName, envIdNum);

		return json({ success: true });
	} catch (error) {
		console.error('恢复容器失败:', error);
		return json({ error: '恢复容器失败' }, { status: 500 });
	}
};
