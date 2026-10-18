import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import {
	getPasskeyCredentialByNameForUser,
	getPasskeyCredentialsForUser,
	getPasskeysEnabled
} from '$lib/server/db';
import { isAuthEnabled, SESSION_COOKIE, validateSession } from '$lib/server/auth';
import {
	decodeWebAuthnBytes,
	getWebAuthnConfig,
	hasExactWebAuthnOrigin,
	newWebAuthnUserHandle,
	webAuthnChallenges,
	WEBAUTHN_RP_NAME
} from '$lib/server/webauthn';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * @openapi
 * summary: Begin registering a passkey for the signed-in user
 * description: Returns the WebAuthn creation options and a ceremony id to send back to the verify endpoint. Requires a session, since registering acts on the current account.
 * body: {name:string!}
 * resp-200-desc: Creation options and the ceremony id
 * resp-400: Authentication is not enabled, or the name is missing or too long
 * resp-401: Not authenticated
 * resp-403: Passkeys are disabled on this instance, or the request origin does not match the configured ORIGIN
 * resp-409: A passkey with this name already exists for the user
 * resp-503: Passkeys are not configured (ORIGIN missing or not HTTPS)
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
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

	const user = await validateSession(cookies);
	const sessionId = cookies.get(SESSION_COOKIE);
	if (!user || !sessionId) return json({ error: '未通过身份认证' }, { status: 401, headers: NO_STORE });

	let name = '';
	try {
		const body = await request.json();
		name = typeof body?.name === 'string' ? body.name.trim() : '';
	} catch {
		return json({ error: '请输入通行密钥名称' }, { status: 400, headers: NO_STORE });
	}
	if (!name) return json({ error: '请输入通行密钥名称' }, { status: 400, headers: NO_STORE });
	if (name.length > 64) return json({ error: '通行密钥名称不能超过 64 个字符' }, { status: 400, headers: NO_STORE });
	if (await getPasskeyCredentialByNameForUser(user.id, name)) {
		return json({ error: '已存在同名的通行密钥' }, { status: 409, headers: NO_STORE });
	}

	const credentials = await getPasskeyCredentialsForUser(user.id);
	const userHandle = credentials[0]?.webauthnUserId || newWebAuthnUserHandle();
	const options = await generateRegistrationOptions({
		rpName: WEBAUTHN_RP_NAME,
		rpID: config.rpId,
		userID: decodeWebAuthnBytes(userHandle),
		userName: user.username,
		userDisplayName: user.displayName || user.username,
		attestationType: 'none',
		excludeCredentials: credentials.map((credential) => ({
			id: credential.credentialId,
			transports: credential.transports ? JSON.parse(credential.transports) : undefined
		})),
		authenticatorSelection: {
			residentKey: 'required',
			userVerification: 'required'
		}
	});

	try {
		const ceremony = webAuthnChallenges.issue(options.challenge, 'registration', {
			userId: user.id,
			sessionId,
			userHandle,
			passkeyName: name
		});
		return json({ ceremonyId: ceremony.id, options }, { headers: NO_STORE });
	} catch {
		return json({ error: '通行密钥待处理请求过多，请稍后重试' }, { status: 503, headers: NO_STORE });
	}
};
