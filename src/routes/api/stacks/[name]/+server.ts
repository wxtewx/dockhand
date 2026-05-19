import { json } from '@sveltejs/kit';
import { removeStack, ComposeFileNotFoundError } from '$lib/server/stacks';
import { authorize } from '$lib/server/authorize';
import { auditStack } from '$lib/server/audit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async (event) => {
	const { params, url, cookies } = event;
	const auth = await authorize(cookies);

	const force = url.searchParams.get('force') === 'true';
	const volumes = url.searchParams.get('volumes') === 'true';
	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !(await auth.can('stacks', 'remove', envIdNum))) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	// Environment access check (enterprise only)
	if (envIdNum && auth.isEnterprise && !(await auth.canAccessEnvironment(envIdNum))) {
		return json({ error: '无权访问该环境' }, { status: 403 });
	}

	try {
		const stackName = decodeURIComponent(params.name);
		const result = await removeStack(stackName, envIdNum, force, volumes);

		// Audit log
		await auditStack(event, 'delete', stackName, envIdNum, { force, volumes });

		if (!result.success) {
			return json({ success: false, error: result.error }, { status: 400 });
		}
		return json({ success: true });
	} catch (error) {
		if (error instanceof ComposeFileNotFoundError) {
			return json({ error: error.message }, { status: 404 });
		}
		console.error('删除 Compose 堆栈时出错：', error);
		return json({ error: '删除 Compose 堆栈失败' }, { status: 500 });
	}
};
