import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { revokeApiToken } from '$lib/server/api-tokens';
import { isAuthEnabled } from '$lib/server/auth';
import { getRequestContext } from '$lib/server/request-context';
import { audit } from '$lib/server/audit';

/**
 * DELETE /api/auth/tokens/[id] - Revoke an API token
 */
export const DELETE: RequestHandler = async (event) => {
	const { cookies, params } = event;

	const authEnabled = await isAuthEnabled();
	if (!authEnabled) {
		return json({ error: '认证未启用' }, { status: 400 });
	}

	// Bearer tokens cannot manage tokens (prevent leaked token from revoking others)
	const reqCtx = getRequestContext();
	if (reqCtx?.authMethod === 'bearer') {
		return json({ error: '令牌管理需要会话登录' }, { status: 403 });
	}

	const auth = await authorize(cookies);
	if (!auth.isAuthenticated || !auth.user) {
		return json({ error: '需要认证' }, { status: 401 });
	}

	const tokenId = parseInt(params.id);
	if (isNaN(tokenId)) {
		return json({ error: '无效的令牌 ID' }, { status: 400 });
	}

	const success = await revokeApiToken(tokenId, auth.user.id, auth.isAdmin);
	if (!success) {
		return json({ error: '令牌不存在或无访问权限' }, { status: 404 });
	}

	await audit(event, 'delete', 'api_token', {
		entityId: params.id,
		description: `API 令牌已吊销`
	});

	return json({ success: true });
};
