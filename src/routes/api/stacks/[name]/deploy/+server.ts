import { json } from '@sveltejs/kit';
import { deployStack, requireComposeFile, ComposeFileNotFoundError } from '$lib/server/stacks';
import { authorize } from '$lib/server/authorize';
import { auditStack } from '$lib/server/audit';
import { createJobResponse } from '$lib/server/sse';
import type { RequestHandler } from './$types';

/**
 * @openapi
 * summary: Deploy (docker compose up) a stack, optionally pulling images, building, and force-recreating; progress and the final result stream over Server-Sent Events
 * path: name:string! Stack name (from GET /api/stacks)
 * query: env:integer Environment ID the stack belongs to (from GET /api/environments)
 * body: {pull:boolean, build:boolean, forceRecreate:boolean}
 * body-example: {"pull":true,"build":false,"forceRecreate":false}
 * resp-200: Server-Sent-Events job stream with progress events and a final result event ({success, output})
 * resp-403: Permission denied (requires stacks:start, or environment access denied on enterprise)
 */
export const POST: RequestHandler = async (event) => {
	const { params, url, cookies, request } = event;
	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !(await auth.can('stacks', 'start', envIdNum))) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	// Environment access check (enterprise only)
	if (envIdNum && auth.isEnterprise && !(await auth.canAccessEnvironment(envIdNum))) {
		return json({ error: '无权访问该环境' }, { status: 403 });
	}

	const body = await request.json().catch(() => ({}));
	const { pull, build, forceRecreate } = body as {
		pull?: boolean;
		build?: boolean;
		forceRecreate?: boolean;
	};

	return createJobResponse(async (send) => {
		try {
			const stackName = decodeURIComponent(params.name);

			send('progress', { status: '正在读取 Compose 文件...' });
			const composeResult = await requireComposeFile(stackName, envIdNum);

			if (!composeResult.success) {
				send('result', {
					success: false,
					error: composeResult.needsFileLocation
						? '堆栈 Compose 文件路径尚未配置'
						: composeResult.error || '未找到 Compose 文件'
				});
				return;
			}

			send('progress', { status: '正在部署堆栈...' });
			const result = await deployStack({
				name: stackName,
				compose: composeResult.content!,
				envId: envIdNum,
				pullPolicy: pull ? 'always' : undefined,
				build,
				forceRecreate,
				composePath: composeResult.composePath,
				envPath: composeResult.envPath
			});

			// Audit log
			await auditStack(event, 'deploy', stackName, envIdNum, {
				pull, build, forceRecreate
			});

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
			console.error('部署 Compose 堆栈时发生错误:', error);
			send('result', { success: false, error: '部署 Compose 堆栈失败' });
		}
	}, event.request);
};
