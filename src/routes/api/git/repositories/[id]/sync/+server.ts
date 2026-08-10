import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitRepository } from '$lib/server/db';
import { syncRepository, checkForUpdates } from '$lib/server/git';

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

		const result = await syncRepository(id);
		return json(result);
	} catch (error: any) {
		console.error('Git 仓库同步失败:', error);
		return json({ success: false, error: error.message }, { status: 500 });
	}
};

export const GET: RequestHandler = async ({ params }) => {
	// Check for updates without syncing
	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的仓库 ID' }, { status: 400 });
		}

		const repository = await getGitRepository(id);
		if (!repository) {
			return json({ error: '仓库不存在' }, { status: 404 });
		}

		const result = await checkForUpdates(id);
		return json(result);
	} catch (error: any) {
		console.error('检查更新失败:', error);
		return json({ hasUpdates: false, error: error.message }, { status: 500 });
	}
};
