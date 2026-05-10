import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { getEnvironment } from '$lib/server/db';
import { unixSocketRequest, unixSocketStreamRequest, httpsAgentRequest } from '$lib/server/docker';
import type { DockerClientConfig as BaseDockerClientConfig } from '$lib/server/docker';
import { sendEdgeRequest, sendEdgeStreamRequest, isEdgeConnected } from '$lib/server/hawser';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

// Detect Docker socket path
function detectDockerSocket(): string {
	if (process.env.DOCKER_SOCKET && existsSync(process.env.DOCKER_SOCKET)) {
		return process.env.DOCKER_SOCKET;
	}
	if (process.env.DOCKER_HOST?.startsWith('unix://')) {
		const socketPath = process.env.DOCKER_HOST.replace('unix://', '');
		if (existsSync(socketPath)) return socketPath;
	}
	const possibleSockets = [
		'/var/run/docker.sock',
		`${homedir()}/.docker/run/docker.sock`,
		`${homedir()}/.orbstack/run/docker.sock`,
		'/run/docker.sock'
	];
	for (const socket of possibleSockets) {
		if (existsSync(socket)) return socket;
	}
	return '/var/run/docker.sock';
}

const socketPath = detectDockerSocket();

interface DockerClientConfig {
	type: 'socket' | 'http' | 'https' | 'hawser-edge';
	socketPath?: string;
	host?: string;
	port?: number;
	ca?: string;
	cert?: string;
	key?: string;
	skipVerify?: boolean;
	hawserToken?: string;
	environmentId?: number;
}

async function getDockerConfig(envId?: number | null): Promise<DockerClientConfig | null> {
	if (!envId) {
		return null;
	}
	const env = await getEnvironment(envId);
	if (!env) {
		return null;
	}
	if (env.connectionType === 'socket' || !env.connectionType) {
		return { type: 'socket', socketPath: env.socketPath || socketPath };
	}
	if (env.connectionType === 'hawser-edge') {
		return { type: 'hawser-edge', environmentId: envId };
	}
	const protocol = (env.protocol as 'http' | 'https') || 'http';
	return {
		type: protocol,
		host: env.host || 'localhost',
		port: env.port || 2375,
		ca: env.tlsCa || undefined,
		cert: env.tlsCert || undefined,
		key: env.tlsKey || undefined,
		skipVerify: env.tlsSkipVerify || undefined,
		hawserToken: env.connectionType === 'hawser-standard' ? env.hawserToken || undefined : undefined
	};
}

/**
 * Parse Docker log line with timestamp
 * Format: 2024-01-15T10:30:00.123456789Z log content here
 */
function parseTimestampedLog(line: string): { timestamp: Date | null; content: string } {
	// Match RFC3339Nano timestamp at start of line
	const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s*/);
	if (match) {
		return {
			timestamp: new Date(match[1]),
			content: line.slice(match[0].length)
		};
	}
	return { timestamp: null, content: line };
}

/**
 * Demultiplex Docker stream frame - returns payload and stream type
 */
function parseDockerFrame(buffer: Buffer, offset: number): { type: number; size: number; payload: string } | null {
	if (buffer.length < offset + 8) return null;

	const streamType = buffer.readUInt8(offset);
	const frameSize = buffer.readUInt32BE(offset + 4);

	if (buffer.length < offset + 8 + frameSize) return null;

	const payload = buffer.slice(offset + 8, offset + 8 + frameSize).toString('utf-8');
	return { type: streamType, size: 8 + frameSize, payload };
}

// Color palette for different containers
const CONTAINER_COLORS = [
	'#60a5fa', // blue
	'#4ade80', // green
	'#f472b6', // pink
	'#facc15', // yellow
	'#a78bfa', // purple
	'#fb923c', // orange
	'#22d3ee', // cyan
	'#f87171', // red
	'#34d399', // emerald
	'#c084fc', // violet
];

interface ContainerLogSource {
	containerId: string;
	containerName: string;
	color: string;
	hasTty: boolean;
	reader: ReadableStreamDefaultReader<Uint8Array> | null;
	buffer: Buffer;
	done: boolean;
}

interface EdgeContainerLogSource {
	containerId: string;
	containerName: string;
	color: string;
	hasTty: boolean;
	buffer: Buffer;
	done: boolean;
	cancel: () => void;
}

/**
 * Handle merged logs streaming for Hawser Edge connections
 */
