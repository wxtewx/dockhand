import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { isAuthEnabled } from '$lib/server/auth';
import { getPasskeysEnabled } from '$lib/server/db';
import {
	getWebAuthnConfig,
	hasExactWebAuthnOrigin,
	webAuthnChallenges
} from '$lib/server/webauthn';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * @openapi
 * summary: Begin signing in with a passkey
 * description: Returns the WebAuthn request options and a ceremony id to send back to the verify endpoint. Reachable without a session, since it runs before sign-in. The ceremony is single-use and expires after five minutes.
 * resp-200-desc: Request options and the ceremony id
 * resp-400: Authentication is not enabled
 * resp-403: Passkeys are disabled on this instance, or the request origin does not match the configured ORIGIN
 * resp-503: Passkeys are not configured (ORIGIN missing or not HTTPS)
 */
export const POST: RequestHandler = async ({ request }) => {
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

	const options = await generateAuthenticationOptions({
		rpID: config.rpId,
		userVerification: 'required'
	});
	try {
		const ceremony = webAuthnChallenges.issue(options.challenge, 'authentication');
		return json({ ceremonyId: ceremony.id, options }, { headers: NO_STORE });
	} catch {
		return json({ error: '通行密钥待处理请求过多，请稍后重试' }, { status: 503, headers: NO_STORE });
	}
};
