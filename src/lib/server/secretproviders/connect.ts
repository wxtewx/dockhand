/**
 * 1Password Connect provider.
 *
 * Talks to a self‑hosted 1Password Connect server over its REST API (v1) using
 * a Connect access token. This is the Business path: teams run a Connect server
 * next to their vaults and Dockhand reads op:// references through it.
 *
 * Connect resolves inline references only. Unlike a service account it has no
 * concept of a 1Password Environment, so bulk pull is unsupported (callers get
 * an {@link UnsupportedOperationError} and should use a service account for that).
 *
 * Decrypted host + token stay inside this module for the duration of a call.
 * Nothing here writes to disk or to the database.
 */

import { request } from 'undici';
import type { ConnectConfig, SecretProvider, TestConnectionResult } from './shared';
import { assertSafeProviderHost, parseProviderError, isJsonResponse } from './shared';
import { UnsupportedOperationError } from './shared';

/** A vault as returned by GET /v1/vaults. */
interface ConnectVault {
	id: string;
	name: string;
}

/** An item summary as returned by GET /v1/vaults/{id}/items. */
interface ConnectItemSummary {
	id: string;
	title: string;
}

/** A section reference on a field. */
interface ConnectSection {
	id?: string;
	label?: string;
}

/** A single field on a full item. */
interface ConnectField {
	id?: string;
	label?: string;
	value?: string;
	section?: ConnectSection;
}

/** A full item as returned by GET /v1/vaults/{id}/items/{id}. */
interface ConnectItem {
	id: string;
	title: string;
	fields?: ConnectField[];
}

/** A parsed op:// reference. `section` is optional. */
interface ParsedReference {
	vault: string;
	item: string;
	section?: string;
	field: string;
}

/**
 * Thrown internally when a specific lookup (vault/item/field) has no match, so
 * the caller can skip+warn that one reference. Transport/auth failures are plain
 * Errors and propagate.
 */
class ReferenceNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReferenceNotFoundError';
	}
}

/** Normalises a host URL into the Connect v1 API base (no trailing slash). */
function baseUrl(host: string): string {
	assertSafeProviderHost(host, '1Password Connect');
	return `${host.replace(/\/$/, '')}/v1`;
}

function authHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: 'application/json'
	};
}

/**
 * Parses an `op://<vault>/<item>/<field>` or
 * `op://<vault>/<item>/<section>/<field>` reference. Returns null for anything
 * that is not a well‑formed reference (wrong scheme or wrong segment count).
 */
function parseReference(ref: string): ParsedReference | null {
	const trimmed = ref.trim();
	if (!trimmed.startsWith('op://')) {
		return null;
	}
	const segments = trimmed.slice('op://'.length).split('/');
	if (segments.some((s) => s.length === 0)) {
		return null;
	}
	if (segments.length === 3) {
		return { vault: segments[0], item: segments[1], field: segments[2] };
	}
	if (segments.length === 4) {
		return { vault: segments[0], item: segments[1], section: segments[2], field: segments[3] };
	}
	return null;
}

/**
 * Performs a GET against the Connect API and returns the parsed JSON body.
 * Throws on any non‑2xx status other than 404, which is signalled by returning
 * `undefined` so per‑reference lookups can skip+warn instead of aborting the
 * whole batch. 401/403/5xx and transport errors propagate.
 */
async function connectGet<T>(
	config: ConnectConfig,
	path: string,
	query?: Record<string, string>
): Promise<T | undefined> {
	const url = new URL(`${baseUrl(config.host)}${path}`);
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			url.searchParams.set(key, value);
		}
	}
	const { statusCode, body } = await request(url, {
		method: 'GET',
		headers: authHeaders(config.token)
	});
	if (statusCode === 404) {
		// Drain the body so the connection can be reused, then signal "not found".
		await body.text();
		return undefined;
	}
	if (statusCode < 200 || statusCode >= 300) {
		// Log the raw body server‑side only; the thrown message (which reaches the
		// deploy job / client) carries just the status, never arbitrary upstream bytes.
		const detail = await body.text().catch(() => '');
		if (detail) console.warn(`[1Password Connect] 请求 ${statusCode}: ${detail}`);
		throw new Error(`1Password Connect 请求失败(${statusCode})`);
	}
	return (await body.json()) as T;
}

/**
 * A per‑call cache that memoises the vault list and per‑vault item lists so a
 * batch of references sharing vaults/items does not re‑fetch. Full items are not
 * cached — each reference targets a distinct field on a possibly‑distinct item.
 */
class ResolveCache {
	private vaults?: ConnectVault[];
	private itemsByVault = new Map<string, ConnectItemSummary[]>();

	constructor(private readonly config: ConnectConfig) {}

	async listVaults(): Promise<ConnectVault[]> {
		if (!this.vaults) {
			this.vaults = (await connectGet<ConnectVault[]>(this.config, '/vaults')) ?? [];
		}
		return this.vaults;
	}

