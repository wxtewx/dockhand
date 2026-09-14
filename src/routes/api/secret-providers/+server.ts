import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSecretProviders, createSecretProvider } from '$lib/server/db';
import { hasProvider } from '$lib/server/secretproviders';
import { authorize } from '$lib/server/authorize';
import { auditSecretProvider } from '$lib/server/audit';

/**
 * @openapi
 * summary: List configured secret providers (summaries never include the decrypted config)
 * resp-200: array<{id:integer!, name:string!, type:string!}>
 * resp-403: Permission denied (needs secrets:view)
 * resp-500: Failed to fetch secret providers
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('secrets', 'view'))) {
		return json({ error: '权限拒绝' }, { status: 403 });
	}

	try {
		// Summaries never include the decrypted config.
		const providers = await getSecretProviders();
		return json(providers);
	} catch (error) {
		console.error('获取密钥提供程序时出错:', error);
		return json({ error: '获取密钥提供程序失败' }, { status: 500 });
	}
};

/**
 * @openapi
 * summary: Create a secret provider (Vault, Infisical, Doppler, 1Password Connect)
 * body: {name:string!, type:string!, config:object!}
 * resp-201: {id:integer!, name:string!, type:string!}
 * resp-400: Name and type are required, unknown provider type, config missing, or a provider with this name already exists
 * resp-403: Permission denied (needs secrets:create)
 * resp-500: Failed to create secret provider
 */
export const POST: RequestHandler = async (event) => {
	const { request, cookies } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('secrets', 'create'))) {
		return json({ error: '权限拒绝' }, { status: 403 });
	}

	try {
		const data = await request.json();
		const name = typeof data.name === 'string' ? data.name.trim() : '';
		const type = typeof data.type === 'string' ? data.type.trim() : '';
		const config = data.config;

		if (!name || !type) {
			return json({ error: '名称与类型为必填项' }, { status: 400 });
		}
		if (!hasProvider(type)) {
			return json({ error: `未知的密钥提供程序类型: ${type}` }, { status: 400 });
		}
		if (!config || typeof config !== 'object' || Array.isArray(config)) {
			return json({ error: '配置为必填项' }, { status: 400 });
		}

		const existing = await getSecretProviders();
		if (existing.some((p) => p.name.trim() === name)) {
			return json({ error: '已存在同名的密钥提供程序' }, { status: 400 });
		}

		const provider = await createSecretProvider({ type, name, config });
		await auditSecretProvider(event, 'create', provider.id, provider.name, { type });
		// Never return the decrypted config.
		return json(provider, { status: 201 });
	} catch (error: any) {
		console.error('创建密钥提供程序时出错:', error);
		return json({ error: '创建密钥提供程序失败' }, { status: 500 });
	}
};
