import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { releaseVolumeHelperContainer } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';

/**
 * Release the cached volume helper container when done browsing.
 * This is called when the volume browser modal is closed.
 */
export const POST: RequestHandler = async ({ params, url, cookies }) => {
	const invalid = validateDockerIdParam(params.name, 'volume');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('volumes', 'inspect', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {

		await releaseVolumeHelperContainer(params.name, envIdNum);

		return json({ success: true });
	} catch (error: any) {
		console.error('释放数据卷辅助容器失败：', error);
		return json({
			error: '释放数据卷辅助容器失败',
			details: error.message || String(error)
		}, { status: 500 });
	}
};
