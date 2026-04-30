import { authorize, enterpriseRequired } from '$lib/server/authorize';
import { getAuditLogs, type AuditLogFilters, type AuditEntityType, type AuditAction, type AuditLog } from '$lib/server/db';
import type { RequestHandler } from './$types';
import { getLabelText } from '$lib/types';

let REQUEST_TIMEZONE = 'UTC';

function formatTimestamp(ts: string): string {
  const date = new Date(ts);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REQUEST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);

  const values = parts.reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {} as Record<string, string>);

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function escapeCSV(value: string | null | undefined): string {
	if (value === null || value === undefined) return '';
	const str = String(value);
	if (str.includes(',') || str.includes('"') || str.includes('\n')) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

function formatToJSON(logs: AuditLog[]): string {
	return JSON.stringify(logs, null, 2);
}

function formatToCSV(logs: AuditLog[]): string {
	const headers = [
		'ID',
		'时间戳',
		'用户名',
		'操作',
		'实体类型',
		'实体 ID',
		'实体名称',
		'环境 ID',
		'描述',
		'IP 地址',
		'用户代理',
		'详情'
	];

	const rows = logs.map((log) => [
		log.id,
		formatTimestamp(log.createdAt),
		escapeCSV(log.username),
		escapeCSV(getLabelText(log.action)),
		escapeCSV(getLabelText(log.entityType)),
		escapeCSV(log.entityId),
		escapeCSV(log.entityName),
		log.environmentId ?? '',
		escapeCSV(getLabelText(log.description)),
		escapeCSV(log.ipAddress),
		escapeCSV(log.userAgent),
		escapeCSV(log.details ? JSON.stringify(log.details) : '')
	]);

	return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function formatToMarkdown(logs: AuditLog[]): string {
	const lines: string[] = [];

	lines.push('# 审计日志导出');
	lines.push('');
	lines.push(`生成时间: ${formatTimestamp(new Date().toISOString())}`);
	lines.push('');
	lines.push(`总条目数: ${logs.length}`);
	lines.push('');
	lines.push('---');
	lines.push('');

	for (const log of logs) {
		lines.push(`## ${getLabelText(log.action)} - ${getLabelText(log.entityType)}`);
		lines.push('');
		lines.push(`| 字段 | 值 |`);
		lines.push(`|-------|-------|`);
		lines.push(`| 时间戳 | ${formatTimestamp(log.createdAt)} |`);
		lines.push(`| 用户 | ${log.username} |`);
		lines.push(`| 操作 | ${getLabelText(log.action)} |`);
		lines.push(`| 实体类型 | ${getLabelText(log.entityType)} |`);
		if (log.entityName) lines.push(`| 实体名称 | ${log.entityName} |`);
		if (log.entityId) lines.push(`| 实体 ID | \`${log.entityId}\` |`);
		if (log.environmentId) lines.push(`| 环境 ID | ${log.environmentId} |`);
		if (log.description) lines.push(`| 描述 | ${getLabelText(log.description)} |`);
		if (log.ipAddress) lines.push(`| IP 地址 | ${log.ipAddress} |`);

		if (log.details) {
			lines.push('');
			lines.push('**详情:**');
			lines.push('```json');
			lines.push(JSON.stringify(log.details, null, 2));
			lines.push('```');
		}

		lines.push('');
		lines.push('---');
		lines.push('');
	}

	return lines.join('\n');
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	// Audit log is Enterprise-only
	if (!auth.isEnterprise) {
		return new Response(JSON.stringify(enterpriseRequired()), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Check permission
	if (!await auth.canViewAuditLog()) {
		return new Response(JSON.stringify({ error: '权限不足' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		// Parse query parameters
		const filters: AuditLogFilters = {};

		REQUEST_TIMEZONE = url.searchParams.get('timeZone') || 'UTC';

		const username = url.searchParams.get('username');
		if (username) filters.username = username;

		const entityType = url.searchParams.get('entityType');
		if (entityType) filters.entityType = entityType as AuditEntityType;

		const action = url.searchParams.get('action');
		if (action) filters.action = action as AuditAction;

		const envId = url.searchParams.get('environmentId');
		if (envId) filters.environmentId = parseInt(envId);

		const fromDate = url.searchParams.get('fromDate');
		if (fromDate) filters.fromDate = fromDate;

		const toDate = url.searchParams.get('toDate');
		if (toDate) filters.toDate = toDate;

		// For export, get all matching records (no pagination)
		filters.limit = 10000; // Reasonable max limit

		const result = await getAuditLogs(filters);
		const logs = result.logs;

		const format = url.searchParams.get('format') || 'json';
		const timestamp = new Date().toISOString().split('T')[0];

		let content: string;
		let contentType: string;
		let filename: string;

		switch (format) {
			case 'csv':
				content = formatToCSV(logs);
				contentType = 'text/csv';
				filename = `audit-log-${timestamp}.csv`;
				break;
			case 'md':
				content = formatToMarkdown(logs);
				contentType = 'text/markdown';
				filename = `audit-log-${timestamp}.md`;
				break;
			case 'json':
			default:
				content = formatToJSON(logs);
				contentType = 'application/json';
				filename = `audit-log-${timestamp}.json`;
				break;
		}

		if (format === 'csv') {
			const bom = '\ufeff';
			content = bom + content;
		}

		return new Response(content, {
			status: 200,
			headers: {
				'Content-Type': contentType,
				'Content-Disposition': `attachment; filename="${filename}"`
			}
		});
	} catch (error) {
		console.error('导出审计日志失败:', error);
		return new Response(JSON.stringify({ error: '导出审计日志失败' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
