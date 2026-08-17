/**
 * Infisical provider.
 *
 * Talks to an Infisical instance (Infisical Cloud or self-hosted) over its
 * public REST API to bulk-pull every secret under a project / environment /
 * path. Infisical has no inline compose-reference syntax (no op://-style
 * marker), so this provider is bulk-only: `resolveSecretReferences` is
 * unsupported and `isReference` is always false.
 *
 * The `token` is treated as a ready-to-use API access token / service token and
 * sent as `Authorization: Bearer <token>`. Universal Auth (clientId +
 * clientSecret exchanged via POST /api/v1/auth/universal-auth/login) is not
 * modelled by InfisicalConfig and would need a config field plus a login step.
 *
 * Decrypted tokens stay inside this module for the duration of a call. Nothing
 * here writes to disk or to the database.
 */

import { request } from 'undici';
import type { InfisicalConfig, SecretProvider, TestConnectionResult } from './shared';
import { assertSafeProviderHost, parseProviderError, isJsonResponse } from './shared';
import { UnsupportedOperationError } from './shared';

/** Shape of a single secret in the /api/v3/secrets/raw response. */
interface RawSecret {
	secretKey: string;
	secretValue: string;
}

/** The parts of the /api/v3/secrets/raw response Dockhand consumes. */
interface RawSecretsResponse {
	secrets?: RawSecret[];
}

/** Strips a trailing slash so `${base}${path}` never doubles up. */
function baseUrl(host: string): string {
	assertSafeProviderHost(host, 'Infisical');
	return host.replace(/\/$/, '');
}

/**
 * Builds the /api/v3/secrets/raw URL for a workspace/environment/path. The
 * secret path defaults to `/` (Infisical's root) when nothing is configured.
 */
function rawSecretsUrl(
	host: string,
	workspaceId: string,
	environment: string,
	secretPath: string
): string {
	const params = new URLSearchParams({
		workspaceId,
		environment,
		secretPath: secretPath || '/'
	});
	return `${baseUrl(host)}/api/v3/secrets/raw?${params.toString()}`;
}

export const infisicalProvider: SecretProvider<InfisicalConfig> = {
	type: 'infisical',
	label: 'Infisical',
	supportsReferences: false,
	supportsBulk: true,

	isReference(_value: unknown): _value is string {
		return false;
	},

	async testConnection(config: InfisicalConfig): Promise<TestConnectionResult> {
		const host = config.host?.trim();
		const token = config.token?.trim();
		const projectId = config.projectId?.trim();
		const environment = config.environment?.trim();

		if (!host) {
			return { ok: false, error: '主机地址为空' };
		}
		if (!token) {
			return { ok: false, error: '令牌为空' };
		}
		if (!projectId) {
			return { ok: false, error: '项目 ID 为空' };
		}
		if (!environment) {
			return { ok: false, error: '环境为空' };
		}

		try {
			const { statusCode, body } = await request(
				rawSecretsUrl(host, projectId, environment, '/'),
				{
					method: 'GET',
					headers: { authorization: `Bearer ${token}` }
				}
			);
			// Drain the body; on failure log it server-side and show the client only a
			// message parsed from Infisical's own {message}/{messages} shape.
			const rawBody = await body.text().catch(() => '');
			if (statusCode >= 200 && statusCode < 300) {
				if (!isJsonResponse(rawBody)) {
					return { ok: false, error: 'Infisical 未返回 JSON 响应，该主机可能不是 Infisical 服务端' };
				}
				return { ok: true };
			}
			if (rawBody) console.warn(`[Infisical] testConnection ${statusCode}: ${rawBody}`);
			const safe = parseProviderError(rawBody);
			return { ok: false, error: `Infisical 返回 HTTP ${statusCode}${safe ? `: ${safe}` : ''}` };
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			return { ok: false, error: message || '连接失败' };
		}
	},

	async resolveSecretReferences(): Promise<Map<string, string>> {
		throw new UnsupportedOperationError(
			'Infisical 不支持内联引用，请使用批量拉取(项目/环境/路径)。'
		);
	},

	async resolveBulk(config: InfisicalConfig, selector: string): Promise<Record<string, string>> {
		const host = config.host?.trim();
		const token = config.token?.trim();
		const projectId = config.projectId?.trim();
		const environment = config.environment?.trim();
		const secretPath = selector?.trim() || config.path?.trim() || '/';

		if (!host) {
			throw new Error('[Infisical] 批量拉取需要提供主机地址');
		}
		if (!token) {
			throw new Error('[Infisical] 批量拉取需要提供令牌');
		}
		if (!projectId) {
			throw new Error('[Infisical] 批量拉取需要提供项目 ID');
		}
		if (!environment) {
			throw new Error('[Infisical] 批量拉取需要提供环境');
		}

		const { statusCode, body } = await request(
			rawSecretsUrl(host, projectId, environment, secretPath),
			{
				method: 'GET',
				headers: { authorization: `Bearer ${token}` }
			}
		);

		if (statusCode < 200 || statusCode >= 300) {
			// Drain the body, log it server-side, but never reflect it to the client.
			const detail = await body.text().catch(() => '');
			if (detail) console.warn(`[Infisical] bulk pull ${statusCode}: ${detail}`);
			throw new Error(`[Infisical] 批量拉取失败，HTTP ${statusCode}`);
		}

		const payload = (await body.json()) as RawSecretsResponse;
		const result: Record<string, string> = {};
		for (const secret of payload.secrets ?? []) {
			if (secret?.secretKey !== undefined) {
				result[secret.secretKey] = secret.secretValue;
			}
		}
		return result;
	}
};
