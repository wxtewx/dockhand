import { json } from '@sveltejs/kit';
import { createContainerFile, createContainerDirectory, chownContainerPath } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import { parseChownSpec } from '$lib/server/chown-spec-core';
import type { RequestHandler } from './$types';

/**
 * POST /api/containers/{id}/files/create - Create a file or directory in a container
 *
 * @openapi
 * summary: Create an empty file or a directory inside a container (requires the 'exec' permission)
 * path: id:string! Container ID or name (from GET /api/containers)
 * query: env:integer! The target environment ID the container lives in (from GET /api/environments)
 * body: {path:string!, type:string!, owner:string}
 * body-example: {"path":"/app/data","type":"directory","owner":"1000:1000"}
 * resp-200: {success:boolean!, path:string!, type:string!, owner:string}
 * resp-200-example: {"success":true,"path":"/app/data","type":"directory","owner":"1000:1000"}
 * resp-400: Path missing, type not "file" or "directory", or the container is not running
 * resp-403: Permission denied
 * resp-404: Parent directory not found
 * resp-409: Path already exists
 * resp-500: Failed to create the path
 */
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
		const { path, type, owner } = body;

		if (!path || typeof path !== 'string') {
			return json({ error: '路径为必填项' }, { status: 400 });
		}

		if (type !== 'file' && type !== 'directory') {
			return json({ error: '类型必须为 "file" 或 "directory"' }, { status: 400 });
		}

		// Validate the optional owner up front so we don't create then fail on chown.
		let ownerSpec: string | undefined;
		if (owner !== undefined && owner !== null && String(owner).trim() !== '') {
			const parsed = parseChownSpec(owner);
			if ('error' in parsed) {
				return json({ error: parsed.error }, { status: 400 });
			}
			ownerSpec = parsed.value;
		}

		if (type === 'file') {
			await createContainerFile(params.id, path, envIdNum);
		} else {
			await createContainerDirectory(params.id, path, envIdNum);
		}

		if (ownerSpec) {
			await chownContainerPath(params.id, path, ownerSpec, type === 'directory', envIdNum);
		}

		return json({ success: true, path, type, owner: ownerSpec ?? null });
	} catch (error: any) {
		console.error('创建路径错误:', error);
		const msg = error.message || String(error);

		if (msg.includes('invalid user') || msg.includes('invalid group')) {
			return json({ error: 'That user or group does not exist in the container' }, { status: 400 });
		}
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
