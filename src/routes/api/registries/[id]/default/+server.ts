import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setDefaultRegistry, getRegistry } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

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
