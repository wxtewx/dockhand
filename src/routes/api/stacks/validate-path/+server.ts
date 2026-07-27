import { json, type RequestHandler } from '@sveltejs/kit';
import { authorize } from '$lib/server/authorize';
import { validatePath } from '$lib/server/stack-scanner';
import { getExternalStackPaths } from '$lib/server/db';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const { path } = await request.json();

		if (!path || typeof path !== 'string') {
			return json({ valid: false, error: '路径为必填项' });
		}

		// Get existing paths to check for overlaps
		const existingPaths = await getExternalStackPaths();

		const result = validatePath(path, existingPaths);
		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : '未知错误';
		return json({ valid: false, error: message });
	}
};
