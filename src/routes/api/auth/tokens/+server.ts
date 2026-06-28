import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { generateApiToken, listUserTokens } from '$lib/server/api-tokens';
import { isAuthEnabled, verifyPassword } from '$lib/server/auth';
import { getUser } from '$lib/server/db';
import { audit } from '$lib/server/audit';
import { getRequestContext } from '$lib/server/request-context';

// Password confirmation rate limiting (per userId)
const pwFailCounts = new Map<number, { count: number; firstFail: number }>();
const pwCooldowns = new Map<number, number>();
const PW_FAIL_WINDOW = 60_000; // 1-minute sliding window
const PW_FAIL_MAX = 5; // max failures per window
const PW_COOLDOWN = 5 * 60 * 1000; // 5-minute cooldown

const MAX_TOKENS_PER_USER = 25;

// Periodic cleanup
setInterval(() => {
	const now = Date.now();
	for (const [id, until] of pwCooldowns) {
		if (now > until) pwCooldowns.delete(id);
	}
	for (const [id, entry] of pwFailCounts) {
		if (now - entry.firstFail > PW_FAIL_WINDOW) pwFailCounts.delete(id);
	}
}, PW_COOLDOWN).unref?.();

function isPwRateLimited(userId: number): boolean {
	const until = pwCooldowns.get(userId);
	if (!until) return false;
	if (Date.now() > until) {
		pwCooldowns.delete(userId);
		return false;
	}
	return true;
}

function recordPwFailure(userId: number): void {
	const now = Date.now();
	const entry = pwFailCounts.get(userId);
	if (!entry || now - entry.firstFail > PW_FAIL_WINDOW) {
		pwFailCounts.set(userId, { count: 1, firstFail: now });
		return;
	}
	entry.count++;
	if (entry.count >= PW_FAIL_MAX) {
		pwCooldowns.set(userId, now + PW_COOLDOWN);
		pwFailCounts.delete(userId);
	}
}

/**
 * GET /api/auth/tokens - List the current user's API tokens
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const authEnabled = await isAuthEnabled();
	if (!authEnabled) {
		return json({ error: '认证未启用' }, { status: 400 });
	}

	const auth = await authorize(cookies);
	if (!auth.isAuthenticated || !auth.user) {
		return json({ error: '需要认证' }, { status: 401 });
	}

	const tokens = await listUserTokens(auth.user.id);
	return json(tokens);
};

/**
 * POST /api/auth/tokens - Create a new API token
 */
export const POST: RequestHandler = async (event) => {
	const { cookies, request } = event;

	const authEnabled = await isAuthEnabled();
	if (!authEnabled) {
		return json({ error: '认证未启用' }, { status: 400 });
	}

	const auth = await authorize(cookies);
	if (!auth.isAuthenticated || !auth.user) {
		return json({ error: '需要认证' }, { status: 401 });
	}

	// Token creation requires a cookie session — a Bearer token cannot create new tokens
	const reqCtx = getRequestContext();
	if (reqCtx?.authMethod === 'bearer') {
		return json({ error: '创建令牌需要会话登录，不支持 Bearer token' }, { status: 403 });
	}

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ error: '无效的请求体' }, { status: 400 });
	}
	const { name, expiresAt, password } = body;

	// Local users must confirm their password to create tokens
	// SSO/OIDC and LDAP users skip this (they authenticated via their IdP)
	if (auth.user.provider === 'local') {
		if (isPwRateLimited(auth.user.id)) {
			return json({ error: '密码尝试失败次数过多，请稍后再试。' }, { status: 429 });
		}
		if (!password || typeof password !== 'string') {
			return json({ error: '创建 API 令牌需要密码' }, { status: 400 });
		}
		const dbUser = await getUser(auth.user.id);
		if (!dbUser) {
			return json({ error: '用户不存在' }, { status: 404 });
		}
		const valid = await verifyPassword(password, dbUser.passwordHash);
		if (!valid) {
			recordPwFailure(auth.user.id);
			return json({ error: '密码无效' }, { status: 403 });
		}
	}

	// L2: Per-user token count limit
	const existingTokens = await listUserTokens(auth.user.id);
	if (existingTokens.length >= MAX_TOKENS_PER_USER) {
		return json({ error: `每个用户最多创建 ${MAX_TOKENS_PER_USER} 个 API 令牌` }, { status: 400 });
	}

	// Validate name
	if (!name || typeof name !== 'string' || name.trim().length === 0) {
		return json({ error: '令牌名称不能为空' }, { status: 400 });
	}
	if (name.length > 255) {
		return json({ error: '令牌名称长度不能超过 255 个字符' }, { status: 400 });
	}

	// Validate expiration
	if (expiresAt) {
		const expiryDate = new Date(expiresAt);
		if (isNaN(expiryDate.getTime())) {
			return json({ error: '无效的过期日期' }, { status: 400 });
		}
		if (expiryDate <= new Date()) {
			return json({ error: '过期日期必须是未来时间' }, { status: 400 });
		}
	}

	const result = await generateApiToken(
		auth.user.id,
		name.trim(),
		expiresAt || null
	);

	await audit(event, 'create', 'api_token', {
		entityId: String(result.id),
		entityName: name.trim(),
		description: `API 令牌 "${name.trim()}" 已创建`
	});

	return json({
		id: result.id,
		token: result.token,
		tokenPrefix: result.tokenPrefix
	}, { status: 201, headers: { 'Cache-Control': 'no-store' } });
};
