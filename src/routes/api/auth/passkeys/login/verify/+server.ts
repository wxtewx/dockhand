import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import {
	getPasskeyCredentialByCredentialId,
	getUser,
	updatePasskeyCounter,
	getPasskeysEnabled
} from '$lib/server/db';
import { createUserSession, isAuthEnabled } from '$lib/server/auth';
import { auditAuth } from '$lib/server/audit';
import {
	decodeWebAuthnBytes,
	getWebAuthnConfig,
	hasExactWebAuthnOrigin,
	webAuthnChallenges
} from '$lib/server/webauthn';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * @openapi
 * summary: Finish signing in with a passkey
 * description: Verifies the authenticator's assertion and, on success, issues the session cookie. A passkey requires user verification, so it is accepted as the whole interactive sign-in without a separate second factor.
 * body: {ceremonyId:string!, response:object!}
 * resp-200-desc: Sign-in succeeded and the session cookie was set
 * resp-400: Authentication is not enabled, the body is malformed, or the ceremony expired
 * resp-401: Passkey authentication failed
 * resp-403: Passkeys are disabled on this instance, or the request origin does not match the configured ORIGIN
 * resp-503: Passkeys are not configured (ORIGIN missing or not HTTPS)
 */
export const POST: RequestHandler = async (event) => {
	const { request, cookies } = event;
	if (!(await isAuthEnabled())) return json({ error: '未启用身份认证' }, { status: 400, headers: NO_STORE });
	// Hiding the button is not switching the feature off: the endpoints answer a
	// direct request too, so the administrator's setting is enforced here.
	if (!(await getPasskeysEnabled())) return json({ error: '此实例已禁用通行密钥' }, { status: 403, headers: NO_STORE });

	let config;
	try {
		config = getWebAuthnConfig();
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : '通行密钥未配置' }, { status: 503, headers: NO_STORE });
	}
	if (!hasExactWebAuthnOrigin(request)) return json({ error: '无效的请求源' }, { status: 403, headers: NO_STORE });

	let body: { ceremonyId?: string; response?: AuthenticationResponseJSON };
	try {
		body = await request.json();
	} catch {
		return json({ error: '无效请求' }, { status: 400, headers: NO_STORE });
	}
	if (!body.ceremonyId || !body.response) return json({ error: '无效请求' }, { status: 400, headers: NO_STORE });

	const ceremony = webAuthnChallenges.consume(body.ceremonyId, 'authentication');
	if (!ceremony) return json({ error: '通行密钥交互流程已过期或无效' }, { status: 400, headers: NO_STORE });

	try {
		const credential = await getPasskeyCredentialByCredentialId(body.response.id);
		if (!credential) return json({ error: '通行密钥认证失败' }, { status: 401, headers: NO_STORE });

		const user = await getUser(credential.userId);
		if (!user?.isActive) return json({ error: '通行密钥认证失败' }, { status: 401, headers: NO_STORE });

		const responseUserHandle = body.response.response.userHandle;
		if (!responseUserHandle || responseUserHandle !== credential.webauthnUserId) {
			return json({ error: '通行密钥认证失败' }, { status: 401, headers: NO_STORE });
		}

		const verification = await verifyAuthenticationResponse({
			response: body.response,
			expectedChallenge: ceremony.challenge,
			expectedOrigin: config.expectedOrigin,
			expectedRPID: config.rpId,
			credential: {
				id: credential.credentialId,
				publicKey: decodeWebAuthnBytes(credential.publicKey),
				counter: credential.counter,
				transports: credential.transports ? JSON.parse(credential.transports) : undefined
			},
			requireUserVerification: true
		});
		if (!verification.verified) return json({ error: '通行密钥认证失败' }, { status: 401, headers: NO_STORE });

		const counterUpdated = await updatePasskeyCounter(
			credential.id,
			credential.counter,
			verification.authenticationInfo.newCounter
		);
		if (!counterUpdated) return json({ error: '通行密钥认证失败' }, { status: 401, headers: NO_STORE });

		// A verified Passkey is the complete interactive authentication factor. It
		// deliberately enters the existing session path without a separate TOTP step.
		await createUserSession(user.id, 'passkey', cookies, request);
		await auditAuth(event, 'login', user.username, { provider: 'passkey' });

		return json({ success: true }, { headers: NO_STORE });
	} catch {
		return json({ error: '通行密钥认证失败' }, { status: 401, headers: NO_STORE });
	}
};
