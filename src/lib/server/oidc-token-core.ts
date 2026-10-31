/**
 * Proving that an id_token really came from the configured provider.
 *
 * Claims decide who somebody is and whether they administer this instance, so nothing
 * is read out of a token until it is proven to come from the configured provider. Kept
 * apart from the rest of the OIDC flow so a test can call the real thing: the only I/O
 * is fetching the provider's signing keys, and that arrives as an argument.
 */

import { jwtVerify, type JWTVerifyGetKey, type KeyObject } from 'jose';
import type { Claims } from './oidc-claims-core';

/**
 * How far the clocks either side of a login may drift before it fails.
 *
 * Two hosts that disagree by a few seconds is ordinary; refusing those logins would
 * make Dockhand look broken for a reason nobody would guess from the outside. The
 * allowance covers both directions - a token that just expired, and one issued a
 * moment in the future by a provider running ahead - and is small against the
 * several minutes an id_token is valid for, so it does not meaningfully widen the
 * window in which a stolen token can be replayed. Matches the openid-client default.
 */
export const ID_TOKEN_CLOCK_TOLERANCE_SECONDS = 30;

/**
 * Signing algorithms an id_token may use.
 *
 * Every asymmetric algorithm the JOSE registry defines, so no conforming provider is
 * turned away - what the list excludes is the symmetric family (HS*) and `none`,
 * where the verifying key is either public or absent.
 */
export const DEFAULT_ID_TOKEN_ALGORITHMS = [
	'RS256', 'RS384', 'RS512',
	'PS256', 'PS384', 'PS512',
	'ES256', 'ES256K', 'ES384', 'ES512',
	'EdDSA', 'Ed25519'
];

export interface IdTokenExpectations {
	/** The issuer the provider names in its own discovery document. */
	issuer: string;
	/** This deployment's client id, which the token must be addressed to. */
	clientId: string;
	/** The nonce this login sent, tying the token to this request. */
	nonce: string;
}

/**
 * The claims of an id_token, once it has been proven to come from the provider.
 *
 * Throws with a reason a person can act on. Each failure is a different
 * misconfiguration - a provider whose issuer does not match its own discovery
 * document is a different problem from a clock that has drifted - and saying which is
 * the difference between a support thread and a five-minute fix.
 */
export async function verifyIdTokenWithKeys(
	idToken: string,
	keys: JWTVerifyGetKey | KeyObject | CryptoKey | Uint8Array,
	expected: IdTokenExpectations
): Promise<Claims> {
	let payload: Claims;
	try {
		const result = await jwtVerify(idToken, keys as JWTVerifyGetKey, {
			issuer: expected.issuer,
			audience: expected.clientId,
			clockTolerance: ID_TOKEN_CLOCK_TOLERANCE_SECONDS,
			// Both are REQUIRED of an id_token by OIDC Core, and jose only checks a
			// claim that is present. Without exp a captured token never expires;
			// without sub the token names nobody, and the userinfo response - a weaker
			// source - is left free to say who this is and what they may do.
			requiredClaims: ['exp', 'sub'],
			// Asymmetric only. A symmetric algorithm would let a token be signed with
			// the provider's PUBLIC key, which anybody can fetch. The key resolver
			// happens to refuse those too, but that is its property, not this one's,
			// and it would go away with a different key source.
			algorithms: DEFAULT_ID_TOKEN_ALGORITHMS
		});
		payload = result.payload as Claims;
	} catch (error) {
		throw new Error(describeVerifyFailure(error));
	}

	// A token may name several applications. Membership alone does not say it was
	// meant for this one, so the provider has to name the party it authorized.
	const audiences = payload.aud;
	if (Array.isArray(audiences) && audiences.length > 1 && payload.azp !== expected.clientId) {
		throw new Error('该 ID 令牌面向多个应用，并未授权本应用');
	}

	// Required, not checked-if-present: a token without a nonce cannot be tied to the
	// request that started this login, which is the whole point of sending one.
	if (payload.nonce !== expected.nonce) {
		throw new Error('该 ID 令牌不属于本次登录请求');
	}

	return payload;
}

/** The human half of a verification failure, kept apart so it can be tested alone. */
export function describeVerifyFailure(error: unknown): string {
	const code = (error as { code?: string })?.code;
	switch (code) {
		case 'ERR_JWT_EXPIRED':
			return `该 ID 令牌已超出允许的 ${ID_TOKEN_CLOCK_TOLERANCE_SECONDS} 秒时钟容错时长而过期 (请检查本机以及身份提供程序服务器的系统时钟)`;
		case 'ERR_JWT_CLAIM_VALIDATION_FAILED': {
			const claim = (error as { claim?: string })?.claim;
			if (claim === 'iss') return '该 ID 令牌的签发者与配置项不一致';
            if (claim === 'aud') return '该 ID 令牌是为另一个应用签发的';
            if (claim === 'exp') return '该 ID 令牌缺少过期时间，OIDC 规范强制要求该字段';
            if (claim === 'sub') return '该 ID 令牌未包含主体标识，OIDC 规范强制要求该字段';
            return `该 ID 令牌的 ${claim ?? '声明'} 校验未通过`;
		}
		case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
            return '该 ID 令牌的签名与身份提供程序的签名密钥不匹配';
        case 'ERR_JWKS_NO_MATCHING_KEY':
            return '该 ID 令牌使用了一条身份提供程序未对外发布的密钥进行签名';
        case 'ERR_JOSE_ALG_NOT_ALLOWED':
        case 'ERR_JOSE_NOT_SUPPORTED':
            return '该 ID 令牌使用了不被允许的签名算法';
        default:
            return `无法验证该 ID 令牌 (${error instanceof Error ? error.message : String(error)})`;
	}
}
