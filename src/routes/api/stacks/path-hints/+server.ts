import { json, type RequestHandler } from '@sveltejs/kit';
import { getStackPathHints } from '$lib/server/stacks';
import { authorize } from '$lib/server/authorize';

/**
 * GET /api/stacks/path-hints?name=stackName&env=envId
 * Returns path hints extracted from Docker container labels for a stack.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: '未授权' }, { status: 401 });
	}

	const stackName = url.searchParams.get('name');
	const envId = url.searchParams.get('env');

	if (!stackName) {
		return json({ error: '堆栈名称为必填项' }, { status: 400 });
	}

	try {
		const hints = await getStackPathHints(stackName, envId ? parseInt(envId) : undefined);

		return json({
			stackName,
			workingDir: hints.workingDir,
			configFiles: hints.configFiles
		});
	} catch (error) {
		console.error('获取堆栈路径提示失败：', error);
		return json(
			{ error: error instanceof Error ? error.message : '获取路径提示失败' },
			{ status: 500 }
		);
	}
};
