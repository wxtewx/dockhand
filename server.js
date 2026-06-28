/**
 * Production Server Wrapper
 *
 * Wraps @sveltejs/adapter-node's output with WebSocket support for:
 * - Terminal exec connections (xterm.js ↔ Docker exec)
 * - Hawser Edge agent connections
 *
 * Usage: node ./server.js
 */

import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { createConnection } from 'node:net';
import { connect as tlsConnect, rootCertificates } from 'node:tls';
import { randomUUID, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { handler } from './build/handler.js';

// Patch console to prepend ISO timestamps
const _log = console.log;
const _error = console.error;
const _warn = console.warn;
const ts = () => new Date().toISOString();
console.log = (...args) => _log(ts(), ...args);
console.error = (...args) => _error(ts(), ...args);
console.warn = (...args) => _warn(ts(), ...args);

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Optional native HTTPS listener (#1102). Off by default to keep existing
// deployments unchanged. When HTTPS_MODE=on, HTTPS_CERT_PATH and
// HTTPS_KEY_PATH must both point to readable PEM files.
const HTTPS_MODE = (process.env.HTTPS_MODE || 'off').toLowerCase();
const useHttps = HTTPS_MODE === 'on';

let server;
if (useHttps) {
	const certPath = process.env.HTTPS_CERT_PATH;
	const keyPath = process.env.HTTPS_KEY_PATH;
	const caPath = process.env.HTTPS_CA_PATH;

	console.log('[HTTPS] 模式=开启');
	console.log(`[HTTPS] 证书文件=${certPath || '(缺失)'}`);
	console.log(`[HTTPS] 私钥文件=${keyPath || '(缺失)'}`);
	console.log(`[HTTPS] CA 证书=${caPath || '(无)'}`);

	if (!certPath || !keyPath) {
		console.error('[HTTPS] 当 HTTPS_MODE=开启时，必须配置 HTTPS_CERT_PATH 与 HTTPS_KEY_PATH');
		process.exit(1);
	}

	let certPem, keyPem, caPem;
	try {
		certPem = readFileSync(certPath);
		keyPem = readFileSync(keyPath);
		if (caPath) caPem = readFileSync(caPath);
	} catch (e) {
		console.error(`[HTTPS] 读取证书/私钥文件失败: ${e.message}`);
		process.exit(1);
	}

	// Parse cert metadata so operators can confirm they mounted the right file.
	try {
		const x509 = new X509Certificate(certPem);
		console.log(`[HTTPS] 证书主题: ${x509.subject.replace(/\n/g, ', ')}`);
		console.log(`[HTTPS] 颁发机构:  ${x509.issuer.replace(/\n/g, ', ')}`);
		console.log(`[HTTPS] 证书 SAN:     ${x509.subjectAltName || '(无)'}`);
		console.log(`[HTTPS] 有效期限:   ${x509.validFrom} → ${x509.validTo}`);
		const expiresAt = new Date(x509.validTo).getTime();
		const daysLeft = Math.floor((expiresAt - Date.now()) / 86400000);
		if (daysLeft < 0) {
			console.warn(`[HTTPS] 警告：证书已过期 ${-daysLeft} 天`);
		} else if (daysLeft < 30) {
			console.warn(`[HTTPS] 警告：证书将在 ${daysLeft} 天后过期`);
		} else {
			console.log(`[HTTPS] 证书剩余有效期 ${daysLeft} 天`);
		}
	} catch (e) {
		console.error(`[HTTPS] 解析证书信息失败: ${e.message}`);
		process.exit(1);
	}

	const tlsOptions = { cert: certPem, key: keyPem };
	if (caPem) tlsOptions.ca = caPem;

	// HSTS — only meaningful over HTTPS, so wired only here. Default 1 year;
	// set HSTS_MAX_AGE=0 to disable.
	const hstsMaxAge = parseInt(process.env.HSTS_MAX_AGE ?? '31536000', 10);
	const hstsHeader = hstsMaxAge > 0 ? `max-age=${hstsMaxAge}` : null;
	if (hstsHeader) {
		console.log(`[HTTPS] HSTS 已启用: ${hstsHeader}`);
	} else {
		console.log('[HTTPS] HSTS 已关闭 (HSTS_MAX_AGE=0)');
	}

	server = createHttpsServer(tlsOptions, (req, res) => {
		if (hstsHeader) res.setHeader('Strict-Transport-Security', hstsHeader);
		handler(req, res);
	});
} else {
	console.log(`[HTTPS] 模式=关闭 设置 HTTPS_MODE=on 可启用原生 TLS)`);
	server = createHttpServer((req, res) => {
		handler(req, res);
	});
}

// Create WebSocket server attached to the HTTP server
const wss = new WebSocketServer({ noServer: true });

// Track connections
const wsConnections = new Map();
let wsConnectionCounter = 0;

// Track Edge exec sessions: execId -> { ws, environmentId }
const edgeExecSessions = new Map();

// Register global send function for Hawser Edge WebSocket messages.
// hawser.ts checks this first, and handleEdgeExec uses it for terminal relay.
// Reads from __hawserEdgeConnections which is populated by hawser.ts.
globalThis.__hawserSendMessage = (envId, message) => {
	const connections = globalThis.__hawserEdgeConnections;
	if (!connections) return false;
	const conn = connections.get(envId);
	if (!conn || !conn.ws) return false;
	try {
		conn.ws.send(message);
		return true;
	} catch (e) {
		console.error('[Hawser WS] 发送消息错误:', e);
		return false;
	}
};

// Register global handler for exec messages from Hawser Edge agents
// Called by hawser.ts when it receives exec_ready/exec_output/exec_end/error messages
globalThis.__terminalHandleExecMessage = (msg) => {
	const execId = msg.execId || msg.requestId;
	if (!execId) return;

	const session = edgeExecSessions.get(execId);
	if (!session || session.ws.readyState !== 1) return;

	if (msg.type === 'exec_ready') {
		// Agent is ready, frontend is already waiting for output
		return;
	}

	if (msg.type === 'exec_output') {
		const data = Buffer.from(msg.data, 'base64').toString('utf-8');
		session.ws.send(JSON.stringify({ type: 'output', data }));
		return;
	}

	if (msg.type === 'exec_end') {
		session.ws.send(JSON.stringify({ type: 'exit' }));
		session.ws.close();
		edgeExecSessions.delete(execId);
		return;
	}

	if (msg.type === 'error') {
		session.ws.send(JSON.stringify({ type: 'error', message: msg.error || msg.message }));
		session.ws.close();
		edgeExecSessions.delete(execId);
	}
};

// Handle WebSocket upgrade
server.on('upgrade', async (req, socket, head) => {
	const url = new URL(req.url || '/', `http://${req.headers.host}`);

	// Only handle our specific WebSocket paths
	const isTerminal = url.pathname.includes('/api/containers/') && url.pathname.includes('/exec');
	const isHawser = url.pathname === '/api/hawser/connect';

	if (!isTerminal && !isHawser) {
		socket.destroy();
		return;
	}

	let wsAuth = null;
	if (isTerminal) {
		try {
			if (typeof globalThis.__authenticateWsUpgrade !== 'function') {
				socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
				socket.destroy();
				return;
			}
			wsAuth = await globalThis.__authenticateWsUpgrade(req.headers);
			if (!wsAuth) {
				socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
				socket.destroy();
				return;
			}
		} catch (err) {
			console.error('[WS] 握手阶段身份验证异常:', err);
			socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
			socket.destroy();
			return;
		}
	}

	wss.handleUpgrade(req, socket, head, (ws) => {
		if (wsAuth) ws.__auth = wsAuth;
		wss.emit('connection', ws, req);
	});
});

wss.on('connection', (ws, req) => {
	const url = new URL(req.url || '/', `http://${req.headers.host}`);
	const connId = `ws-${++wsConnectionCounter}`;
	const remoteIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
		|| req.socket.remoteAddress
		|| 'unknown';

	if (url.pathname === '/api/hawser/connect') {
		handleHawserConnection(ws, connId, remoteIp);
	} else {
		handleTerminalConnection(ws, url, connId);
	}
});

/**
 * Handle terminal exec WebSocket connections.
 * Supports all connection types: socket, direct TCP/TLS, hawser-standard, hawser-edge.
 *
 * Uses globalThis functions exposed by the SvelteKit app (docker.ts):
 * - __terminalGetTarget(envId) - resolves connection info from environment
 * - __terminalCreateExec(containerId, shell, user, envId) - creates exec via Docker API
 * - __terminalResizeExec(execId, cols, rows, envId) - resizes exec terminal
 */
async function handleTerminalConnection(ws, url, connId) {
	const pathParts = url.pathname.split('/');
	const containerIdIndex = pathParts.indexOf('containers') + 1;
	const containerId = pathParts[containerIdIndex];
	const shell = url.searchParams.get('shell') || '/bin/sh';
	const user = url.searchParams.get('user') || 'root';
	const envIdParam = url.searchParams.get('envId');
	const envId = envIdParam ? parseInt(envIdParam, 10) : undefined;

	if (!containerId) {
		ws.send(JSON.stringify({ type: 'error', message: '未传入容器 ID' }));
		ws.close();
		return;
	}

	if (ws.__auth && typeof globalThis.__canAccessEnvForUser === 'function') {
		try {
			const ok = await globalThis.__canAccessEnvForUser(ws.__auth, envId);
			if (!ok) {
				console.warn(`[WS] 环境访问权限拒绝：用户=${ws.__auth.username} 环境 ID=${envId}`);
				ws.send(JSON.stringify({ type: 'error', message: '无该环境的访问权限' }));
				ws.close(1008, 'env access denied');
				return;
			}
		} catch (err) {
			console.error('[WS] 环境权限校验失败:', err);
			ws.close(1011, 'internal error');
			return;
		}
	}

	try {
		// Resolve Docker target via SvelteKit app's database
		let target;
		if (typeof globalThis.__terminalGetTarget === 'function') {
			target = await globalThis.__terminalGetTarget(envId);
		} else {
			// Fallback: local socket only (SvelteKit not yet loaded)
			target = { type: 'socket', connectionType: 'socket', socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' };
		}

		// Handle Hawser Edge mode - relay through agent WebSocket
		if (target.connectionType === 'hawser-edge') {
			handleEdgeExec(ws, connId, containerId, shell, user, target.environmentId);
			return;
		}

		// Create exec instance via SvelteKit app (handles all connection types)
		let execId;
		if (typeof globalThis.__terminalCreateExec === 'function') {
			execId = await globalThis.__terminalCreateExec(containerId, shell, user, envId);
		} else {
			// Fallback: create exec directly via local socket
			execId = await createExecLocal(containerId, shell, user, target.socketPath || '/var/run/docker.sock');
		}

		// Open raw bidirectional stream to Docker for the exec session
		const startBody = JSON.stringify({ Detach: false, Tty: true });
		let dockerStream;

		if (target.type === 'socket') {
			const socketPath = target.socketPath || '/var/run/docker.sock';
			dockerStream = createConnection({ path: socketPath });
		} else if (target.type === 'https' && target.tls) {
			const tlsOpts = {
				host: target.host,
				port: target.port,
				servername: target.host,
				rejectUnauthorized: target.tls.rejectUnauthorized ?? true
			};
			if (target.tls.ca) tlsOpts.ca = [target.tls.ca, ...rootCertificates];
			if (target.tls.cert) tlsOpts.cert = [target.tls.cert];
			if (target.tls.key) tlsOpts.key = target.tls.key;
			dockerStream = tlsConnect(tlsOpts);
		} else {
			// Plain HTTP (direct TCP or hawser-standard)
			dockerStream = createConnection({ host: target.host, port: target.port });
		}

		dockerStream.on('connect', () => {
			const host = target.host || 'localhost';
			const tokenHeader = target.hawserToken ? `X-Hawser-Token: ${target.hawserToken}\r\n` : '';
			dockerStream.write(
				`POST /exec/${execId}/start HTTP/1.1\r\n` +
				`Host: ${host}\r\n` +
				`Content-Type: application/json\r\n` +
				`${tokenHeader}` +
				`Connection: Upgrade\r\n` +
				`Upgrade: tcp\r\n` +
				`Content-Length: ${Buffer.byteLength(startBody)}\r\n` +
				`\r\n` +
				startBody
			);
		});

		let headersStripped = false;
		let isChunked = false;

		dockerStream.on('data', (data) => {
			if (ws.readyState !== 1) return;

			let text = data.toString('utf-8');
			if (!headersStripped) {
				if (text.toLowerCase().includes('transfer-encoding: chunked')) {
					isChunked = true;
				}
				const headerEnd = text.indexOf('\r\n\r\n');
				if (headerEnd > -1) {
					text = text.slice(headerEnd + 4);
					headersStripped = true;
				} else if (text.startsWith('HTTP/')) {
					return;
				}
			}
			if (isChunked && text) {
				text = text.replace(/^[0-9a-fA-F]+\r\n/gm, '').replace(/\r\n$/g, '');
			}
			if (text) {
				ws.send(JSON.stringify({ type: 'output', data: text }));
			}
		});

		dockerStream.on('close', () => {
			if (ws.readyState === 1) {
				ws.send(JSON.stringify({ type: 'exit' }));
				ws.close();
			}
		});

		dockerStream.on('error', (err) => {
			console.error('[Terminal WS] Socket 错误:', err.message);
			if (ws.readyState === 1) {
				ws.send(JSON.stringify({ type: 'error', message: err.message }));
			}
		});

		// Forward terminal input from browser to Docker
		ws.on('message', (data) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.type === 'input' && msg.data) {
					dockerStream.write(msg.data);
				} else if (msg.type === 'resize' && msg.cols && msg.rows) {
					// Use SvelteKit's resize function if available (works for all connection types)
					if (typeof globalThis.__terminalResizeExec === 'function') {
						globalThis.__terminalResizeExec(execId, msg.cols, msg.rows, envId).catch(() => {});
					} else {
						// Fallback: resize via local socket
						const socketPath = target.socketPath || '/var/run/docker.sock';
						const resizeReq = httpRequest({
							socketPath,
							path: `/exec/${execId}/resize?h=${msg.rows}&w=${msg.cols}`,
							method: 'POST',
						}, () => {});
						resizeReq.on('error', () => {});
						resizeReq.end();
					}
				}
			} catch {}
		});

		ws.on('close', () => {
			dockerStream.destroy();
		});

		wsConnections.set(connId, { stream: dockerStream, ws });
	} catch (err) {
		console.error('[Terminal WS] 错误:', err.message);
		if (ws.readyState === 1) {
			ws.send(JSON.stringify({ type: 'error', message: err.message }));
			ws.close();
		}
	}

	ws.on('close', () => {
		wsConnections.delete(connId);
	});
}

