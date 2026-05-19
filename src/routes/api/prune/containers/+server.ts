import { json } from '@sveltejs/kit';
import { pruneContainers } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { audit } from '$lib/server/audit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { url, cookies } = event;
	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('containers', 'remove', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const result = await pruneContainers(envIdNum);

		// Audit log
		await audit(event, 'prune', 'container', {
			environmentId: envIdNum,
			description: '已清理已停止的容器',
			details: { result }
		});

		return json({ success: true, result });
	} catch (error) {
		console.error('清理容器失败:', error);
		return json({ error: '清理容器失败' }, { status: 500 });
	}
};
