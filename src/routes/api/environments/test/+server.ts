import { json } from '@sveltejs/kit';
import { unixSocketRequest, httpsAgentRequest } from '$lib/server/docker';
import type { DockerClientConfig } from '$lib/server/docker';
import { getEnvironment } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import { isSafeNotificationUrl } from '$lib/server/url-safety';
import type { RequestHandler } from './$types';

interface TestConnectionRequest {
	connectionType: 'socket' | 'direct' | 'hawser-standard' | 'hawser-edge';
	socketPath?: string;
	host?: string;
	port?: number;
	protocol?: string;
	tlsCa?: string;
	tlsCert?: string;
	tlsKey?: string;
	tlsSkipVerify?: boolean;
	hawserToken?: string;
	/**
	 * When editing an existing environment, secrets (hawserToken, tlsKey) are never sent
	 * back to the client, so an unchanged token comes through empty. Passing the env id lets
	 * the server fall back to the STORED secret for any secret field the body left blank, so
	 * "Test connection" works without re-typing the token (#1483). Non-secret fields still
	 * come from the body, so the test reflects the edited form.
	 */
	environmentId?: number;
}

function cleanPem(pem: string): string {
	return pem
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join('\n');
}

function buildDockerClientConfig(config: TestConnectionRequest): DockerClientConfig | null {
	const protocol = config.protocol || 'http';
	if (protocol !== 'https') return null;

	return {
		type: 'https',
		host: config.host || 'localhost',
		port: config.port || 2376,
		ca: config.tlsCa ? cleanPem(config.tlsCa) || undefined : undefined,
		cert: config.tlsCert ? cleanPem(config.tlsCert) || undefined : undefined,
		key: config.tlsKey ? cleanPem(config.tlsKey) || undefined : undefined,
		skipVerify: config.tlsSkipVerify || false
	};
}