/**
 * Handle Hawser Edge exec session.
 * Sends exec commands through the Hawser WebSocket relay.
 */
function handleEdgeExec(ws, connId, containerId, shell, user, environmentId) {
	if (typeof globalThis.__hawserSendMessage !== 'function') {
		ws.send(JSON.stringify({ type: 'error', message: '边缘代理处理程序未就绪' }));
		ws.close();
		return;
	}

	const execId = randomUUID();
	edgeExecSessions.set(execId, { ws, execId, environmentId });

	// Send exec_start to the Hawser agent
	const execStartMsg = JSON.stringify({
		type: 'exec_start',
		execId,
		containerId,
		cmd: shell,
		user,
		cols: 120,
		rows: 30
	});

	const sent = globalThis.__hawserSendMessage(environmentId, execStartMsg);
	if (!sent) {
		edgeExecSessions.delete(execId);
		ws.send(JSON.stringify({ type: 'error', message: '边缘代理未连接' }));
		ws.close();
		return;
	}

	// Forward terminal input/resize from browser to agent
	ws.on('message', (data) => {
		try {
			const msg = JSON.parse(data.toString());
			if (msg.type === 'input' && msg.data) {
				const inputMsg = JSON.stringify({
					type: 'exec_input',
					execId,
					data: Buffer.from(msg.data).toString('base64')
				});
				globalThis.__hawserSendMessage(environmentId, inputMsg);
			} else if (msg.type === 'resize' && msg.cols && msg.rows) {
				const resizeMsg = JSON.stringify({
					type: 'exec_resize',
					execId,
					cols: msg.cols,
					rows: msg.rows
				});
				globalThis.__hawserSendMessage(environmentId, resizeMsg);
			}
		} catch {}
	});

	ws.on('close', () => {
		// Notify agent that exec session ended
		if (typeof globalThis.__hawserSendMessage === 'function') {
			const endMsg = JSON.stringify({
				type: 'exec_end',
				execId,
				reason: 'user_closed'
			});
			globalThis.__hawserSendMessage(environmentId, endMsg);
		}
		edgeExecSessions.delete(execId);
		wsConnections.delete(connId);
	});

	wsConnections.set(connId, { ws });
}

