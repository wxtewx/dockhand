import { json } from '@sveltejs/kit';
import { readContainerFile, writeContainerFile } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';

// Max file size for reading (1MB)
const MAX_FILE_SIZE = 1024 * 1024;

/**
 * GET /api/containers/{id}/files/content - Read a file's content from a container
 *
 * @openapi
 * summary: Read the content of a single file inside a container (max 1 MB)
 * path: id:string! Container ID or name (from GET /api/containers)
 * query: env:integer The target environment ID (omit for the local/default Docker host) (from GET /api/environments)
 * query: path:string! Absolute file path inside the container
 * resp-200: {content:string!, path:string!}
 * resp-400: Path is missing, the target is a directory, or the container is not running
 * resp-403: Permission denied to read the file
 * resp-404: File not found
 * resp-413: File is larger than the 1 MB read limit
 * resp-500: Failed to read the file
 */
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

/**
 * PUT /api/containers/{id}/files/content - Write a file's content in a container
 *
 * @openapi
 * summary: Overwrite the content of a file inside a container (max 1 MB, requires the 'exec' permission)
 * path: id:string! Container ID or name (from GET /api/containers)
 * query: env:integer The target environment ID (omit for the local/default Docker host) (from GET /api/environments)
 * query: path:string! Absolute file path inside the container
 * body: {content:string!}
 * body-example: {"content":"server {\n  listen 80;\n}\n"}
 * resp-200: {success:boolean!, path:string!}
 * resp-200-example: {"success":true,"path":"/etc/nginx/nginx.conf"}
 * resp-400: Path is missing, content is missing/not a string, or the container is not running
 * resp-403: Permission denied, or the target file system is read-only
 * resp-404: Target directory not found
 * resp-413: Content is larger than the 1 MB write limit
 * resp-500: Failed to write the file
 * resp-507: No space left on device
 */
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
