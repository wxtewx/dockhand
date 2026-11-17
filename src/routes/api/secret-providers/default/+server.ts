import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, setSetting, deleteSetting, getSecretProviders } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import {
	DEFAULT_SECRET_PROVIDER_SETTING,
	parseDefaultProviderId,
	resolveDefaultProviderId
} from '$lib/utils/default-secret-provider';

/**
 * @openapi
 * summary: Get the global default secret provider preselected for new stacks
 * description: Returns null when no default is set, or when the stored provider no longer exists.
 * resp-200: {providerId:integer}
 * resp-403: Permission denied (needs secrets:view)
 * resp-500: Failed to read the default secret provider
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('secrets', 'view'))) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const [raw, providers] = await Promise.all([
			getSetting(DEFAULT_SECRET_PROVIDER_SETTING),
			getSecretProviders()
		]);
		return json({ providerId: resolveDefaultProviderId(raw, providers) });
	} catch (error) {
		console.error('读取默认密钥提供程序时出错:', error);
		return json({ error: '读取默认密钥提供程序失败' }, { status: 500 });
	}
};

/**
 * @openapi
 * summary: Set or clear the global default secret provider
 * description: Pass a provider id to make it the default, or null to clear it.
 * body: {providerId:integer}
 * resp-200: {providerId:integer}
 * resp-400: Invalid provider id, or the provider does not exist
 * resp-403: Permission denied (needs secrets:edit)
 * resp-500: Failed to save the default secret provider
 */
export const PUT: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('secrets', 'edit'))) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const body = await request.json();

		if (body?.providerId === null || body?.providerId === undefined) {
			await deleteSetting(DEFAULT_SECRET_PROVIDER_SETTING);
			return json({ providerId: null });
		}

		const providerId = parseDefaultProviderId(body.providerId);
		if (providerId === null) {
			return json({ error: '无效的提供程序 ID' }, { status: 400 });
		}

		const providers = await getSecretProviders();
		if (!providers.some((p) => p.id === providerId)) {
			return json({ error: '未找到密钥提供程序' }, { status: 400 });
		}

		await setSetting(DEFAULT_SECRET_PROVIDER_SETTING, providerId);
		return json({ providerId });
	} catch (error) {
		console.error('保存默认密钥提供程序时出错:', error);
		return json({ error: '保存默认密钥提供程序失败' }, { status: 500 });
	}
};
