/** Microsoft Power Automate Workflows (e.g. Microsoft Teams). workflows://. */
import { parseWorkflowsUrl, buildWorkflowsHttpUrl } from '$lib/utils/notification-parsers';
import { drainResponse, type NotificationPayload, type NotificationResult } from './shared';

export async function sendWorkflows(appriseUrl: string, payload: NotificationPayload): Promise<NotificationResult> {
	const parsed = parseWorkflowsUrl(appriseUrl);
	if (!parsed) {
		return { success: false, error: '无效的 Workflows 地址格式，标准格式: workflows://hostname/workflow/signature' };
	}

	const url = buildWorkflowsHttpUrl(parsed.hostname, parsed.workflow, parsed.signature);
	const titleWithEnv = payload.environmentName ? `${payload.title} [${payload.environmentName}]` : payload.title;

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				type: 'message',
				attachments: [
					{
						contentType: 'application/vnd.microsoft.card.adaptive',
						content: {
							$schema: 'https://adaptivecards.io/schemas/adaptive-card.json',
							type: 'AdaptiveCard',
							version: '1.2',
							body: [
								{
									type: 'TextBlock',
									style: 'heading',
									wrap: true,
									text: titleWithEnv
								},
								{
									type: 'TextBlock',
									style: 'default',
									wrap: true,
									text: payload.message
								}
							]
						}
					}
				]
			})
		});

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			return { success: false, error: `Workflows 请求异常 ${response.status}: ${text || response.statusText}` };
		}
		await drainResponse(response);
		return { success: true };
	} catch (error) {
		return { success: false, error: `Workflows 连接失败: ${error instanceof Error ? error.message : String(error)}` };
	}
}
