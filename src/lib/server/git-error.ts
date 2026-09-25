/**
 * Pure git error-message helpers, split out of git.ts so they can be unit-tested
 * without importing git.ts's heavy deps (db/docker). No I/O here.
 */

/**
 * The permission-denied message, tailored to the auth in use (#1509). A token/password
 * credential paired with an `git@...` SSH URL is the common trap: git uses the SSH
 * transport and never applies the token, so it fails with a public-key error - blaming
 * "SSH credentials" then is actively misleading. Point at the real cause instead.
 */
export function permissionDeniedMessage(
    authType?: string | null,
    url?: string | null
): string {
    const isSshUrl = !!url && url.startsWith('git@');
    if (authType === 'password') {
        if (isSshUrl) {
            return '权限被拒绝。当前凭据使用访问令牌，但仓库地址为 SSH 地址 (git@...)。令牌认证请改用 https:// 地址。';
        }
        return '权限被拒绝。请检查访问令牌，确认该令牌拥有仓库访问权限。';
    }
    if (authType === 'ssh') {
        return '权限被拒绝。请检查你的 SSH 密钥，确认该密钥已授权访问此仓库。';
    }
    return '权限被拒绝。请检查你的凭据。';
}
