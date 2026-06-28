import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitStack } from '$lib/server/db';
import { listGitStackEnvFiles, readGitStackEnvFile } from '$lib/server/git';
import { authorize } from '$lib/server/authorize';

/**
 * GET /api/git/stacks/[id]/env-files
 * List all .env files in the git stack's repository.
 * Returns: { files: string[] }
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const id = parseInt(params.id);
		const gitStack = await getGitStack(id);
		if (!gitStack) {
			return json({ error: 'Git 堆栈不存在' }, { status: 404 });
		}

		// Permission check with environment context
		if (auth.authEnabled && !await auth.can('stacks', 'view', gitStack.environmentId || undefined)) {
			return json({ error: '权限不足' }, { status: 403 });
		}

		const result = await listGitStackEnvFiles(id);
		if (result.error) {
			return json({ files: [], error: result.error }, { status: 400 });
		}

		return json({ files: result.files });
	} catch (error) {
		console.error('获取环境变量文件列表失败:', error);
		return json({ error: '获取环境变量文件列表失败' }, { status: 500 });
	}
};

/**
 * POST /api/git/stacks/[id]/env-files
 * Read and parse a specific .env file from the git stack's repository.
 * Body: { path: string }
 * Returns: { vars: Record<string, string> }
 */
export const POST: RequestHandler = async ({ params, cookies, request }) => {
	const auth = await authorize(cookies);

	try {
		const id = parseInt(params.id);
		const gitStack = await getGitStack(id);
		if (!gitStack) {
			return json({ error: 'Git 堆栈不存在' }, { status: 404 });
		}

		// Permission check with environment context
		if (auth.authEnabled && !await auth.can('stacks', 'view', gitStack.environmentId || undefined)) {
			return json({ error: '权限不足' }, { status: 403 });
		}

		const body = await request.json();
		if (!body.path || typeof body.path !== 'string') {
			return json({ error: '文件路径为必填项' }, { status: 400 });
		}

		const result = await readGitStackEnvFile(id, body.path);
		if (result.error) {
			return json({ vars: {}, error: result.error }, { status: 400 });
		}

		return json({ vars: result.vars });
	} catch (error) {
		console.error('读取环境变量文件失败:', error);
		return json({ error: '读取环境变量文件失败' }, { status: 500 });
	}
};
