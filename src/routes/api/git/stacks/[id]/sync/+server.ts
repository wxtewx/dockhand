import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitStack } from '$lib/server/db';
import { syncGitStack } from '$lib/server/git';
import { authorize } from '$lib/server/authorize';

export const POST: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const id = parseInt(params.id);
		const gitStack = await getGitStack(id);
		if (!gitStack) {
			return json({ error: 'Git 堆栈不存在' }, { status: 404 });
		}

		// Permission check with environment context
		if (auth.authEnabled && !await auth.can('stacks', 'edit', gitStack.environmentId || undefined)) {
			return json({ error: '权限不足' }, { status: 403 });
		}

		const result = await syncGitStack(id);
		return json(result);
	} catch (error) {
		console.error('同步 Git 堆栈失败:', error);
		return json({ error: '同步 Git 堆栈失败' }, { status: 500 });
	}
};
