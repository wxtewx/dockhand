import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import {
	createPasskeyCredential,
	getPasskeyCredentialByCredentialId,
	getPasskeyCredentialByNameForUser,
	getPasskeyCredentialsForUser,
	getPasskeysEnabled
} from '$lib/server/db';
import { isAuthEnabled, SESSION_COOKIE, validateSession } from '$lib/server/auth';
import {
	encodeWebAuthnBytes,
	getWebAuthnConfig,
	hasExactWebAuthnOrigin,
	webAuthnChallenges
} from '$lib/server/webauthn';

const NO_STORE = { 'Cache-Control': 'no-store' };

function uniqueConstraint(error: unknown): 'name' | 'credential' | null {
	if (typeof error !== 'object' || error === null) return null;
	const candidate = error as { code?: string; constraint?: string; message?: string };
	const detail = `${candidate.constraint || ''} ${candidate.message || ''}`;
	const isUnique = candidate.code === '23505'
		|| candidate.code === 'SQLITE_CONSTRAINT_UNIQUE'
		|| /unique constraint/i.test(detail);
	if (!isUnique) return null;
	return /passkey_credentials_user_name_unique/i.test(detail) ? 'name' : 'credential';
}

/**
 * @openapi
 * summary: Finish registering a passkey
 * description: Verifies the attestation and stores the credential against the signed-in user, along with the AAGUID identifying the authenticator model.
 * body: {ceremonyId:string!, response:object!}
 * resp-200-desc: The passkey was registered
 * resp-400: Authentication is not enabled, the ceremony expired, or verification failed
 * resp-401: Not authenticated
 * resp-403: Passkeys are disabled on this instance, or the request origin does not match the configured ORIGIN
 * resp-409: This passkey is already registered
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

	let body: { ceremonyId?: string; response?: RegistrationResponseJSON };
	try {
		body = await request.json();
	} catch {
		return json({ error: '无效请求' }, { status: 400, headers: NO_STORE });
	}

	if (!body.ceremonyId || !body.response) return json({ error: '无效请求' }, { status: 400, headers: NO_STORE });
	const ceremony = webAuthnChallenges.consume(body.ceremonyId, 'registration', { userId: user.id, sessionId });
	if (!ceremony?.userHandle || !ceremony.passkeyName) {
		return json({ error: '通行密钥交互流程已过期或无效' }, { status: 400, headers: NO_STORE });
	}
	if (await getPasskeyCredentialByNameForUser(user.id, ceremony.passkeyName)) {
		return json({ error: '已存在同名的通行密钥' }, { status: 409, headers: NO_STORE });
	}

	try {
		const verification = await verifyRegistrationResponse({
			response: body.response,
			expectedChallenge: ceremony.challenge,
			expectedOrigin: config.expectedOrigin,
			expectedRPID: config.rpId,
			requireUserVerification: true
		});
		if (!verification.verified || !verification.registrationInfo) {
			return json({ error: '通行密钥注册校验失败' }, { status: 400, headers: NO_STORE });
		}

		const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;
		if (await getPasskeyCredentialByCredentialId(credential.id)) {
			return json({ error: '该通行密钥已注册' }, { status: 409, headers: NO_STORE });
		}

		const existingCredentials = await getPasskeyCredentialsForUser(user.id);
		if (existingCredentials.some((item) => item.webauthnUserId !== ceremony.userHandle)) {
			return json({ error: '通行密钥用户句柄不匹配' }, { status: 400, headers: NO_STORE });
		}

		const saved = await createPasskeyCredential({
			userId: user.id,
			credentialId: credential.id,
			webauthnUserId: ceremony.userHandle,
			publicKey: encodeWebAuthnBytes(credential.publicKey),
			counter: credential.counter,
			deviceType: credentialDeviceType,
			backedUp: credentialBackedUp,
			transports: credential.transports ? JSON.stringify(credential.transports) : null,
			// Identifies the authenticator model, so a credential can be named after the
			// manager it lives in.
			aaguid: aaguid || null,
			name: ceremony.passkeyName
		});

		return json({
			success: true,
			passkey: {
				id: saved.id,
				name: saved.name,
				deviceType: saved.deviceType,
				backedUp: saved.backedUp,
				createdAt: saved.createdAt
			}
		}, { headers: NO_STORE });
	} catch (error) {
		const constraint = uniqueConstraint(error);
		if (constraint === 'name') {
			return json({ error: '已存在同名的通行密钥' }, { status: 409, headers: NO_STORE });
		}
		if (constraint === 'credential') {
			return json({ error: '该通行密钥已注册' }, { status: 409, headers: NO_STORE });
		}
		return json({ error: '通行密钥注册校验失败' }, { status: 400, headers: NO_STORE });
	}
};