/**
 * Test Docker connection with provided configuration (without saving to database)
 *
 * @openapi
 * summary: Test a Docker/Hawser connection configuration WITHOUT saving it as an environment
 * description: Pass environmentId to fall back to that saved environment's stored secrets (hawserToken, tlsKey) for any secret field left blank in the body, so Test connection works when editing without re-entering the token.
 * body: {connectionType:string!, socketPath:string, host:string, port:integer, protocol:string, tlsCa:string, tlsCert:string, tlsKey:string, tlsSkipVerify:boolean, hawserToken:string, environmentId:integer}
 * body-example: {"connectionType":"socket","socketPath":"/var/run/docker.sock"}
 * resp-200: {success:boolean!, info:{serverVersion:string, containers:integer, images:integer, name:string}, hawser:{}}
 * resp-200-desc: success:false with a human-readable error message is also returned as HTTP 200 (connection failures are not transport errors)
 * resp-400: Host is required for direct/hawser-standard connection types
 * resp-403: The caller cannot access the environment named by environmentId
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	try {
		const config: TestConnectionRequest = await request.json();

		// Fill unchanged secrets from the stored environment when editing (#1483): the client
		// never receives hawserToken / tlsKey, so an untouched field arrives empty. Only fall
		// back for a BLANK field, so a freshly typed token/key still wins.
		if (config.environmentId) {
			// Gate the id: without this, any authenticated user could name another
			// environment's id and have its stored token sent to a body-supplied host,
			// exfiltrating a secret they may have no access to (env-scoped RBAC).
			const auth = await authorize(cookies);
			if (!(await auth.canAccessEnvironment(config.environmentId))) {
				return json({ success: false, error: 'Access denied' }, { status: 403 });
			}
			const stored = await getEnvironment(config.environmentId);
			if (stored) {
				if (!config.hawserToken) config.hawserToken = stored.hawserToken || undefined;
				if (!config.tlsKey) config.tlsKey = stored.tlsKey || undefined;
			}
		}

		// Build fetch options based on connection type
		let response: Response;

		if (config.connectionType === 'socket') {
			const socketPath = config.socketPath || '/var/run/docker.sock';
			response = await unixSocketRequest(socketPath, '/info');
		} else if (config.connectionType === 'hawser-edge') {
			// Edge mode - cannot test directly, agent connects to us
			return json({
				success: true,
				info: {
					message: '边缘模式环境将在代理连接时自动测试'
				},
				isEdgeMode: true
			});
		} else {
			// Direct or Hawser Standard - HTTP/HTTPS connection
			const protocol = config.protocol || 'http';
			const host = config.host;
			const port = config.port || 2375;

			if (!host) {
				return json({ success: false, error: '主机地址为必填项' }, { status: 400 });
			}

			// SSRF guard: host/port come straight from the request body. A remote
			// Docker/Hawser daemon legitimately lives on a LAN, so allow private
			// ranges but block loopback + cloud metadata (169.254.169.254) + reserved
			// so this tester can't be used to probe the control plane or metadata IMDS.
			const hostSafety = isSafeNotificationUrl(`${protocol}://${host}:${port}`);
			if (!hostSafety.ok) {
				return json({ success: false, error: `主机不被允许: ${hostSafety.reason}` }, { status: 200 });
			}

			const headers: Record<string, string> = {
				'Content-Type': 'application/json'
			};

			if (config.connectionType === 'hawser-standard' && config.hawserToken) {
				headers['X-Hawser-Token'] = config.hawserToken;
			}

			const tlsConfig = buildDockerClientConfig(config);
			if (tlsConfig) {
				response = await httpsAgentRequest(tlsConfig, '/info', {}, false, headers);
			} else {
				const url = `http://${host}:${port}/info`;
				response = await fetch(url, {
					headers,
					signal: AbortSignal.timeout(10000),
					keepalive: false
				});
			}
		}

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Docker API 错误: ${response.status} - ${error}`);
		}

		const info = await response.json();

		// For Hawser Standard, also try to fetch Hawser info
		let hawserInfo = null;
		if (config.connectionType === 'hawser-standard' && config.host) {
			try {
				const protocol = config.protocol || 'http';
				const hawserHeaders: Record<string, string> = {};
				if (config.hawserToken) {
					hawserHeaders['X-Hawser-Token'] = config.hawserToken;
				}

				let hawserResp: Response;
				const tlsConfig = buildDockerClientConfig(config);
				if (tlsConfig) {
					hawserResp = await httpsAgentRequest(tlsConfig, '/_hawser/info', {}, false, hawserHeaders);
				} else {
					const hawserUrl = `http://${config.host}:${config.port || 2375}/_hawser/info`;
					hawserResp = await fetch(hawserUrl, {
						headers: hawserHeaders,
						signal: AbortSignal.timeout(5000),
						keepalive: false
					});
				}
				if (hawserResp.ok) {
					hawserInfo = await hawserResp.json();
				}
			} catch {
				// Hawser info fetch failed, continue without it
			}
		}

		return json({
			success: true,
			info: {
				serverVersion: info.ServerVersion,
				containers: info.Containers,
				images: info.Images,
				name: info.Name
			},
			hawser: hawserInfo
		});
	} catch (error) {
		const rawMessage = error instanceof Error ? error.message : '连接失败';
		console.error('测试连接失败:', rawMessage);

		// Provide more helpful error messages
		let message = rawMessage;
		if (rawMessage.includes('401') || rawMessage.toLowerCase().includes('unauthorized')) {
			message = '无效的令牌 - 请检查 Hawser 令牌是否匹配';
		} else if (rawMessage.includes('403') || rawMessage.toLowerCase().includes('forbidden')) {
			message = '访问被禁止 - 请检查令牌权限';
		} else if (rawMessage.includes('ECONNREFUSED') || rawMessage.includes('Connection refused')) {
			message = '连接被拒绝 - Docker/Hawser 是否正在运行？';
		} else if (rawMessage.includes('ETIMEDOUT') || rawMessage.includes('timeout') || rawMessage.includes('Timeout')) {
			message = '连接超时 - 请检查主机和端口';
		} else if (rawMessage.includes('ENOTFOUND') || rawMessage.includes('getaddrinfo')) {
			message = '未找到主机 - 请检查主机名';
		} else if (rawMessage.includes('EHOSTUNREACH')) {
			message = '主机不可达 - 请检查网络连接';
		} else if (rawMessage.includes('ENOENT') || rawMessage.includes('no such file')) {
			message = '未找到套接字 - 请检查套接字路径';
		} else if (rawMessage.includes('EACCES') || rawMessage.includes('permission denied')) {
			message = '权限不足 - 请检查套接字权限';
		} else if (rawMessage.includes('typo in the url') || rawMessage.includes('Was there a typo')) {
			message = '连接失败 - 请检查主机和端口';
		} else if (rawMessage.includes('self signed certificate') || rawMessage.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE')) {
			message = 'TLS 证书错误 - 自签名证书需要提供 CA 证书';
		} else if (rawMessage.includes('CERT_ALTNAME_INVALID') || rawMessage.includes('ERR_TLS_CERT_ALTNAME_INVALID')) {
			message = '证书主机名不匹配 - 证书的主题备用名称（SAN）与主机不匹配。请使用参数重新生成：-addext "subjectAltName=DNS:hostname,IP:x.x.x.x"';
		} else if (rawMessage.includes('certificate') || rawMessage.includes('SSL') || rawMessage.includes('TLS')) {
			message = 'TLS/SSL 错误 - 请检查证书配置';
		}

		return json({ success: false, error: message }, { status: 200 });
	}
};
