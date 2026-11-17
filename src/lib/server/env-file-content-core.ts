// Deploy-time .env reader. Kept free of server imports so its logging can be unit-tested.
import { expandValue } from '../utils/env-file-values';

/**
 * Redact all env var values for safe logging. Only key names are preserved.
 */
export function redactEnvVarsForLog(vars: Record<string, string>): Record<string, string> {
	const redacted: Record<string, string> = {};
	for (const key of Object.keys(vars)) {
		redacted[key] = '***';
	}
	return redacted;
}

/**
 * Parse a .env file content into key-value pairs.
 * Handles comments, empty lines, and quoted values.
 */
export function parseEnvFileContent(
	content: string,
	stackName?: string,
	options?: { expand?: boolean }
): Record<string, string> {
	// Expanding is for a DEPLOY, which needs the values a service will see. A caller
	// showing the file to somebody wants their own text back, references and all -
	// resolving it there would turn ${DIRECTORY} into a path in front of them, and an
	// edit saved from that view would flatten the variable for good.
	const expand = options?.expand !== false;
	const logPrefix = stackName ? `[堆栈:${stackName}]` : '[Git]';
	const result: Record<string, string> = {};
	const skippedLines: string[] = [];
	const invalidKeys: string[] = [];

	console.log(`${logPrefix} ----------------------------------------`);
	console.log(`${logPrefix} 解析环境文件内容`);
	console.log(`${logPrefix} ----------------------------------------`);
	// Never log the file itself or any part of a line: .env files hold secrets, and a
	// continuation line of a multi-line value parses as an invalid "key". Only lengths,
	// line numbers, valid keys and the masked values below go to the log.
	console.log(`${logPrefix} 原始内容长度:`, content.length, '字符');

	const lines = content.split('\n');
	console.log(`${logPrefix} 总行数:`, lines.length);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		// Skip empty lines and comments
		if (!trimmed || trimmed.startsWith('#')) {
			if (trimmed) skippedLines.push(`第 ${i + 1} 行 (注释)`);
			continue;
		}

		// Find the first = sign
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) {
			skippedLines.push(`第 ${i + 1} 行 (无 =)`);
			continue;
		}

		const key = trimmed.substring(0, eqIndex).trim();
		const value = trimmed.substring(eqIndex + 1).trim();

		// Only add if key is valid env var name
		if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
			// Quotes are the file's syntax, and a value may refer to an earlier line -
			// both of which compose resolves before a service ever sees the value.
			result[key] = expand ? expandValue(value, result) : value;
		} else {
			invalidKeys.push(`第 ${i + 1} 行 (键格式无效)`);
		}
	}

	console.log(`${logPrefix} 解析到环境变量数量:`, Object.keys(result).length);
	console.log(`${logPrefix} 解析到的环境变量键名:`, Object.keys(result).join(', '));
	console.log(`${logPrefix} 解析到的环境变量 (已脱敏):`, JSON.stringify(redactEnvVarsForLog(result), null, 2));
	if (skippedLines.length > 0) {
		console.log(`${logPrefix} 已跳过的行 (${skippedLines.length}):`, skippedLines.slice(0, 10).join('; '));
	}
	if (invalidKeys.length > 0) {
		console.log(`${logPrefix} 无效键名 (${invalidKeys.length}):`, invalidKeys.join('; '));
	}

	return result;
}
