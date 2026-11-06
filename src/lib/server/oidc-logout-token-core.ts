/**
 * Proving a back-channel logout_token really came from the configured provider.
 *
 * The IdP POSTs this token to end a session with no browser in the loop, so its claims
 * decide whose session dies. Nothing is read out of it until the signature, issuer and
 * audience are proven. Kept apart from the OIDC flow so a test calls the real thing: the
 * only I/O is fetching the provider signing keys, and that arrives as an argument.
 *
 * The rules are the OIDC Back-Channel Logout 1.0 inverse of an id_token: an id_token
 * REQUIRES a nonce, a logout_token FORBIDS one; a logout_token must carry the events
 * claim and at least one of sub/sid. So this does not reuse verifyIdTokenWithKeys.
 */

import { jwtVerify, type JWTVerifyGetKey, type KeyObject } from 'jose';
import { DEFAULT_ID_TOKEN_ALGORITHMS, ID_TOKEN_CLOCK_TOLERANCE_SECONDS } from './oidc-token-core';

/** The event URI a logout_token must carry so it cannot be mistaken for another token type. */
export const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

export interface LogoutTokenExpectations {
	/** The issuer the provider names in its own discovery document. */
	issuer: string;
	/** This deployment's client id, which the token must be addressed to. */
	clientId: string;
}

/** What a verified logout_token tells us: which session(s) to end, and its replay id. */
export interface LogoutTokenResult {
	sub?: string;
	sid?: string;
	jti?: string;
}

/**
 * Verify a back-channel logout_token and return the sub/sid it authorises ending.
 *
 * Throws with a reason a person can act on. The signature, issuer and audience are
 * checked by jose first; only then are the logout-specific claim rules applied, so no
 * value is trusted before the token is proven to come from this provider.
 */
export async function verifyLogoutTokenWithKeys(
	logoutToken: string,
	keys: JWTVerifyGetKey | KeyObject | CryptoKey | Uint8Array,
	expected: LogoutTokenExpectations
): Promise<LogoutTokenResult> {
	let payload: Record<string, unknown>;
	try {
		const result = await jwtVerify(logoutToken, keys as JWTVerifyGetKey, {
			issuer: expected.issuer,
			audience: expected.clientId,
			clockTolerance: ID_TOKEN_CLOCK_TOLERANCE_SECONDS,
			// iat is REQUIRED of a logout_token by the spec; jose only checks a claim that
			// is present, so without this a token with no iat would pass unremarked.
			requiredClaims: ['iat'],
			// Asymmetric only, same reasoning as the id_token path: a symmetric algorithm
			// would let the token be signed with the provider's public key.
			algorithms: DEFAULT_ID_TOKEN_ALGORITHMS
		});
		payload = result.payload as Record<string, unknown>;
	} catch (error) {
		throw new Error(describeLogoutTokenFailure(error));
	}

	// A token may name several applications. Membership in aud alone does not say the
	// provider authorised this client to act on it, so when aud lists more than one it
	// must name the authorised party in azp. Mirrors the id_token path; the spec requires
	// the same aud/azp validation of a logout_token.
	const audiences = payload.aud;
	if (Array.isArray(audiences) && audiences.length > 1 && payload.azp !== expected.clientId) {
		throw new Error('注销令牌指定了多个应用，未授权当前应用');
	}

	// The events claim is what distinguishes a logout_token from any other token signed
	// by the same keys. Without this check an id_token (same issuer, same audience) would
	// be accepted as a logout instruction.
	const events = payload.events;
	if (typeof events !== 'object' || events === null || Array.isArray(events)) {
		throw new Error('注销令牌缺少 events 声明');
	}
	if (!Object.prototype.hasOwnProperty.call(events, BACKCHANNEL_LOGOUT_EVENT)) {
		throw new Error('注销令牌的 events 声明未指定后端通道注销事件');
	}

	// A logout_token must forbid nonce: its presence means the token was minted for an
	// interactive login (an id_token), not a logout, so it is rejected to stop an
	// id_token being replayed as a logout instruction.
	if ('nonce' in payload) {
		throw new Error('注销令牌包含 nonce，注销令牌不允许携带该字段');
	}

	const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
	const sid = typeof payload.sid === 'string' ? payload.sid : undefined;
	// At least one is required: with neither, the token names no session to end.
	if (sub === undefined && sid === undefined) {
		throw new Error('注销令牌既未指定主体也未指定会话');
	}

	const jti = typeof payload.jti === 'string' ? payload.jti : undefined;
	return { sub, sid, jti };
}

/** The human half of a verification failure, kept apart so it can be tested alone. */
export function describeLogoutTokenFailure(error: unknown): string {
	const code = (error as { code?: string })?.code;
	switch (code) {
		case 'ERR_JWT_CLAIM_VALIDATION_FAILED': {
			const claim = (error as { claim?: string })?.claim;
			if (claim === 'iss') return '该注销令牌来自与配置不同的签发方';
			if (claim === 'aud') return '注销令牌是为其他应用签发的';
			if (claim === 'iat') return '注销令牌缺少规范要求的签发时间';
			return `注销令牌的 ${claim ?? '声明'} 校验失败`;
		}
		case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
			return '注销令牌签名与密钥提供方的签名密钥不匹配';
		case 'ERR_JWKS_NO_MATCHING_KEY':
			return '用于签署该注销令牌的密钥未在提供方发布的密钥集中找到';
		case 'ERR_JOSE_ALG_NOT_ALLOWED':
		case 'ERR_JOSE_NOT_SUPPORTED':
			return '注销令牌使用了提供方密钥不支持的签名算法';
		default:
			return `无法验证该注销令牌 (${error instanceof Error ? error.message : String(error)})`;
	}
}
