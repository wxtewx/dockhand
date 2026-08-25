import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitStack } from '$lib/server/db';
import { deployGitStack } from '$lib/server/git';
import { authorize } from '$lib/server/authorize';
import { auditGitStack } from '$lib/server/audit';
import { createJobResponse } from '$lib/server/sse';

/**
 * @openapi
 * summary: Deploy a git stack, streaming the deploy log as SSE result events via the job-response channel
 * path: id:integer! Git stack ID (from GET /api/git/stacks)
 * resp-200: {}
 * resp-200-desc: An SSE stream whose final `result` event carries {success, error}
 * resp-403: Caller lacks the stacks:start permission for the stack's environment
 * resp-404: No git stack exists with that ID
 * resp-500: Failed to start the deployment
 */
export const POST: RequestHandler = async (event) => {
	const { params, cookies } = event;
	const auth = await authorize(cookies);

	try {
		const id = parseInt(params.id);
		const gitStack = await getGitStack(id);
		if (!gitStack) {
			return json({ error: 'Git 堆栈不存在' }, { status: 404 });
		}

		// Permission check with environment context
		if (auth.authEnabled && !await auth.can('stacks', 'start', gitStack.environmentId || undefined)) {
			return json({ error: '权限不足' }, { status: 403 });
		}

		return createJobResponse(async (send) => {
			try {
				const result = await deployGitStack(id);

				// Audit log
				await auditGitStack(event, 'deploy', id, gitStack.stackName, gitStack.environmentId);

				send('result', result);
			} catch (error) {
				console.error('部署 Git 堆栈失败:', error);
				send('result', { success: false, error: '部署 Git 堆栈失败' });
			}
		}, event.request);
	} catch (error) {
		console.error('部署 Git 堆栈失败:', error);
		return json({ error: '部署 Git 堆栈失败' }, { status: 500 });
	}
};
