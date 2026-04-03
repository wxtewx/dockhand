import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getGitStacks,
	createGitStack,
	getGitCredentials,
	getGitRepository,
	createGitRepository,
	upsertStackSource,
	setStackEnvVars
} from '$lib/server/db';
import { deployGitStack } from '$lib/server/git';
import { authorize } from '$lib/server/authorize';
import { registerSchedule } from '$lib/server/scheduler';
import { secureRandomBytes } from '$lib/server/crypto-fallback';
import { auditGitStack } from '$lib/server/audit';
import { createJobResponse } from '$lib/server/sse';

// Stack name validation: must start with alphanumeric, can contain alphanumeric, hyphens, underscores
const STACK_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('stacks', 'view', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {

		const stacks = await getGitStacks(envIdNum);
		return json(stacks);
	} catch (error) {
		console.error('获取 Git 堆栈列表失败:', error);
		return json({ error: '获取 Git 堆栈列表失败' }, { status: 500 });
	}
};

export const POST: RequestHandler = async (event) => {
	const { request, cookies } = event;
	const auth = await authorize(cookies);

	try {
		const data = await request.json();

		// Permission check with environment context
		if (auth.authEnabled && !await auth.can('stacks', 'create', data.environmentId || undefined)) {
			return json({ error: '权限不足' }, { status: 403 });
		}

		if (!data.stackName || typeof data.stackName !== 'string') {
			return json({ error: '堆栈名称为必填项' }, { status: 400 });
		}

		const trimmedStackName = data.stackName.trim();
		if (!STACK_NAME_REGEX.test(trimmedStackName)) {
			return json({ error: '堆栈名称必须以字母或数字开头，仅允许包含字母、数字、连字符和下划线' }, { status: 400 });
		}

		// Either repositoryId or new repo details (url, branch) must be provided
		let repositoryId = data.repositoryId;

		if (!repositoryId) {
			// Create a new repository if URL is provided
			if (!data.url || typeof data.url !== 'string') {
				return json({ error: '必须提供仓库 URL 或现有仓库 ID' }, { status: 400 });
			}

			// Validate credential if provided
			if (data.credentialId) {
				const credentials = await getGitCredentials();
				const credential = credentials.find(c => c.id === data.credentialId);
				if (!credential) {
					return json({ error: '无效的凭据 ID' }, { status: 400 });
				}
			}

			// Create the repository first
			const repoName = data.repoName || data.stackName;
			try {
				const repo = await createGitRepository({
					name: repoName,
					url: data.url,
					branch: data.branch || 'main',
					credentialId: data.credentialId || null
				});
				repositoryId = repo.id;
			} catch (error: any) {
				if (error.message?.includes('UNIQUE constraint failed')) {
					return json({ error: '同名仓库已存在' }, { status: 400 });
				}
				throw error;
			}
		} else {
			// Verify repository exists
			const repo = await getGitRepository(repositoryId);
			if (!repo) {
				return json({ error: '仓库不存在' }, { status: 400 });
			}
		}

		// Generate webhook secret if webhook is enabled
		let webhookSecret = data.webhookSecret;
		if (data.webhookEnabled && !webhookSecret) {
			webhookSecret = secureRandomBytes(32).toString('hex');
		}

		const gitStack = await createGitStack({
			stackName: trimmedStackName,
			environmentId: data.environmentId || null,
			repositoryId: repositoryId,
			composePath: data.composePath || 'compose.yaml',
			envFilePath: data.envFilePath || null,
			autoUpdate: data.autoUpdate || false,
			autoUpdateSchedule: data.autoUpdateSchedule || 'daily',
			autoUpdateCron: data.autoUpdateCron || '0 3 * * *',
			webhookEnabled: data.webhookEnabled || false,
			webhookSecret: webhookSecret
		});

		// Create stack_sources entry so the stack appears in the list immediately
		await upsertStackSource({
			stackName: trimmedStackName,
			environmentId: data.environmentId || null,
			sourceType: 'git',
			gitRepositoryId: repositoryId,
			gitStackId: gitStack.id
		});

		// Register schedule with croner if auto-update is enabled
		if (gitStack.autoUpdate && gitStack.autoUpdateCron) {
			await registerSchedule(gitStack.id, 'git_stack_sync', gitStack.environmentId);
		}

		// Audit log
		await auditGitStack(event, 'create', gitStack.id, gitStack.stackName, gitStack.environmentId);

		// Save environment variable overrides before deploying
		if (data.envVars && Array.isArray(data.envVars) && data.envVars.length > 0) {
			// Filter out masked secrets - on initial creation there are no existing secrets
			// If a secret has value '***', it means something went wrong in the UI
			const varsToSave = data.envVars
				.filter((v: any) => v.key?.trim())
				.filter((v: any) => !(v.isSecret && v.value === '***'))
				.map((v: any) => ({
					key: v.key.trim(),
					value: v.value ?? '',
					isSecret: v.isSecret ?? false
				}));

			if (varsToSave.length > 0) {
				await setStackEnvVars(trimmedStackName, data.environmentId || null, varsToSave);
			}
		}

		// If deployNow is set, deploy immediately via SSE to keep connection alive
		if (data.deployNow) {
			return createJobResponse(async (send) => {
				try {
					const deployResult = await deployGitStack(gitStack.id);
					await auditGitStack(event, 'deploy', gitStack.id, gitStack.stackName, gitStack.environmentId);
					send('result', {
						...gitStack,
						deployResult: deployResult
					});
				} catch (error) {
					console.error('部署 Git 堆栈失败:', error);
					send('result', {
						...gitStack,
						deployResult: { success: false, error: '部署 Git 堆栈失败' }
					});
				}
			}, request);
		}

		return json(gitStack);
	} catch (error: any) {
		console.error('创建 Git 堆栈失败:', error);
		if (error.message?.includes('UNIQUE constraint failed')) {
			if (error.message?.includes('stack_environment_variables')) {
				return json({ error: '检测到重复的环境变量键' }, { status: 400 });
			}
			return json({ error: '该环境下已存在同名 Git 堆栈' }, { status: 400 });
		}
		return json({ error: '创建 Git 堆栈失败' }, { status: 500 });
	}
};
