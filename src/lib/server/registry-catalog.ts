/**
 * Pure catalog-failure classification (#873). No docker/db imports, so it's
 * unit-testable without pulling better-sqlite3 into the test process.
 *
 * GitLab, Harbor, and other registries refuse /v2/_catalog to non-admins by returning
 * 401 with `error="insufficient_scope"` in WWW-Authenticate - the token is VALID, the
 * operation just isn't permitted. That is NOT an auth failure. A real bad/expired token
 * instead returns `error="invalid_token"`. Verified empirically on gitlab.com and a
 * self-hosted GitLab (admin gets catalog 200; non-admin and gitlab.com get
 * insufficient_scope; a bad token gets invalid_token).
 */

/**
 * @param status HTTP status of the catalog response
 * @param wwwAuthenticate the response's WWW-Authenticate header (may be null)
 * @param authState 'authed' (we obtained and sent a bearer token), 'rejected' (registry
 *   HAS stored credentials but the token exchange failed - bad/expired creds), or 'anon'
 *   (no credentials configured)
 * @returns 'not_supported' (registry won't list - point user to search) or 'auth_failed'
 */
export function classifyCatalogFailure(
	status: number,
	wwwAuthenticate: string | null,
	authState: 'authed' | 'rejected' | 'anon'
): 'not_supported' | 'auth_failed' {
	const err = (wwwAuthenticate || '').match(/error="([^"]+)"/i)?.[1]?.toLowerCase();
	// An explicit error code is authoritative regardless of how we authenticated.
	if (err === 'insufficient_scope') return 'not_supported';
	if (err === 'invalid_token') return 'auth_failed';
	// Credentials were configured but the token exchange failed -> real auth problem.
	if (authState === 'rejected') return 'auth_failed';
	// We authenticated fine but still can't list -> the token lacks catalog permission
	// (GitLab/Harbor restrict it to admins). Anonymous 401 is the normal login challenge.
	if ((status === 401 || status === 403) && authState === 'authed') return 'not_supported';
	return 'auth_failed';
}

/** User-facing message for a registry that won't allow catalog listing (#873). */
export const CATALOG_NOT_SUPPORTED_MSG =
	'该仓库不允许列出全部镜像 (GitLab 和 Harbor 仅管理员可执行此操作)，请通过完整路径搜索镜像。';
