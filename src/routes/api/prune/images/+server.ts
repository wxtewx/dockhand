import { json } from '@sveltejs/kit';
import { pruneImages } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { audit } from '$lib/server/audit';
import { createJobResponse } from '$lib/server/sse';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const { url, cookies } = event;
	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;
	const danglingOnly = url.searchParams.get('dangling') !== 'false';

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('images', 'remove', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	return createJobResponse(async (send) => {
		try {
			const result = await pruneImages(danglingOnly, envIdNum);

			// Audit log
			await audit(event, 'prune', 'image', {
				environmentId: envIdNum,
				description: `已清理 ${danglingOnly ? '悬空' : '未使用'} 镜像`,
				details: { danglingOnly, result }
			});

			send('result', { success: true, result });
		} catch (error) {
			console.error('清理镜像失败:', error);
			send('result', { success: false, error: '清理镜像失败' });
		}
	}, event.request);
};
