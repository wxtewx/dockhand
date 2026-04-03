import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
	authenticateLocal,
	authenticateLdap,
	getEnabledLdapConfigs,
	createUserSession,
	isRateLimited,
	recordFailedAttempt,
	clearRateLimit,
	verifyMfaToken,
	isAuthEnabled
} from '$lib/server/auth';
import { getUser, getUserByUsername } from '$lib/server/db';
import { auditAuth } from '$lib/server/audit';

// POST /api/auth/login - Authenticate user
export const POST: RequestHandler = async (event) => {
	const { request, cookies, getClientAddress } = event;
	// Check if auth is enabled
	if (!(await isAuthEnabled())) {
		return json({ error: '身份验证未启用' }, { status: 400 });
	}

	try {
		const { username, password, mfaToken, provider = 'local' } = await request.json();

		if (!username || !password) {
			return json({ error: '用户名和密码为必填项' }, { status: 400 });
		}

		// Rate limiting by IP and username
		const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
			|| request.headers.get('x-real-ip')
			|| getClientAddress();
		const rateLimitKey = `${clientIp}:${username}`;

		const { limited, retryAfter } = isRateLimited(rateLimitKey);
		if (limited) {
			console.warn(`[Auth] 登录频率限制：用户=${username} IP=${clientIp} 重试等待=${retryAfter}秒`);
			return json(
				{ error: `登录尝试次数过多，请在 ${retryAfter} 秒后重试。` },
				{ status: 429 }
			);
		}

		// Reject local login attempts when DISABLE_LOCAL_LOGIN is set
		if (provider === 'local' && process.env.DISABLE_LOCAL_LOGIN === 'true') {
			return json({ error: '本地登录已禁用' }, { status: 403 });
		}

		// Attempt authentication based on provider
		let result: any;
		let authProviderType: 'local' | 'ldap' | 'oidc' = 'local';

		if (provider.startsWith('ldap:')) {
			// LDAP provider with specific config ID (e.g., "ldap:1")
			const configId = parseInt(provider.split(':')[1], 10);
			result = await authenticateLdap(username, password, configId);
			authProviderType = 'ldap';
		} else if (provider === 'ldap') {
			// Generic LDAP (will try all enabled configs)
			result = await authenticateLdap(username, password);
			authProviderType = 'ldap';
		} else {
			result = await authenticateLocal(username, password);
			authProviderType = 'local';
		}

		if (!result.success) {
			recordFailedAttempt(rateLimitKey);
			console.warn(`[Auth] 登录失败：用户=${username} 提供商=${authProviderType} IP=${clientIp} 原因=${result.error || '身份验证失败'}`);
			return json({ error: result.error || '身份验证失败' }, { status: 401 });
		}

		// Handle MFA if required
		if (result.requiresMfa) {
			if (!mfaToken) {
				// Return that MFA is required
				return json({ requiresMfa: true }, { status: 200 });
			}

			// Verify MFA token
			const user = await getUserByUsername(username);
			if (!user || !(await verifyMfaToken(user.id, mfaToken))) {
				recordFailedAttempt(rateLimitKey);
				console.warn(`[Auth] MFA验证失败：用户=${username} IP=${clientIp}`);
				return json({ error: '无效的MFA验证码' }, { status: 401 });
			}

			// MFA verified, create session
			const session = await createUserSession(user.id, authProviderType, cookies, request);
			clearRateLimit(rateLimitKey);
			console.log(`[Auth] 登录成功：用户=${username} 提供商=${authProviderType} IP=${clientIp} MFA=已验证`);

			// Audit log
			await auditAuth(event, 'login', user.username, {
				provider: authProviderType,
				mfa: true
			});

			return json({
				success: true,
				user: {
					id: user.id,
					username: user.username,
					email: user.email,
					displayName: user.displayName,
					isAdmin: user.isAdmin
				}
			});
		}

		// No MFA, create session directly
		if (result.user) {
			const session = await createUserSession(result.user.id, authProviderType, cookies, request);
			clearRateLimit(rateLimitKey);
			console.log(`[Auth] 登录成功：用户=${result.user.username} 提供商=${authProviderType} IP=${clientIp} MFA=未启用`);

			// Audit log
			await auditAuth(event, 'login', result.user.username, {
				provider: authProviderType
			});

			return json({
				success: true,
				user: {
					id: result.user.id,
					username: result.user.username,
					email: result.user.email,
					displayName: result.user.displayName,
					isAdmin: result.user.isAdmin
				}
			});
		}

		return json({ error: '身份验证失败' }, { status: 401 });
	} catch (error) {
		console.error('登录错误：', error);
		return json({ error: '登录失败' }, { status: 500 });
	}
};
