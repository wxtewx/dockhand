import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setDefaultRegistry, getRegistry } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

/**
 * @openapi
 * summary: Mark a registry as the default registry
 * path: id:integer! Registry ID (from GET /api/registries)
 * resp-200: {success:boolean!}
 * resp-200-example: {"success":true}
 * resp-400: The id path segment is not a valid integer
 * resp-403: Caller lacks the settings:edit permission
 * resp-404: No registry exists with that ID
 * resp-500: Failed to set the default registry
 */
export const POST: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的镜像仓库 ID' }, { status: 400 });
		}

		const registry = await getRegistry(id);
		if (!registry) {
			return json({ error: '未找到镜像仓库' }, { status: 404 });
		}

		await setDefaultRegistry(id);
		return json({ success: true });
	} catch (error) {
		console.error('设置默认镜像仓库失败:', error);
		return json({ error: '设置默认镜像仓库失败' }, { status: 500 });
	}
};
