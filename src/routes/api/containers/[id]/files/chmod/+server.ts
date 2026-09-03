import { json } from '@sveltejs/kit';
import { chmodContainerPath } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';

/**
 * POST /api/containers/{id}/files/chmod - Change permissions of a path in a container
 *
 * @openapi
 * summary: Change the mode (permissions) of a file or directory inside a container (requires the 'exec' permission)
 * path: id:string! Container ID or name (from GET /api/containers)
 * query: env:integer The target environment ID (omit for the local/default Docker host) (from GET /api/environments)
 * body: {path:string!, mode:string!, recursive:boolean}
 * body-example: {"path":"/app/entrypoint.sh","mode":"755","recursive":false}
 * resp-200: {success:boolean!, path:string!, mode:string!, recursive:boolean!}
 * resp-200-example: {"success":true,"path":"/app/entrypoint.sh","mode":"755","recursive":false}
 * resp-400: Path or mode missing, an invalid chmod mode, or the container is not running
 * resp-403: Permission denied, read-only file system, or operation not permitted
 * resp-404: Path not found
 * resp-500: Failed to change permissions
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
