import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { handleOidcCallback, createUserSession, isAuthEnabled } from '$lib/server/auth';
import { auditAuth } from '$lib/server/audit';

// GET /api/auth/oidc/callback - Handle OIDC callback from IdP
export const GET: RequestHandler = async (event) => {
	const { url, cookies } = event;
	// Check if auth is enabled
	if (!await isAuthEnabled()) {
		throw redirect(302, '/login?error=auth_disabled');
	}

	// Get parameters from URL
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');
	const errorDescription = url.searchParams.get('error_description');

	// Extract client IP for logging
	const clientIp = event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
		|| event.request.headers.get('x-real-ip')
		|| event.getClientAddress();

	// Handle error from IdP
	if (error) {
		console.error('来自身份提供商的 OIDC 错误:', error, errorDescription);
		console.warn(`[Auth] OIDC 登录失败: IP=${clientIp} 错误=${errorDescription || error}`);
		const errorMsg = encodeURIComponent(errorDescription || error);
		throw redirect(302, `/login?error=${errorMsg}`);
	}

	// Validate required parameters
	if (!code || !state) {
		throw redirect(302, '/login?error=invalid_callback');
	}

	try {
		const result = await handleOidcCallback(code, state);

		if (!result.success || !result.user) {
			console.warn(`[Auth] OIDC 登录失败: IP=${clientIp} 错误=${result.error || '身份验证失败'}`);
			const errorMsg = encodeURIComponent(result.error || '身份验证失败');
			throw redirect(302, `/login?error=${errorMsg}`);
		}

		// Create session
		await createUserSession(result.user.id, 'oidc', cookies, event.request);
		console.log(`[Auth] OIDC 登录成功: 用户=${result.user.username} 提供商=${result.providerName || 'oidc'} IP=${clientIp}`);

		// Audit log
		await auditAuth(event, 'login', result.user.username, {
			provider: 'oidc',
			providerId: result.providerId,
			providerName: result.providerName
		});

		// Redirect to the original destination or home
		const redirectUrl = result.redirectUrl || '/';
		throw redirect(302, redirectUrl);
	} catch (error: any) {
		// Re-throw redirect
		if (error.status === 302) {
			throw error;
		}
		console.error('OIDC 回调错误:', error);
		const errorMsg = encodeURIComponent(error.message || '身份验证失败');
		throw redirect(302, `/login?error=${errorMsg}`);
	}
};
