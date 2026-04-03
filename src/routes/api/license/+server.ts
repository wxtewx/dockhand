import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getLicenseStatus,
	activateLicense,
	deactivateLicense,
	getHostname
} from '$lib/server/license';
import { authorize } from '$lib/server/authorize';

// GET /api/license - Get current license status
// Any authenticated user can view license status (needed to determine if RBAC applies)
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: '需要登录' }, { status: 401 });
	}

	try {
		const status = await getLicenseStatus();
		const hostname = getHostname();

		return json({
			...status,
			hostname
		});
	} catch (error) {
		console.error('获取许可证状态失败:', error);
		return json(
			{ error: '获取许可证状态失败' },
			{ status: 500 }
		);
	}
};

// POST /api/license - Activate a license
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('license', 'manage')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const { name, key } = await request.json();

		if (!name || !key) {
			return json(
				{ error: '名称和密钥为必填项' },
				{ status: 400 }
			);
		}

		const result = await activateLicense(name, key);

		if (!result.success) {
			return json(
				{ error: result.error },
				{ status: 400 }
			);
		}

		return json({
			success: true,
			license: result.license
		});
	} catch (error) {
		console.error('激活许可证失败:', error);
		return json(
			{ error: '激活许可证失败' },
			{ status: 500 }
		);
	}
};

// DELETE /api/license - Deactivate license
export const DELETE: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('license', 'manage')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		await deactivateLicense();
		return json({ success: true });
	} catch (error) {
		console.error('停用许可证失败:', error);
		return json(
			{ error: '停用许可证失败' },
			{ status: 500 }
		);
	}
};
