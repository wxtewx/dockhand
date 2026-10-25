/**
 * Mail one environment's state report on a schedule.
 *
 * The report leaves the installation on a timer with nobody watching, so it goes to an SMTP
 * channel chosen by an administrator and nowhere else. A webhook channel has no way to carry
 * the file, which is why the configuration only offers SMTP.
 */

import {
	getEnvironment,
	getNotificationSetting,
	getEnvReportSettings,
	createScheduleExecution,
	updateScheduleExecution,
	appendScheduleExecutionLog
} from '../../db';
import { getLicenseType } from '../../license';
import { buildReport, reportToCSV, includeChanges, reportFilename, reportTier } from '../../environment-report-core';
import { collectEnvironment } from '../../environment-report';
import { sendSmtpNotification } from '../../notifications/smtp';
import { redactUrlCredentials } from '$lib/utils/rest-repository';

export async function runEnvReport(
	environmentId: number,
	triggeredBy: 'manual' | 'cron' = 'cron'
): Promise<void> {
	const startTime = Date.now();
	const env = await getEnvironment(environmentId);
	if (!env) {
		console.error(`[环境报告] 环境 ${environmentId} 未找到`);
		return;
	}

	const config = await getEnvReportSettings(environmentId);
	if (!config || !config.enabled) {
		console.log(`[环境报告] 环境 ${environmentId} 的报告功能已关闭`);
		return;
	}

	const execution = await createScheduleExecution({
		scheduleType: 'env_report',
		scheduleId: environmentId,
		environmentId,
		entityName: `报告: ${env.name}`,
		triggeredBy,
		status: 'running'
	});
	await updateScheduleExecution(execution.id, { startedAt: new Date().toISOString() });

	const log = async (message: string) => {
		console.log(`[环境报告] ${message}`);
		await appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${message}`);
	};

	const fail = async (message: string) => {
		await log(message);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: message
		});
	};

	try {
		await log(`正在为 ${env.name} 生成 ${config.format.toUpperCase()} 格式报告`);

		// The licence is the installation's, so the scheduler can answer for it without a
		// user. Only an administrator can configure this, and an administrator may read the
		// audit log, so the tier alone decides whether the change history rides along.
		const tier = reportTier(await getLicenseType());
		if (!tier) {
			await fail('发送状态报告需要商业许可证');
			return;
		}

		if (config.notificationId == null) {
			await fail('此报告未配置通知通道');
			return;
		}
		const channel = await getNotificationSetting(config.notificationId);
		if (!channel) {
			await fail(`通知通道 ${config.notificationId} 已不存在`);
			return;
		}
		if (channel.type !== 'smtp') {
			await fail(`已配置通道类型为 ${channel.type}，该类型不支持携带附件`);
			return;
		}
		if (!channel.enabled) {
			await fail('已配置的通知通道已被禁用');
			return;
		}

		const withChanges = includeChanges(tier);
		const generatedAt = new Date().toISOString();
		const report = buildReport([await collectEnvironment(env.id, env.name, withChanges)], withChanges, {
			generatedAt,
			appVersion: typeof __APP_VERSION__ !== 'undefined' ? (__APP_VERSION__ ?? 'unknown') : 'unknown'
		});

		let filename: string;
		let content: Buffer;
		let contentType: string;
		if (config.format === 'pdf') {
			const { buildReportPdf, reportPdfFilename, readReportLogo } = await import(
				'../../environment-report-pdf'
			);
			content = await buildReportPdf(report, await readReportLogo());
			filename = reportPdfFilename(report, env.name);
			contentType = 'application/pdf';
		} else {
			content = Buffer.from(reportToCSV(report), 'utf8');
			filename = reportFilename(env.name, generatedAt, 'csv');
			contentType = 'text/csv; charset=utf-8';
		}

		const t = report.totals;
		const summary = [
			`${t.containers} 个容器，隶属于 ${t.stacks} 个堆栈`,
			`${t.scannedImages} 个已扫描镜像`,
			t.critical > 0 || t.high > 0
				? `发现 ${t.critical} 个严重漏洞和 ${t.high} 个高危漏洞`
				: '未发现严重或高危漏洞'
		].join(', ');

		const result = await sendSmtpNotification(channel.config as never, {
			// The environment belongs in the subject: these arrive on a timer, and the reader
			// has to tell one from another without opening the attachment.
			title: `状态报告: ${env.name}`,
			message: `${summary}.\n\n生成时间 ${generatedAt.replace('T', ' ').slice(0, 16)} UTC。完整报告已作为附件 ${filename} 附上。`,
			type: t.critical > 0 ? 'warning' : 'info',
			environmentId: env.id,
			environmentName: env.name,
			attachments: [{ filename, content, contentType }]
		});

		if (!result.success) {
			// The transport's own message names the mail host and port, which is more than
			// `schedules:view` should reveal. The detail goes to the server log; the row
			// records only that delivery failed.
			console.error(`[环境报告] SMTP 投递失败: ${result.error || '未知错误'}`);
			await fail('无法发送报告：邮件服务器拒绝或拒收该消息');
			return;
		}

		await log(`已发送 ${config.format.toUpperCase()} 报告 (${Math.round(content.length / 1024)} KB)`);
		await updateScheduleExecution(execution.id, {
			status: 'success',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			// Execution rows are read under `schedules:view`, which is weaker than the licence
			// plus `environments:view` the report itself requires. So the row records that a
			// report was sent, never what was in it.
			details: {
				format: config.format,
				bytes: content.length,
				includesChanges: withChanges
			}
		});
	} catch (error) {
		// The reason is needed to diagnose a failed run, but it can carry a URL with
		// credentials in it, and the row is readable under `schedules:view`.
		const message = error instanceof Error ? error.message : String(error);
		await fail(`报告生成失败: ${redactUrlCredentials(message)}`);
	}
}
