import { json } from '@sveltejs/kit';
import { chmodContainerPath } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, url, cookies, request }) => {
	const invalid = validateDockerIdParam(params.id, 'container');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('containers', 'exec', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const body = await request.json();
		const { path, mode, recursive } = body;

		if (!path || typeof path !== 'string') {
			return json({ error: '路径为必填项' }, { status: 400 });
		}

		if (!mode || typeof mode !== 'string') {
			return json({ error: '权限模式为必填项（例如："755" 或 "u+x"）' }, { status: 400 });
		}

		await chmodContainerPath(params.id, path, mode, recursive === true, envIdNum);

		return json({ success: true, path, mode, recursive: recursive === true });
	} catch (error: any) {
		console.error('修改权限错误:', error);
		const msg = error.message || String(error);

		if (msg.includes('Permission denied')) {
			return json({ error: '权限不足' }, { status: 403 });
		}
		if (msg.includes('No such file or directory')) {
			return json({ error: '路径不存在' }, { status: 404 });
		}
		if (msg.includes('Invalid chmod mode')) {
			return json({ error: msg }, { status: 400 });
		}
		if (msg.includes('Read-only file system')) {
			return json({ error: '文件系统为只读模式' }, { status: 403 });
		}
		if (msg.includes('Operation not permitted')) {
			return json({ error: '操作不被允许' }, { status: 403 });
		}
		if (msg.includes('container is not running')) {
			return json({ error: '容器未运行' }, { status: 400 });
		}

		return json({ error: `修改权限失败: ${msg}` }, { status: 500 });
	}
};
