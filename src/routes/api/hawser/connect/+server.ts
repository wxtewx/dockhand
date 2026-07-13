/**
 * Hawser Edge WebSocket Connect Endpoint
 *
 * This endpoint handles WebSocket connections from Hawser agents running in Edge mode.
 * In development: WebSocket is handled by ws.WebSocketServer in vite.config.ts on port 5174
 * In production: WebSocket is handled by the server wrapper in server.ts
 *
 * The HTTP GET endpoint returns connection info for clients.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isEdgeConnected, getAllEdgeConnections } from '$lib/server/hawser';

/**
 * GET /api/hawser/connect
 * Returns status of the Hawser Edge connection endpoint
 * This is used for health checks and debugging
 */
export const GET: RequestHandler = async () => {
	const connections = getAllEdgeConnections();
	const connectionList = Array.from(connections.entries()).map(([envId, conn]) => ({
		environmentId: envId,
		agentId: conn.agentId,
		agentName: conn.agentName,
		agentVersion: conn.agentVersion,
		dockerVersion: conn.dockerVersion,
		hostname: conn.hostname,
		capabilities: conn.capabilities,
		connectedAt: conn.connectedAt.toISOString(),
		lastHeartbeat: new Date(conn.lastHeartbeat).toISOString()
	}));

	return json({
		status: 'ready',
		message: 'Hawser Edge WebSocket 端点。通过 WebSocket 连接。',
		protocol: 'wss://<host>/api/hawser/connect',
		activeConnections: connectionList.length,
		connections: connectionList
	});
};

/**
 * POST /api/hawser/connect
 * This is a fallback for non-WebSocket clients.
 * Returns instructions for connecting via WebSocket.
 */
export const POST: RequestHandler = async () => {
	return json(
		{
			error: '需要 WebSocket 连接',
			message: '此端点需要 WebSocket 连接。请使用 ws:// 或 wss:// 协议。',
			instructions: [
				'1. 在 设置 > 环境 > [环境] > Hawser 中生成令牌',
				'2. 使用 DOCKHAND_SERVER_URL 和 TOKEN 配置你的 Hawser 代理',
				'3. 代理将自动连接'
			]
		},
		{ status: 426 }
	); // 426 Upgrade Required
};
