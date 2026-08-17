import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { hasProvider, testProviderConnection } from '$lib/server/secretproviders';

/** Test a provider config before it's persisted to the database. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !(await auth.can('secrets', 'create'))) {
		return json({ error: '权限拒绝' }, { status: 403 });
	}

	let type = '';
	let config: unknown;
	try {
		const data = await request.json();
		type = typeof data.type === 'string' ? data.type.trim() : '';
		config = data.config;
	} catch {
		return json({ error: '无效的请求体' }, { status: 400 });
	}

	if (!type || !hasProvider(type)) {
		return json({ ok: false, error: '需要有效的提供程序类型' }, { status: 200 });
	}
	if (!config || typeof config !== 'object' || Array.isArray(config)) {
		return json({ ok: false, error: '配置为必填项' }, { status: 200 });
	}

	const result = await testProviderConnection(type, config as any);
	return json(result);
};
