/**
 * Pure helpers turning a failed registry manifest lookup into a specific, human-readable
 * reason for update-check logs and tooltips (#1486). Kept out of docker.ts so they can be
 * unit-tested without pulling in docker/db.
 */

export type RegistryFailure =
	| { kind: 'blocked-host'; registry: string }
	| { kind: 'http'; status: number; retryAfter?: string | null }
	| { kind: 'no-digest' }
	| { kind: 'error'; registry: string; error: unknown };

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);
const TLS_PROTOCOL_CODES = new Set(['ERR_SSL_WRONG_VERSION_NUMBER', 'EPROTO', 'ERR_SSL_PACKET_LENGTH_TOO_LONG']);
const TLS_CERT_CODES = new Set([
	'DEPTH_ZERO_SELF_SIGNED_CERT',
	'SELF_SIGNED_CERT_IN_CHAIN',
	'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
	'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
	'CERT_HAS_EXPIRED',
	'ERR_TLS_CERT_ALTNAME_INVALID'
]);
const UNREACHABLE_CODES = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ETIMEDOUT',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_HEADERS_TIMEOUT',
	'UND_ERR_SOCKET'
]);

/** Error codes and messages along the cause chain (Node's fetch wraps the socket error in `cause`). */
function collectErrorInfo(error: unknown): { codes: string[]; text: string } {
	const codes: string[] = [];
	const messages: string[] = [];
	const seen = new Set<unknown>();
	const queue: unknown[] = [error];
	while (queue.length > 0 && seen.size < 10) {
		const e = queue.shift();
		if (typeof e === 'string') messages.push(e);
		if (!e || typeof e !== 'object' || seen.has(e)) continue;
		seen.add(e);
		const err = e as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
		if (typeof err.code === 'string') codes.push(err.code);
		if (typeof err.message === 'string') messages.push(err.message);
		if (err.cause !== undefined) queue.push(err.cause);
		if (Array.isArray(err.errors)) queue.push(...err.errors);
	}
	return { codes, text: messages.join(' ') };
}

/** Retry-After is registry-controlled: only echo a seconds count or a short HTTP-date. */
function formatRetryAfter(value: string | null | undefined): string {
	const v = value?.trim();
	if (!v) return '';
	if (/^\d+$/.test(v)) return `, ${v} 秒后重试`;
	if (/^[\w ,:+-]{1,40}$/.test(v)) return `, ${v} 之后重试`;
	return '';
}

export function describeRegistryFailure(failure: RegistryFailure): string {
	switch (failure.kind) {
		case 'blocked-host':
			return `不允许访问镜像仓库主机 (${failure.registry})`;
		case 'no-digest':
			return '镜像仓库响应不包含 Docker-Content-Digest 请求头';
		case 'http': {
			const s = failure.status;
			if (s === 429) return `镜像仓库触发访问限流 (429${formatRetryAfter(failure.retryAfter)})`;
			// A locally built image and an image deleted upstream both 404 - don't claim to know which.
			if (s === 404) return '镜像仓库返回 404 (未找到镜像或标签：上游已删除、私有镜像或者为本机构建镜像)';
			if (s === 401 || s === 403) return `镜像仓库拒绝访问 (${s})‑私有镜像或凭据缺失`;
			if (s >= 500) return `镜像仓库服务器错误 (${s})`;
			return `无法查询镜像仓库 (${s})`;
		}
		case 'error': {
			const { registry } = failure;
			const { codes, text } = collectErrorInfo(failure.error);
			if (codes.some((c) => DNS_CODES.has(c)) || /\b(ENOTFOUND|EAI_AGAIN)\b/.test(text)) {
				return `${registry} 的 DNS 解析失败`;
			}
			if (codes.some((c) => TLS_PROTOCOL_CODES.has(c)) || text.toLowerCase().includes('wrong version number')) {
				return `与 ${registry} 的 TLS 握手失败-该镜像仓库可能仅支持 HTTP (请在设置>镜像仓库中将 URL 设置为 http://)`;
			}
			const cert = codes.find((c) => TLS_CERT_CODES.has(c));
			if (cert) return `${registry} 的 TLS 证书不受信任 (${cert})`;
			const unreachable = codes.find((c) => UNREACHABLE_CODES.has(c));
			if (unreachable) return `无法访问镜像仓库：${registry} (${unreachable})`;
			return codes.length > 0 ? `无法查询镜像仓库 (${codes[0]})` : '无法查询镜像仓库';
		}
	}
}
