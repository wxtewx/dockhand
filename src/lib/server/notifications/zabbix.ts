import {
	notificationFetch,
	type NotificationPayload,
	type NotificationResult
} from './shared';

interface ZabbixApiResponse {
	jsonrpc?: string;

	result?: {
		response?: string;
		data?: Array<{
			itemid?: string;
			error?: string;
		}>;
	};

	error?: {
		code?: number;
		message?: string;
		data?: string;
	};

	id?: number;
}

export async function sendZabbix(
	zabbixUrl: string,
	payload: NotificationPayload
): Promise<NotificationResult> {
	try {
		const secure = /^zabbixs:\/\//i.test(zabbixUrl);
		const httpUrl = zabbixUrl.replace(
			/^zabbixs?:\/\//i,
			secure ? 'https://' : 'http://'
		);
		const url = new URL(httpUrl);
		const token = url.searchParams.get('token');
		const host = url.searchParams.get('host');
		const key = url.searchParams.get('key');

		if (!token) {
			return {
				success: false,
				error: '必须提供 Zabbix API 令牌'
			};
		}

		if (!host) {
			return {
				success: false,
				error: '必须提供 Zabbix 主机'
			};
		}

		if (!key) {
			return {
				success: false,
				error: '必须提供 Zabbix 监控项键'
			};
		}

		/*
		 * These parameters belong to Dockhand's Zabbix URL syntax,
		 * not to the actual Zabbix API URL.
		 */
		url.searchParams.delete('token');
		url.searchParams.delete('host');
		url.searchParams.delete('key');

		/*
		 * Allow shorthand:
		 *
		 * zabbixs://zabbix.example.com?...
		 *
		 * instead of requiring /api_jsonrpc.php explicitly.
		 */
		if (!url.pathname || url.pathname === '/') {
			url.pathname = '/api_jsonrpc.php';
		}

		const event = {
			event_type: payload.eventType ?? null,
			title: payload.title,
			message: payload.message,
			type: payload.type ?? 'info',
			environment: payload.environmentName ?? null,
			timestamp: new Date().toISOString()
		};

		const requestBody = {
			jsonrpc: '2.0',
			method: 'history.push',
			params: [
				{
					host,
					key,
					value: JSON.stringify(event)
				}
			],
			id: 1
		};

		const response = await notificationFetch(url, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json-rpc',
				'Accept': 'application/json'
			},
			body: JSON.stringify(requestBody)
		});

		const responseText = await response.text();

		if (!response.ok) {
			return {
				success: false,
				error: `Zabbix HTTP 错误 ${response.status}: ${
					responseText || response.statusText
				}`
			};
		}

		let result: ZabbixApiResponse;

		try {
			result = JSON.parse(responseText);
		} catch {
			return {
				success: false,
				error: 'Zabbix 返回无效的 JSON 响应'
			};
		}

		if (result.error) {
			const parts = [
				result.error.message,
				result.error.data
			].filter(Boolean);

			return {
				success: false,
				error: `Zabbix API 错误: ${parts.join(' - ')}`
			};
		}

		if (result.result?.response !== 'success') {
			return {
				success: false,
				error: 'Zabbix history.push 未返回成功结果'
			};
		}

		const itemErrors =
			result.result.data
				?.filter(item => item.error)
				.map(item => item.error!) ?? [];

		if (itemErrors.length > 0) {
			return {
				success: false,
				error: `Zabbix history.push 错误: ${itemErrors.join('; ')}`
			};
		}

		return {
			success: true
		};

	} catch (error) {
		return {
			success: false,
			error:
				error instanceof Error
					? `Zabbix 连接失败: ${error.message}`
					: `Zabbix 连接失败: ${String(error)}`
		};
	}
}
