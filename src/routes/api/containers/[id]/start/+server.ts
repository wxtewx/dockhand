import { json } from '@sveltejs/kit';
import { startContainer, inspectContainer } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { auditContainer } from '$lib/server/audit';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { params, url, cookies } = event;
	const invalid = validateDockerIdParam(params.id, 'container');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('containers', 'start', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	// Environment access check (enterprise only)
	if (envIdNum && auth.isEnterprise && !await auth.canAccessEnvironment(envIdNum)) {
		return json({ error: '无权访问此环境' }, { status: 403 });
	}

	try {

		await startContainer(params.id, envIdNum);
		const details = await inspectContainer(params.id, envIdNum);
		const containerName = details.Name.replace(/^\//, '');

		// Audit log
		await auditContainer(event, 'start', params.id, containerName, envIdNum);

		return json({ success: true });
	} catch (error: any) {
		if (error?.statusCode === 404) {
			return json({ error: error.json?.message || '容器未找到' }, { status: 404 });
		}
		console.error('启动容器错误:', error?.message || error);
		return json({ error: '启动容器失败' }, { status: 500 });
	}
};