async function handleEdgeMergedLogs(containerIds: string[], tail: string, environmentId: number): Promise<Response> {
	// Check if edge agent is connected
	if (!isEdgeConnected(environmentId)) {
		return new Response(JSON.stringify({ error: '边缘代理未连接' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	let controllerClosed = false;
	let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
	const sources: EdgeContainerLogSource[] = [];

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			const safeEnqueue = (data: string) => {
				if (!controllerClosed) {
					try {
						controller.enqueue(encoder.encode(data));
					} catch {
						controllerClosed = true;
					}
				}
			};

			// Send heartbeat to keep connection alive (every 5s to prevent Traefik 10s idle timeout)
			heartbeatInterval = setInterval(() => {
				safeEnqueue(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
			}, 5000);

			// Setup function for a single container via Edge
			const setupEdgeContainer = async (containerId: string, index: number): Promise<EdgeContainerLogSource | null> => {
				try {
					// Get container info (name and TTY status)
					const inspectPath = `/containers/${containerId}/json`;
					const inspectResponse = await sendEdgeRequest(environmentId, 'GET', inspectPath);

					if (inspectResponse.statusCode !== 200) {
						console.log(`[合并日志-边缘] 检查容器 ${containerId.slice(0, 12)} 失败，已跳过`);
						return null;
					}

					const info = JSON.parse(inspectResponse.body as string);
					const containerName = info.Name?.replace(/^\//, '') || containerId.slice(0, 12);
					const hasTty = info.Config?.Tty ?? false;

					const source: EdgeContainerLogSource = {
						containerId,
						containerName,
						color: CONTAINER_COLORS[index % CONTAINER_COLORS.length],
						hasTty,
						buffer: Buffer.alloc(0),
						done: false,
						cancel: () => {}
					};

					// Start log stream for this container via Edge
					const logsPath = `/containers/${containerId}/logs?stdout=true&stderr=true&follow=true&tail=${tail}&timestamps=true`;

					const { cancel } = sendEdgeStreamRequest(
						environmentId,
						'GET',
						logsPath,
						{
							onData: (data: string, streamType?: 'stdout' | 'stderr') => {
								if (controllerClosed || source.done) return;

								if (hasTty) {
									// TTY mode: data is raw text, may be base64 encoded
									let text = data;
									try {
										text = Buffer.from(data, 'base64').toString('utf-8');
									} catch {
										// Not base64, use as-is
									}

									const lines = text.split('\n');
									for (const line of lines) {
										if (line.trim()) {
											const { timestamp, content } = parseTimestampedLog(line);
											safeEnqueue(`event: log\ndata: ${JSON.stringify({
												containerId: source.containerId,
												containerName: source.containerName,
												color: source.color,
												text: content + '\n',
												timestamp: timestamp?.toISOString()
											})}\n\n`);
										}
									}
								} else {
									// Non-TTY mode: data might be base64 encoded Docker multiplexed stream
									let rawData: Buffer;
									try {
										rawData = Buffer.from(data, 'base64');
									} catch {
										rawData = Buffer.from(data, 'utf-8');
									}

									source.buffer = Buffer.concat([source.buffer, rawData]);

									// Process complete frames
									let offset = 0;
									while (true) {
										const frame = parseDockerFrame(source.buffer, offset);
										if (!frame) break;

										if (frame.payload) {
											const lines = frame.payload.split('\n');
											for (const line of lines) {
												if (line.trim()) {
													const { timestamp, content } = parseTimestampedLog(line);
													safeEnqueue(`event: log\ndata: ${JSON.stringify({
														containerId: source.containerId,
														containerName: source.containerName,
														color: source.color,
														text: content + '\n',
														timestamp: timestamp?.toISOString(),
														stream: frame.type === 2 ? 'stderr' : 'stdout'
													})}\n\n`);
												}
											}
										}
										offset += frame.size;
									}

									source.buffer = source.buffer.slice(offset);
								}
							},
							onEnd: (reason?: string) => {
								source.done = true;
								// Check if all sources are done
								if (sources.every(s => s.done)) {
									safeEnqueue(`event: end\ndata: ${JSON.stringify({ reason: '所有流已结束' })}\n\n`);
									if (!controllerClosed) {
										try {
											controller.close();
										} catch {
											// Already closed
										}
									}
								}
							},
							onError: (error: string) => {
								console.error(`[合并日志-边缘] ${containerName} 错误:`, error);
								source.done = true;
							}
						}
					);

					source.cancel = cancel;
					return source;
				} catch (error) {
					console.error(`[合并日志-边缘] 设置容器 ${containerId} 日志源失败:`, error);
					return null;
				}
			};

			// Setup all containers in parallel
			console.log(`[合并日志-边缘] 并行初始化 ${containerIds.length} 个容器...`);
			const setupStart = Date.now();
			const results = await Promise.all(
				containerIds.map((id, index) => setupEdgeContainer(id, index))
			);
			console.log(`[合并日志-边缘] 并行初始化完成，耗时 ${Date.now() - setupStart}ms`);

			// Filter out failed containers
			for (const result of results) {
				if (result) {
					sources.push(result);
				}
			}

			if (sources.length === 0) {
				console.log('[合并日志-边缘] 无有效容器，返回错误');
				safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: '未找到有效容器' })}\n\n`);
				if (!controllerClosed) controller.close();
				return;
			}

			console.log(`[合并日志-边缘] 日志源就绪：${sources.length} 个，发送连接成功事件`);
			// Send connected event with container info
			safeEnqueue(`event: connected\ndata: ${JSON.stringify({
				containers: sources.map(s => ({
					id: s.containerId,
					name: s.containerName,
					color: s.color
				}))
			})}\n\n`);

			// Edge streaming is handled by callbacks, no polling loop needed
		},
		cancel() {
			controllerClosed = true;
			if (heartbeatInterval) {
				clearInterval(heartbeatInterval);
				heartbeatInterval = null;
			}
			// Cancel all active streams
			for (const source of sources) {
				if (source.cancel) {
					source.cancel();
				}
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	// Parse container IDs from comma-separated list
	const containerIds = url.searchParams.get('containers')?.split(',').filter(Boolean) || [];
	const tail = url.searchParams.get('tail') || '100';
	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('containers', 'logs', envIdNum)) {
		return new Response(JSON.stringify({ error: '权限不足' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (containerIds.length === 0) {
		return new Response(JSON.stringify({ error: '未指定任何容器' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	console.log(`[合并日志] 请求：容器数=${containerIds.length}, 环境=${envId}`);
	const config = await getDockerConfig(envIdNum);
	console.log(`[合并日志] 配置：类型=${config.type}, 主机=${config.host}, 端口=${config.port}`);

	// Handle Hawser Edge mode separately
	if (config.type === 'hawser-edge') {
		return handleEdgeMergedLogs(containerIds, tail, config.environmentId!);
	}

	let controllerClosed = false;
	const abortControllers: AbortController[] = [];
	let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			const safeEnqueue = (data: string) => {
				if (!controllerClosed) {
					try {
						controller.enqueue(encoder.encode(data));
					} catch {
						controllerClosed = true;
					}
				}
			};

			// Send heartbeat to keep connection alive (every 5s to prevent Traefik 10s idle timeout)
			heartbeatInterval = setInterval(() => {
				safeEnqueue(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
			}, 5000);

			// Initialize log sources for each container - PARALLEL setup for better performance
			const sources: ContainerLogSource[] = [];

			// Setup function for a single container
			const setupContainer = async (containerId: string, index: number): Promise<ContainerLogSource | null> => {
				const abortController = new AbortController();
				abortControllers.push(abortController);

				try {
					// Get container info (name and TTY status)
					const inspectPath = `/containers/${containerId}/json`;
					let inspectResponse: Response;

					if (config.type === 'socket') {
						inspectResponse = await unixSocketRequest(config.socketPath, inspectPath);
					} else if (config.type === 'https') {
						const extraHeaders: Record<string, string> = {};
						if (config.hawserToken) extraHeaders['X-Hawser-Token'] = config.hawserToken;
						inspectResponse = await httpsAgentRequest(config as BaseDockerClientConfig, inspectPath, {}, false, extraHeaders);
					} else {
						const inspectUrl = `http://${config.host}:${config.port}${inspectPath}`;
						const inspectHeaders: Record<string, string> = {};
						if (config.hawserToken) inspectHeaders['X-Hawser-Token'] = config.hawserToken;
						inspectResponse = await fetch(inspectUrl, { headers: inspectHeaders, signal: AbortSignal.timeout(30000) });
					}

					if (!inspectResponse.ok) {
						await inspectResponse.arrayBuffer().catch(() => {});
						console.log(`[合并日志] 检查容器 ${containerId.slice(0, 12)} 失败，已跳过`);
						return null;
					}

					const info = await inspectResponse.json();
					const containerName = info.Name?.replace(/^\//, '') || containerId.slice(0, 12);
					const hasTty = info.Config?.Tty ?? false;

					// Start log stream for this container
					const logsPath = `/containers/${containerId}/logs?stdout=true&stderr=true&follow=true&tail=${tail}&timestamps=true`;
					let logsResponse: Response;

					if (config.type === 'socket') {
						logsResponse = await unixSocketStreamRequest(config.socketPath, logsPath);
					} else if (config.type === 'https') {
						const extraHeaders: Record<string, string> = {};
						if (config.hawserToken) extraHeaders['X-Hawser-Token'] = config.hawserToken;
						logsResponse = await httpsAgentRequest(config as BaseDockerClientConfig, logsPath, {}, true, extraHeaders);
					} else {
						const logsUrl = `http://${config.host}:${config.port}${logsPath}`;
						const logsHeaders: Record<string, string> = {};
						if (config.hawserToken) logsHeaders['X-Hawser-Token'] = config.hawserToken;
						logsResponse = await fetch(logsUrl, { headers: logsHeaders, signal: abortController.signal });
					}

					if (!logsResponse.ok) {
						await logsResponse.arrayBuffer().catch(() => {});
						console.error(`[合并日志] 获取容器 ${containerId} 日志失败: ${logsResponse.status}`);
						return null;
					}

					const reader = logsResponse.body?.getReader() || null;

					return {
						containerId,
						containerName,
						color: CONTAINER_COLORS[index % CONTAINER_COLORS.length],
						hasTty,
						reader,
						buffer: Buffer.alloc(0),
						done: false
					};
				} catch (error) {
					console.error(`设置容器 ${containerId} 日志源失败:`, error);
					return null;
				}
			};

			// Setup all containers in parallel
			console.log(`[合并日志] 并行初始化 ${containerIds.length} 个容器...`);
			const setupStart = Date.now();
			const results = await Promise.all(
				containerIds.map((id, index) => setupContainer(id, index))
			);
			console.log(`[合并日志] 并行初始化完成，耗时 ${Date.now() - setupStart}ms`);

			// Filter out failed containers
			for (const result of results) {
				if (result) {
					sources.push(result);
				}
			}

			if (sources.length === 0) {
				console.log('[合并日志] 无有效容器，返回错误');
				safeEnqueue(`event: error\ndata: ${JSON.stringify({ error: '未找到有效容器' })}\n\n`);
				if (!controllerClosed) controller.close();
				return;
			}

			console.log(`[合并日志] 日志源就绪：${sources.length} 个，发送连接成功事件`);
			// Send connected event with container info
			safeEnqueue(`event: connected\ndata: ${JSON.stringify({
				containers: sources.map(s => ({
					id: s.containerId,
					name: s.containerName,
					color: s.color
				}))
			})}\n\n`);

			// Process logs from all sources
			const processSource = async (source: ContainerLogSource) => {
				if (!source.reader || source.done) return;

				try {
					const { done, value } = await source.reader.read();

					if (done) {
						source.done = true;
						return;
					}

					if (value) {
						if (source.hasTty) {
							// TTY mode: raw text
							const text = new TextDecoder().decode(value);
							const lines = text.split('\n');
							for (const line of lines) {
								if (line.trim()) {
									const { timestamp, content } = parseTimestampedLog(line);
									safeEnqueue(`event: log\ndata: ${JSON.stringify({
										containerId: source.containerId,
										containerName: source.containerName,
										color: source.color,
										text: content + '\n',
										timestamp: timestamp?.toISOString()
									})}\n\n`);
								}
							}
						} else {
							// Non-TTY mode: demux Docker stream frames
							source.buffer = Buffer.concat([source.buffer, Buffer.from(value)]);

							let offset = 0;
							while (true) {
								const frame = parseDockerFrame(source.buffer, offset);
								if (!frame) break;

								if (frame.payload) {
									const lines = frame.payload.split('\n');
									for (const line of lines) {
										if (line.trim()) {
											const { timestamp, content } = parseTimestampedLog(line);
											safeEnqueue(`event: log\ndata: ${JSON.stringify({
												containerId: source.containerId,
												containerName: source.containerName,
												color: source.color,
												text: content + '\n',
												timestamp: timestamp?.toISOString(),
												stream: frame.type === 2 ? 'stderr' : 'stdout'
											})}\n\n`);
										}
									}
								}
								offset += frame.size;
							}

							source.buffer = source.buffer.slice(offset);
						}
					}
				} catch (error) {
					if (!String(error).includes('abort')) {
						console.error(`从 ${source.containerName} 读取日志错误:`, error);
					}
					source.done = true;
				}
			};

			// Each source streams independently — no lockstep polling
			console.log(`[合并日志] 启动 ${sources.length} 个独立读取循环`);

			let endedCount = 0;
			const checkAllDone = () => {
				endedCount++;
				if (endedCount >= sources.length) {
					safeEnqueue(`event: end\ndata: ${JSON.stringify({ reason: '所有流已结束' })}\n\n`);
					if (!controllerClosed) {
						try { controller.close(); } catch { /* Already closed */ }
					}
				}
			};

			const runSource = async (source: ContainerLogSource) => {
				try {
					while (!controllerClosed && !source.done) {
						await processSource(source);
					}
				} finally {
					if (source.reader) {
						try {
							await source.reader.cancel().catch(() => {});
							source.reader.releaseLock();
						} catch { /* Ignore */ }
					}
					checkAllDone();
				}
			};

			await Promise.all(sources.map(runSource));
		},
		cancel() {
			controllerClosed = true;
			if (heartbeatInterval) {
				clearInterval(heartbeatInterval);
				heartbeatInterval = null;
			}
			for (const ac of abortControllers) {
				ac.abort();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
