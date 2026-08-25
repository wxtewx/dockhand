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
/**
 * @openapi
 * summary: Test an unsaved repository configuration (url/branch/credentialId) before creating it
 * description: credentialId from GET /api/git/credentials.
 * body: {url:string!, branch:string, credentialId:integer}
 * body-example: {"url":"https://github.com/example/homelab.git","branch":"main","credentialId":2}
 * resp-200: {success:boolean!, error:string}
 * resp-200-example: {"success":true}
 * resp-400: The url field is missing
 * resp-403: Caller lacks the settings:manage permission
 * resp-500: The connectivity test failed
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