	async listItems(vaultId: string): Promise<ConnectItemSummary[]> {
		const cached = this.itemsByVault.get(vaultId);
		if (cached) {
			return cached;
		}
		const items =
			(await connectGet<ConnectItemSummary[]>(this.config, `/vaults/${vaultId}/items`)) ?? [];
		this.itemsByVault.set(vaultId, items);
		return items;
	}

	getItem(vaultId: string, itemId: string): Promise<ConnectItem | undefined> {
		return connectGet<ConnectItem>(this.config, `/vaults/${vaultId}/items/${itemId}`);
	}
}

/** Matches a field to the parsed reference's field + optional section. */
function fieldMatches(field: ConnectField, parsed: ParsedReference): boolean {
	const labelOrId = field.label ?? field.id;
	if (labelOrId !== parsed.field) {
		return false;
	}
	if (parsed.section === undefined) {
		return true;
	}
	const section = field.section;
	return section !== undefined && (section.label === parsed.section || section.id === parsed.section);
}

/**
 * Resolves one parsed reference to a secret value, or throws
 * {@link ReferenceNotFoundError} if any hop has no match. Transport/auth errors
 * from the underlying requests propagate.
 */
async function resolveOne(cache: ResolveCache, parsed: ParsedReference): Promise<string> {
	const vaults = await cache.listVaults();
	const vault = vaults.find((v) => v.name === parsed.vault || v.id === parsed.vault);
	if (!vault) {
		throw new ReferenceNotFoundError(`保管库 "${parsed.vault}" 未找到`);
	}

	const items = await cache.listItems(vault.id);
	const itemSummary = items.find((i) => i.title === parsed.item || i.id === parsed.item);
	if (!itemSummary) {
		throw new ReferenceNotFoundError(`在保管库"${parsed.vault}"中未找到项目"${parsed.item}"`);
	}

	const item = await cache.getItem(vault.id, itemSummary.id);
	if (!item) {
		throw new ReferenceNotFoundError(`在保管库"${parsed.vault}"中未找到项目"${parsed.item}"`);
	}

	const field = (item.fields ?? []).find((f) => fieldMatches(f, parsed));
	if (!field || field.value === undefined) {
		const where = parsed.section ? `${parsed.section}/${parsed.field}` : parsed.field;
		throw new ReferenceNotFoundError(`项目"${parsed.item}"上未找到字段"${where}"`);
	}
	return field.value;
}

export const connectProvider: SecretProvider<ConnectConfig> = {
	type: 'op-connect',
	label: '1Password Connect',
	supportsReferences: true,
	supportsBulk: false,

	isReference(value: unknown): value is string {
		return typeof value === 'string' && value.trim().startsWith('op://');
	},

	async testConnection(config: ConnectConfig): Promise<TestConnectionResult> {
		const host = config.host?.trim();
		const token = config.token?.trim();
		if (!host) {
			return { ok: false, error: '主机地址为空' };
		}
		if (!token) {
			return { ok: false, error: '令牌为空' };
		}
		try {
			// GET /v1/vaults authenticates the token and confirms the host is a
			// Connect server. Connect has no /v1/health endpoint, and the root
			// /health is unauthenticated so it would not catch a bad token.
			const url = `${baseUrl(host)}/vaults`;
			const { statusCode, body } = await request(url, {
				method: 'GET',
				headers: authHeaders(token)
			});
			const text = await body.text();
			if (statusCode >= 200 && statusCode < 300) {
				if (!isJsonResponse(text)) {
					return { ok: false, error: '1Password Connect 未返回 JSON 响应，该主机可能不是 Connect 服务端' };
				}
				return { ok: true };
			}
			if (statusCode === 401 || statusCode === 403) {
				return { ok: false, error: '无效的 1Password Connect 令牌' };
			}
			// Log the raw body server‑side; show the client only a message parsed from
			// Connect's own {message}/{messages} error shape (never arbitrary bytes).
			if (text) console.warn(`[1Password Connect] testConnection ${statusCode}: ${text}`);
			const safe = parseProviderError(text);
			return {
				ok: false,
				error: `1Password Connect 请求失败(${statusCode})${safe ? `: ${safe}` : ''}`
			};
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			return { ok: false, error: message || '连接失败' };
		}
	},

	async resolveSecretReferences(
		config: ConnectConfig,
		refs: string[],
		logPrefix = '[1Password Connect]'
	): Promise<Map<string, string>> {
		const result = new Map<string, string>();
		if (refs.length === 0) {
			return result;
		}
		const cache = new ResolveCache(config);
		for (const ref of refs) {
			const parsed = parseReference(ref);
			if (!parsed) {
				console.warn(`${logPrefix} 跳过格式错误的 op:// 引用 ${ref}`);
				continue;
			}
			try {
				result.set(ref, await resolveOne(cache, parsed));
			} catch (e: unknown) {
				if (e instanceof ReferenceNotFoundError) {
					console.warn(`${logPrefix} 跳过 op:// 引用 ${ref}: ${e.message}`);
					continue;
				}
				throw e;
			}
		}
		return result;
	},

	async resolveBulk(): Promise<Record<string, string>> {
		throw new UnsupportedOperationError(
			'1Password Connect 不支持环境批量拉取，请使用服务账号。'
		);
	}
};
