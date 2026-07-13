import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { parseRegistryUrl, getRegistryAuthHeader, DOCKER_HUB_HOSTS } from '$lib/server/docker';
import { getRegistry } from '$lib/server/db';

/**
 * Test registry connectivity and credentials.
 *
 * Accepts either inline credentials (from the modal form) or a registry ID
 * (to test an already-saved registry using stored credentials).
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('registries', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	const data = await request.json();
	let url: string;
	let username: string | undefined;
	let password: string | undefined;

	if (data.registryId) {
		// Test a saved registry — fetch credentials from DB
		const reg = await getRegistry(data.registryId);
		if (!reg) return json({ error: '镜像仓库不存在' }, { status: 404 });
		url = reg.url;
		username = reg.username || undefined;
		password = reg.password || undefined;
	} else {
		url = data.url;
		username = data.username?.trim() || undefined;
		password = data.password?.trim() || undefined;
	}

	if (!url) {
		return json({ error: '地址为必填项' }, { status: 400 });
	}

	const parsed = parseRegistryUrl(url);
	const apiBase = `${parsed.protocol}://${parsed.host}`;

	try {
		// Step 1: connectivity — can we reach /v2/ at all?
		const pingResp = await fetch(`${apiBase}/v2/`, {
			method: 'GET',
			headers: { 'User-Agent': 'Dockhand/1.0' },
			signal: AbortSignal.timeout(10_000)
		});

		const hasAuth = pingResp.status === 401;
		const isOpen = pingResp.ok;

		if (!isOpen && !hasAuth) {
			return json({
				success: false,
				connectivity: false,
				message: `镜像仓库返回 HTTP 状态码 ${pingResp.status}`
			});
		}

		// Step 2: if credentials provided, test authentication.
		// Empty scope — we only care whether the registry accepts the login.
		// Asking for a privileged scope like registry:catalog:* causes Docker
		// Hub to reject the request with HTTP 400 for non-admin users even
		// when their credentials are valid.
		if (username && password) {
			const authHeader = await getRegistryAuthHeader(url, '', { username, password });

			if (!authHeader) {
				return json({
					success: false,
					connectivity: true,
					authenticated: false,
					message: '身份验证失败，请检查用户名与密码'
				});
			}

			// Verify the token works
			const authResp = await fetch(`${apiBase}/v2/`, {
				method: 'GET',
				headers: {
					'User-Agent': 'Dockhand/1.0',
					'Authorization': authHeader
				},
				signal: AbortSignal.timeout(10_000)
			});

			if (!authResp.ok) {
				return json({
					success: false,
					connectivity: true,
					authenticated: false,
					message: `身份令牌被拒绝 (HTTP ${authResp.status})`
				});
			}

			const isHub = DOCKER_HUB_HOSTS.has(parsed.host);
			return json({
				success: true,
				connectivity: true,
				authenticated: true,
				message: isHub
					? `已使用账号 ${username} 连接 Docker Hub`
					: `连接成功，当前登录账号：${username}`
			});
		}

		// No credentials — just report connectivity
		const isHub = DOCKER_HUB_HOSTS.has(parsed.host);
		return json({
			success: true,
			connectivity: true,
			authenticated: null,
			message: isHub
				? '可访问 Docker Hub (未提供账号密码进行验证)'
				: isOpen
					? '镜像仓库可访问 (无需身份验证)'
					: '镜像仓库可访问 (需要身份验证)'
		});
	} catch (e: any) {
		const msg = e?.cause?.code || e?.message || String(e);
		return json({
			success: false,
			connectivity: false,
			message: `连接失败: ${msg}`
		});
	}
};
