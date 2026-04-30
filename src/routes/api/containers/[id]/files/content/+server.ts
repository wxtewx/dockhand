import { json } from '@sveltejs/kit';
import { readContainerFile, writeContainerFile } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';

// Max file size for reading (1MB)
const MAX_FILE_SIZE = 1024 * 1024;

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const invalid = validateDockerIdParam(params.id, 'container');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const path = url.searchParams.get('path');
	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('containers', 'view', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		if (!path) {
			return json({ error: '路径为必填项' }, { status: 400 });
		}

		const content = await readContainerFile(
			params.id,
			path,
			envIdNum
		);

		// Check if content is too large
		if (content.length > MAX_FILE_SIZE) {
			return json({ error: '文件过大，无法编辑 (最大 1MB)' }, { status: 413 });
		}

		return json({ content, path });
	} catch (error: any) {
		if (error?.statusCode === 404 && !error.message?.includes('No such file')) {
			return json({ error: error.json?.message || '容器未找到' }, { status: 404 });
		}
		console.error('读取容器文件错误:', error?.message || error);
		const msg = error.message || String(error);

		if (msg.includes('No such file or directory')) {
			return json({ error: '文件未找到' }, { status: 404 });
		}
		if (msg.includes('Permission denied')) {
			return json({ error: '读取此文件权限不足' }, { status: 403 });
		}
		if (msg.includes('Is a directory')) {
			return json({ error: '无法读取目录' }, { status: 400 });
		}
		if (msg.includes('container is not running')) {
			return json({ error: '容器未运行' }, { status: 400 });
		}

		return json({ error: `读取文件失败: ${msg}` }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ params, url, cookies, request }) => {
	const invalid = validateDockerIdParam(params.id, 'container');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const path = url.searchParams.get('path');
	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('containers', 'exec', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		if (!path) {
			return json({ error: '路径为必填项' }, { status: 400 });
		}

		const body = await request.json();
		if (typeof body.content !== 'string') {
			return json({ error: '内容为必填项' }, { status: 400 });
		}

		// Check content size
		if (body.content.length > MAX_FILE_SIZE) {
			return json({ error: '内容过大 (最大 1MB)' }, { status: 413 });
		}

		await writeContainerFile(
			params.id,
			path,
			body.content,
			envIdNum
		);

		return json({ success: true, path });
	} catch (error: any) {
		console.error('写入容器文件错误:', error?.message || error);
		const msg = error.message || String(error);

		if (msg.includes('Permission denied')) {
			return json({ error: '写入此文件权限不足' }, { status: 403 });
		}
		if (msg.includes('No such file or directory')) {
			return json({ error: '目录未找到' }, { status: 404 });
		}
		if (msg.includes('Read-only file system')) {
			return json({ error: '文件系统为只读模式' }, { status: 403 });
		}
		if (msg.includes('No space left on device')) {
			return json({ error: '设备存储空间不足' }, { status: 507 });
		}
		if (msg.includes('container is not running')) {
			return json({ error: '容器未运行' }, { status: 400 });
		}

		return json({ error: `写入文件失败: ${msg}` }, { status: 500 });
	}
};
