import { json } from '@sveltejs/kit';
import { restartStack, ComposeFileNotFoundError } from '$lib/server/stacks';
import { authorize } from '$lib/server/authorize';
import { auditStack } from '$lib/server/audit';
import { createJobResponse } from '$lib/server/sse';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { params, url, cookies } = event;
	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !(await auth.can('stacks', 'restart', envIdNum))) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	// Environment access check (enterprise only)
	if (envIdNum && auth.isEnterprise && !(await auth.canAccessEnvironment(envIdNum))) {
		return json({ error: '无权访问该环境' }, { status: 403 });
	}

	const mode = url.searchParams.get('mode') === 'recreate' ? 'recreate' : 'restart';

	return createJobResponse(async (send) => {
		try {
			const stackName = decodeURIComponent(params.name);
			const result = await restartStack(stackName, envIdNum, mode);

			// Audit log
			await auditStack(event, 'restart', stackName, envIdNum);

			if (!result.success) {
				send('result', { success: false, error: result.error });
				return;
			}
			send('result', { success: true, output: result.output });
		} catch (error) {
			if (error instanceof ComposeFileNotFoundError) {
				send('result', { success: false, error: error.message });
				return;
			}
			console.error('重启 Compose 堆栈时出错：', error);
			send('result', { success: false, error: '重启 Compose 堆栈失败' });
		}
	}, event.request);
};
