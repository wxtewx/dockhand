import { json } from '@sveltejs/kit';
import { createContainerFile, createContainerDirectory } from '$lib/server/docker';
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
		const { path, type } = body;

		if (!path || typeof path !== 'string') {
			return json({ error: '路径为必填项' }, { status: 400 });
		}

		if (type !== 'file' && type !== 'directory') {
			return json({ error: '类型必须为 "file" 或 "directory"' }, { status: 400 });
		}

		if (type === 'file') {
			await createContainerFile(params.id, path, envIdNum);
		} else {
			await createContainerDirectory(params.id, path, envIdNum);
		}

		return json({ success: true, path, type });
	} catch (error: any) {
		console.error('创建路径错误:', error);
		const msg = error.message || String(error);

		if (msg.includes('Permission denied')) {
			return json({ error: '权限不足' }, { status: 403 });
		}
		if (msg.includes('File exists')) {
			return json({ error: '路径已存在' }, { status: 409 });
		}
		if (msg.includes('No such file or directory')) {
			return json({ error: '父目录未找到' }, { status: 404 });
		}
		if (msg.includes('container is not running')) {
			return json({ error: '容器未运行' }, { status: 400 });
		}

		return json({ error: `创建失败: ${msg}` }, { status: 500 });
	}
};
