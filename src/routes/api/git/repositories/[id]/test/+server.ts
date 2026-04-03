import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitRepository } from '$lib/server/db';
import { testRepository } from '$lib/server/git';

export const POST: RequestHandler = async ({ params }) => {
	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的仓库 ID' }, { status: 400 });
		}

		const repository = await getGitRepository(id);
		if (!repository) {
			return json({ error: '仓库不存在' }, { status: 404 });
		}

		const result = await testRepository(id);
		return json(result);
	} catch (error: any) {
		console.error('测试 Git 仓库失败:', error);
		return json({ success: false, error: error.message }, { status: 500 });
	}
};