/**
 * Fallback: Create exec via local Docker socket (used before SvelteKit app is loaded)
 */
function createExecLocal(containerId, shell, user, socketPath) {
	const createBody = JSON.stringify({
		AttachStdin: true,
		AttachStdout: true,
		AttachStderr: true,
		Tty: true,
		Cmd: [shell],
		User: user
	});

	return new Promise((resolve, reject) => {
		const req = httpRequest({
			socketPath,
			path: `/containers/${containerId}/exec`,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(createBody),
			},
		}, (res) => {
			const chunks = [];
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
				try {
					const body = JSON.parse(Buffer.concat(chunks).toString());
					if (res.statusCode === 201 && body.Id) {
						resolve(body.Id);
					} else {
						reject(new Error(body.message || `执行创建失败: ${res.statusCode}`));
					}
				} catch (e) {
					reject(new Error('解析执行响应失败'));
				}
			});
			res.on('error', reject);
		});
		req.on('error', reject);
		req.write(createBody);
		req.end();
	});
}

/**
 * Handle Hawser Edge WebSocket connections.
 * The full Hawser protocol is handled by the SvelteKit app
 * via the global hawser connection manager.
 */
function handleHawserConnection(ws, connId, remoteIp) {
	console.log('[Hawser WS] 新连接等待认证');

	ws.on('message', async (data) => {
		try {
			const msg = JSON.parse(data.toString());

			// Use the global hawser message handler injected by the SvelteKit app
			if (typeof globalThis.__hawserHandleMessage === 'function') {
				try {
					await globalThis.__hawserHandleMessage(ws, msg, connId, remoteIp);
				} catch (handlerError) {
					console.error('[Hawser WS] Handler error:', handlerError);
					// Don't close connection - let it recover
				}
			} else {
				console.warn('[Hawser WS] 未注册全局处理程序');
				ws.send(JSON.stringify({ type: 'error', message: '服务器未就绪' }));
			}
		} catch (err) {
			console.error('[Hawser WS] 消息解析错误:', err.message);
		}
	});

	ws.on('close', () => {
		if (typeof globalThis.__hawserHandleDisconnect === 'function') {
			globalThis.__hawserHandleDisconnect(ws, connId);
		}
	});

	ws.on('error', (err) => {
		console.error('[Hawser WS] 连接错误:', err.message);
	});
}

// Start the server
server.listen(PORT, HOST, () => {
	const scheme = useHttps ? 'https' : 'http';
	console.log(`服务已监听地址：${scheme}://${HOST}:${PORT}/，已启用 WebSocket`);
});


