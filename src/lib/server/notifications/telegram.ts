/** Telegram bot. tgram://bot_token/chat_id[:topic_id]. */
import { escapeTelegramMarkdown, parseTelegramUrl } from '$lib/utils/notification-parsers';
import { drainResponse, type NotificationPayload, type NotificationResult } from './shared';

export async function sendTelegram(appriseUrl: string, payload: NotificationPayload): Promise<NotificationResult> {
	const parsed = parseTelegramUrl(appriseUrl);
	if (!parsed) {
		return { success: false, error: '无效的 Telegram 地址格式，标准格式: tgram://bot_token/chat_id or tgram://bot_token/chat_id:topic_id' };
	}

	const { botToken, chatId, topicId } = parsed;
	const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

	const escapedTitle = escapeTelegramMarkdown(payload.title);
	const escapedMessage = escapeTelegramMarkdown(payload.message);
	const envTag = payload.environmentName ? ` [${escapeTelegramMarkdown(payload.environmentName)}]` : '';

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text: `*${escapedTitle}*${envTag}\n${escapedMessage}`,
				...(topicId ? { message_thread_id: topicId } : {}),
				parse_mode: 'Markdown',
				link_preview_options: {
					is_disabled: true
				}
			})
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({})) as { description?: string };
			const errorMsg = errorData.description || response.statusText;
			return { success: false, error: `Telegram 请求异常 ${response.status}: ${errorMsg}` };
		}
		await drainResponse(response);
		return { success: true };
	} catch (error) {
		return { success: false, error: `Telegram 连接失败: ${error instanceof Error ? error.message : String(error)}` };
	}
}
