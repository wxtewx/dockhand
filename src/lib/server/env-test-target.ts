/**
 * The address a connection test may dial. The guard and the request use the same parsed
 * URL, and the host must come back from the parser unchanged, so what was judged is what
 * gets dialled. LAN ranges stay allowed; loopback, metadata and reserved do not.
 */
import { isSafeNotificationUrl } from './url-safety';
import { resolvedHostReason } from './notifications/shared';

export type TestTargetResult =
	| { ok: true; protocol: 'http' | 'https'; origin: string }
	| { ok: false; badRequest: boolean; error: string };

export async function resolveTestTarget(
	config: { protocol?: string; host?: string; port?: number | string },
	lookupAll?: (host: string) => Promise<string[]>
): Promise<TestTargetResult> {
	const protocol = config.protocol || 'http';
	if (protocol !== 'http' && protocol !== 'https') {
		return { ok: false, badRequest: true, error: '协议必须为 http 或 https' };
	}
	const host = (config.host ?? '').trim();
	if (!host) return { ok: false, badRequest: true, error: '必须填写主机' };
	const port = Number(config.port || 2375);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return { ok: false, badRequest: true, error: '端口范围必须在 1 至 65535 之间' };
	}

	let url: URL;
	try {
		url = new URL(`${protocol}://${host}:${port}`);
	} catch {
		return { ok: false, badRequest: true, error: '主机必须为主机名或 IP 地址' };
	}
	const parsed = url.hostname.replace(/^\[|\]$/g, '');
	if (parsed !== host.toLowerCase().replace(/^\[|\]$/g, '')) {
		return { ok: false, badRequest: true, error: '主机必须为主机名或 IP 地址' };
	}

	const safety = isSafeNotificationUrl(url.href);
	if (!safety.ok) return { ok: false, badRequest: false, error: `不允许访问该主机: ${safety.reason}` };
	const resolved = await resolvedHostReason(parsed, lookupAll);
	if (resolved) return { ok: false, badRequest: false, error: `不允许访问该主机: ${resolved}` };

	return { ok: true, protocol, origin: `http://${url.hostname}:${port}` };
}
