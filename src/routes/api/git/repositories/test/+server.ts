import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { testRepositoryConfig } from '$lib/server/git';
import { authorize } from '$lib/server/authorize';

/**
 * POST /api/git/repositories/test
 * Test a git repository configuration before saving.
 * Uses stored credentials via credentialId.
 *
 * Body: {
 *   url: string;           // Repository URL to test
 *   branch: string;        // Branch name to verify
 *   credentialId?: number; // Optional credential ID from database
 * }
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'manage')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const body = await request.json();

		if (!body.url || typeof body.url !== 'string') {
			return json({ error: '仓库 URL 为必填项' }, { status: 400 });
		}

		const result = await testRepositoryConfig({
			url: body.url,
			branch: body.branch || 'main',
			credentialId: body.credentialId ?? null
		});

		return json(result);
	} catch (error) {
		console.error('测试仓库配置失败:', error);
		return json({ success: false, error: '测试仓库配置失败' }, { status: 500 });
	}
};
