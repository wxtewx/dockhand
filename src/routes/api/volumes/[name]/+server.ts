import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeVolume, inspectVolume } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { auditVolume } from '$lib/server/audit';
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

	// Environment access check (enterprise only)
	if (envIdNum && auth.isEnterprise && !await auth.canAccessEnvironment(envIdNum)) {
		return json({ error: '无权访问该环境' }, { status: 403 });
	}

	try {
		const volume = await inspectVolume(params.name, envIdNum);
		return json(volume);
	} catch (error: any) {
		const status = error.statusCode ?? 500;
		console.error(`查看数据卷 ${params.name} 失败：${error.message}`);
		return json({ error: '查看数据卷失败' }, { status });
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { params, url, cookies } = event;
	const invalid = validateDockerIdParam(params.name, 'volume');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const force = url.searchParams.get('force') === 'true';
	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('volumes', 'remove', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	// Environment access check (enterprise only)
	if (envIdNum && auth.isEnterprise && !await auth.canAccessEnvironment(envIdNum)) {
		return json({ error: '无权访问该环境' }, { status: 403 });
	}

	try {
		await removeVolume(params.name, force, envIdNum);

		// Audit log
		await auditVolume(event, 'delete', params.name, params.name, envIdNum, { force });

		return json({ success: true });
	} catch (error: any) {
		const status = error.statusCode ?? 500;
		if (status === 404) {
			console.warn(`删除数据卷 ${params.name} 失败：${error.message}`);
		} else {
			console.error(`删除数据卷 ${params.name} 失败：${error.message}`);
		}
		return json({ error: '删除数据卷失败', details: error.message }, { status });
	}
};
