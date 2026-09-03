import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitRepository } from '$lib/server/db';
import { syncRepository, checkForUpdates } from '$lib/server/git';
import { authorize } from '$lib/server/authorize';

/**
 * @openapi
 * summary: Sync (git pull) the local clone of a repository to the latest commit on its tracked branch
 * path: id:integer! Git repository ID (from GET /api/git/repositories)
 * resp-200: {success:boolean!, error:string}
 * resp-200-example: {"success":true}
 * resp-400: The id path segment is not a valid integer
 * resp-403: Caller lacks the git:edit permission
 * resp-404: No repository exists with that ID
 * resp-500: The sync failed
 */
export const POST: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('git', 'edit')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

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

/**
 * @openapi
 * summary: Check whether the tracked branch has new commits upstream without pulling them
 * path: id:integer! Git repository ID (from GET /api/git/repositories)
 * resp-200: {hasUpdates:boolean!, error:string}
 * resp-200-example: {"hasUpdates":false}
 * resp-400: The id path segment is not a valid integer
 * resp-403: Caller lacks the git:view permission
 * resp-404: No repository exists with that ID
 * resp-500: The update check failed
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('git', 'view')) {
		return json({ error: 'Permission denied' }, { status: 403 });
	}

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
