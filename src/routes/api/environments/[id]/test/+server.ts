import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnvironment, updateEnvironment } from '$lib/server/db';
import { getDockerInfo, getHawserInfo } from '$lib/server/docker';
import { edgeConnections, isEdgeConnected } from '$lib/server/hawser';

export const POST: RequestHandler = async ({ params }) => {
	try {
		const id = parseInt(params.id);
		const env = await getEnvironment(id);

		if (!env) {
			return json({ error: '环境不存在' }, { status: 404 });
		}

		// Edge mode - check connection status immediately without blocking
		if (env.connectionType === 'hawser-edge') {
			const edgeConn = edgeConnections.get(id);
			const connected = isEdgeConnected(id);

			if (!connected) {
				console.log(`[Test] 边缘环境 ${id} (${env.name}) - 代理未连接`);
				return json({
					success: false,
					error: '边缘代理未连接',
					isEdgeMode: true,
					hawser: env.hawserVersion ? {
						hawserVersion: env.hawserVersion,
						agentId: env.hawserAgentId,
						agentName: env.hawserAgentName
					} : null
				}, { status: 200 });
			}

			// Agent is connected - try to get Docker info with shorter timeout
			console.log(`[Test] 边缘环境 ${id} (${env.name}) - 代理已连接，正在测试 Docker...`);
			try {
				const info = await getDockerInfo(env.id) as any;
				return json({
					success: true,
					info: {
						serverVersion: info.ServerVersion,
						containers: info.Containers,
						images: info.Images,
						name: info.Name
					},
					isEdgeMode: true,
					hawser: edgeConn ? {
						hawserVersion: edgeConn.agentVersion,
						agentId: edgeConn.agentId,
						agentName: edgeConn.agentName,
						hostname: edgeConn.hostname,
						dockerVersion: edgeConn.dockerVersion,
						capabilities: edgeConn.capabilities
					} : null
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Docker API 调用失败';
				console.error(`[Test] 边缘环境 ${id} Docker 测试失败:`, message);
				return json({
					success: false,
					error: message,
					isEdgeMode: true,
					hawser: edgeConn ? {
						hawserVersion: edgeConn.agentVersion,
						agentId: edgeConn.agentId,
						agentName: edgeConn.agentName
					} : null
				}, { status: 200 });
			}
		}

		// For Hawser Standard mode, fetch Docker info and Hawser info in parallel
		// (parallel calls are more efficient and avoid sequential connection issues)
		let info: any;
		let hawserInfo = null;
		if (env.connectionType === 'hawser-standard') {
			const [dockerResult, hawserResult] = await Promise.all([
				getDockerInfo(env.id),
				getHawserInfo(id)
			]);
			info = dockerResult;
			hawserInfo = hawserResult;
			if (hawserInfo?.hawserVersion) {
				await updateEnvironment(id, {
					hawserVersion: hawserInfo.hawserVersion,
					hawserAgentId: hawserInfo.agentId,
					hawserAgentName: hawserInfo.agentName,
					hawserLastSeen: new Date().toISOString()
				});
			}
		} else {
			info = await getDockerInfo(env.id);
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

		// Provide more helpful error messages for Hawser connections
		let message = rawMessage;
		if (rawMessage.includes('401') || rawMessage.toLowerCase().includes('unauthorized')) {
			message = '无效的令牌 - 请检查 Hawser 令牌是否匹配';
		} else if (rawMessage.includes('403') || rawMessage.toLowerCase().includes('forbidden')) {
			message = '访问被禁止 - 请检查令牌权限';
		} else if (rawMessage.includes('ECONNREFUSED') || rawMessage.includes('Connection refused')) {
			message = '连接被拒绝 - Hawser 是否正在运行？';
		} else if (rawMessage.includes('ETIMEDOUT') || rawMessage.includes('timeout') || rawMessage.includes('Timeout')) {
			message = '连接超时 - 请检查主机和端口';
		} else if (rawMessage.includes('ENOTFOUND') || rawMessage.includes('getaddrinfo')) {
			message = '未找到主机 - 请检查主机名';
		} else if (rawMessage.includes('EHOSTUNREACH')) {
			message = '主机不可达 - 请检查网络连接';
		}

		return json({ success: false, error: message }, { status: 200 });
	}
};
