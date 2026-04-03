import { json } from '@sveltejs/kit';
import { getStackEnvVars, setStackEnvVars, getStackSource } from '$lib/server/db';
import { findStackDir } from '$lib/server/stacks';
import { authorize } from '$lib/server/authorize';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { RequestHandler } from './$types';

/**
 * Parse a .env file content into key-value pairs
 */
function parseEnvFile(content: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		// Skip empty lines and comments
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex > 0) {
			const key = trimmed.substring(0, eqIndex).trim();
			let value = trimmed.substring(eqIndex + 1);
			// Remove surrounding quotes if present
			if ((value.startsWith('"') && value.endsWith('"')) ||
			    (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			result[key] = value;
		}
	}
	return result;
}

/**
 * GET /api/stacks/[name]/env?env=X
 * Get all environment variables for a stack.
 * Merges variables from database with .env file (file values override for non-secrets).
 *
 * SECURITY: Secrets are returned as '***' (masked) - they are NEVER sent in plain text.
 * Secrets are stored only in the database and injected via shell environment at runtime.
 * The .env file only contains non-secret variables.
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);
	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : null;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('stacks', 'view', envIdNum ?? undefined)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	// Environment access check (enterprise only)
	if (envIdNum && auth.isEnterprise && !await auth.canAccessEnvironment(envIdNum)) {
		return json({ error: '无权访问该环境' }, { status: 403 });
	}

	try {
		const stackName = decodeURIComponent(params.name);

		// Get secrets from database (masked - values show as '***')
		const dbSecrets = await getStackEnvVars(stackName, envIdNum, true);

		// Check if this stack has a custom compose path configured
		const source = await getStackSource(stackName, envIdNum);

		// Determine the env file path based on path resolution rules:
		// - envPath = '' (empty string) → explicitly no env file
		// - envPath = '/path/.env' → use custom path
		// - envPath = null with composePath → .env next to compose
		// - envPath = null without composePath → use default location
		let envFilePath: string | null = null;

		if (source?.envPath === '') {
			envFilePath = null;
		} else if (source?.envPath) {
			envFilePath = source.envPath;
		} else if (source?.composePath) {
			envFilePath = join(dirname(source.composePath), '.env');
		} else {
			const stackDir = await findStackDir(stackName, envIdNum);
			if (stackDir) {
				envFilePath = join(stackDir, '.env');
			}
		}

		const variables: { key: string; value: string; isSecret: boolean }[] = [];

		if (source?.sourceType === 'git') {
			// Git stacks: ALL vars (overrides + secrets) come from DB
			for (const dbVar of dbSecrets) {
				variables.push({ key: dbVar.key, value: dbVar.value, isSecret: dbVar.isSecret });
			}
		} else {
			// Internal/adopted stacks: non-secrets from file, secrets from DB
			if (envFilePath && existsSync(envFilePath)) {
				try {
					const content = readFileSync(envFilePath, 'utf-8');
					const fileVars = parseEnvFile(content);
					for (const [key, value] of Object.entries(fileVars)) {
						variables.push({ key, value, isSecret: false });
					}
				} catch {
					// Ignore file read errors
				}
			}

			// Secrets come from the database (never written to file)
			for (const secret of dbSecrets) {
				if (secret.isSecret) {
					variables.push({ key: secret.key, value: secret.value, isSecret: true });
				}
			}
		}

		return json({ variables });
	} catch (error) {
		console.error('获取堆栈环境变量时出错：', error);
		return json({ error: '获取环境变量失败' }, { status: 500 });
	}
};

/**
 * PUT /api/stacks/[name]/env?env=X
 * Save secret environment variables for a stack.
 * Body: { variables: [{ key, value, isSecret }] }
 *
 * Only secrets are stored in the database. Non-secret variables live in the
 * .env file (written by PUT /env/raw) and are read directly by Docker Compose.
 *
 * If a secret's value is '***' (masked placeholder), the original value
 * from the database is preserved.
 */
export const PUT: RequestHandler = async ({ params, url, cookies, request }) => {
	const auth = await authorize(cookies);
	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : null;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('stacks', 'edit', envIdNum ?? undefined)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	// Environment access check (enterprise only)
	if (envIdNum && auth.isEnterprise && !await auth.canAccessEnvironment(envIdNum)) {
		return json({ error: '无权访问该环境' }, { status: 403 });
	}

	try {
		const stackName = decodeURIComponent(params.name);
		const body = await request.json();

		if (!body.variables || !Array.isArray(body.variables)) {
			return json({ error: '请求体无效：必须提供变量数组' }, { status: 400 });
		}

		// Validate variables
		for (const v of body.variables) {
			if (!v.key || typeof v.key !== 'string') {
				return json({ error: '无效变量：必须提供键名且必须为字符串' }, { status: 400 });
			}
			if (typeof v.value !== 'string') {
				return json({ error: `无效变量 "${v.key}"：值必须为字符串` }, { status: 400 });
			}
			if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.key)) {
				return json({ error: `无效变量名 "${v.key}"：必须以字母或下划线开头，且仅包含字母、数字和下划线` }, { status: 400 });
			}
		}

		// Preserve masked secret values ('***') from the database
		const secretsWithMaskedValue = body.variables.filter(
			(v: { key: string; value: string; isSecret?: boolean }) =>
				v.isSecret && v.value === '***'
		);

		let variablesToSave = body.variables;

		if (secretsWithMaskedValue.length > 0) {
			const existingVars = await getStackEnvVars(stackName, envIdNum, false);
			const existingByKey = new Map(existingVars.map(v => [v.key, v]));

			variablesToSave = body.variables.map((v: { key: string; value: string; isSecret?: boolean }) => {
				if (v.isSecret && v.value === '***') {
					const existing = existingByKey.get(v.key);
					if (existing && existing.isSecret) {
						return { ...v, value: existing.value };
					}
				}
				return v;
			});
		}

		// Save secrets to database (non-secrets live in the .env file)
		await setStackEnvVars(stackName, envIdNum, variablesToSave);

		return json({ success: true, count: variablesToSave.length });
	} catch (error) {
		console.error('设置堆栈环境变量时出错：', error);
		return json({ error: '设置环境变量失败' }, { status: 500 });
	}
};
