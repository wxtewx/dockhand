import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import {
	createGitRepository,
	createGitStack,
	getGitCredentials,
	getGitRepository,
	getStackEnvVars,
	getStackSource,
	secretProviderExists,
	setStackEnvVars,
	upsertStackSource
} from '$lib/server/db';
import { registerSchedule } from '$lib/server/scheduler';
import { auditGitStack, auditStack } from '$lib/server/audit';
import { createJobResponse } from '$lib/server/sse';
import { deployGitStack } from '$lib/server/git';
import { getStackComposeFile } from '$lib/server/stacks';
import { parseEnvVars } from '$lib/server/env-parser';
import { buildAttachEnvVars } from '$lib/server/stack-attach-core';
import { isValidStackName } from '$lib/server/stack-name-guard';
import { allowSecretlessWebhook, webhookConfigRequiresSecret } from '$lib/server/webhook-secret-policy';
import { existsSync, readFileSync } from 'node:fs';

/**
 * @openapi
 * summary: Convert an internal stack to Git management
 * path: name:string! Stack name (from GET /api/stacks)
 * query: env:integer Environment ID the stack belongs to (from GET /api/environments)
 * body: {stackName:string,repositoryId:integer,url:string,repoName:string,branch:string,credentialId:integer,composePath:string,envFilePath:string,autoUpdate:boolean,autoUpdateSchedule:string,autoUpdateCron:string,webhookEnabled:boolean,webhookSecret:string,contextDir:string,buildOnDeploy:boolean,noBuildCache:boolean,repullImages:boolean,forceRedeploy:boolean,secretProviderId:integer,envVars:array<{key:string!,value:string,isSecret:boolean}>,deployNow:boolean}
 * resp-200: Git stack created; returns the git stack record, or a job response when deployNow starts deployment
 * resp-400: Invalid conversion request or repository configuration
 * resp-403: Caller lacks stacks:edit or required secrets:view permission, or access denied to this environment (enterprise)
 * resp-404: Stack not found
 * resp-500: Failed to convert stack to Git management
 */
export const POST: RequestHandler = async (event) => {
	const { params, request, url, cookies } = event;
	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId, 10) : undefined;
	const stackName = decodeURIComponent(params.name);

	try {
		if (auth.authEnabled && !(await auth.can('stacks', 'edit', envIdNum))) {
			return json({ error: '权限不足' }, { status: 403 });
		}

		// Environment access check (enterprise only), matching the sibling stack endpoints.
		if (envIdNum && auth.isEnterprise && !(await auth.canAccessEnvironment(envIdNum))) {
			return json({ error: '无权访问此环境' }, { status: 403 });
		}

		const source = await getStackSource(stackName, envIdNum);
		if (!source) {
			return json({ error: '未找到堆栈' }, { status: 404 });
		}

		if (source.sourceType !== 'internal') {
			return json({ error: '仅本地堆栈可转换为 Git 管理' }, { status: 400 });
		}

		const data = await request.json();

		if (
			'secretProviderId' in data &&
			data.secretProviderId !== null &&
			typeof data.secretProviderId !== 'number'
		) {
			return json({ error: 'secretProviderId 必须为数字或 null' }, { status: 400 });
		}

		const existingProviderId = source.secretProviderId ?? null;
		const providerChanged =
			'secretProviderId' in data && data.secretProviderId !== existingProviderId;

		if (
			providerChanged &&
			typeof data.secretProviderId === 'number' &&
			auth.authEnabled &&
			!(await auth.can('secrets', 'view', envIdNum))
		) {
			return json({ error: '权限不足: 绑定密钥提供程序需要 secrets 权限' }, { status: 403 });
		}

		if (typeof data.secretProviderId === 'number' && !(await secretProviderExists(data.secretProviderId))) {
			return json({ error: '所选密钥提供程序已不存在。请重新打开堆栈并选择一个当前可用的提供程序。' }, { status: 400 });
		}

		if (data.stackName && data.stackName.trim() !== stackName) {
			return json({ error: '转换过程中不可修改堆栈名称' }, { status: 400 });
		}

		if (!isValidStackName(stackName)) {
			return json({ error: '无效的堆栈名称' }, { status: 400 });
		}

		if (webhookConfigRequiresSecret(!!data.webhookEnabled, !!data.webhookSecret?.trim(), allowSecretlessWebhook())) {
			return json({ error: '启用 Webhook 时必须填写 Webhook 密钥' }, { status: 400 });
		}

		let repositoryId = data.repositoryId;

		if (!repositoryId) {
			if (!data.url || typeof data.url !== 'string') {
				return json({ error: '仓库 URL 或已有仓库 ID 为必填项' }, { status: 400 });
			}

			if (data.credentialId) {
				const credentials = await getGitCredentials();
				const credential = credentials.find((c) => c.id === data.credentialId);
				if (!credential) {
					return json({ error: '无效的凭证 ID' }, { status: 400 });
				}
			}

			try {
				const repo = await createGitRepository({
					name: data.repoName || stackName,
					url: data.url,
					branch: data.branch || 'main',
					credentialId: data.credentialId || null
				});
				repositoryId = repo.id;
			} catch (error: any) {
				if (error.message?.includes('UNIQUE constraint failed')) {
					return json({ error: '已存在同名仓库' }, { status: 400 });
				}
				throw error;
			}
		} else {
			const repo = await getGitRepository(repositoryId);
			if (!repo) {
				return json({ error: '未找到仓库' }, { status: 400 });
			}
		}

		const gitStack = await createGitStack({
			stackName,
			environmentId: envIdNum ?? null,
			repositoryId,
			...(data.repositoryId && typeof data.branch === 'string' && data.branch.trim()
				? { branch: data.branch.trim() }
				: {}),
			composePath: data.composePath || 'compose.yaml',
			envFilePath: data.envFilePath || null,
			autoUpdate: data.autoUpdate || false,
			autoUpdateSchedule: data.autoUpdateSchedule || 'daily',
			autoUpdateCron: data.autoUpdateCron || '0 3 * * *',
			webhookEnabled: data.webhookEnabled || false,
			webhookSecret: data.webhookSecret || null,
			contextDir: data.contextDir || null,
			buildOnDeploy: data.buildOnDeploy ?? false,
			noBuildCache: data.noBuildCache ?? false,
			repullImages: data.repullImages ?? false,
			forceRedeploy: data.forceRedeploy ?? false
		});

		await upsertStackSource({
			stackName,
			environmentId: envIdNum ?? null,
			sourceType: 'git',
			gitRepositoryId: repositoryId,
			gitStackId: gitStack.id,
			composePath: source.composePath ?? null,
			envPath: source.envPath ?? null,
			...(providerChanged ? { secretProviderId: data.secretProviderId ?? null } : {})
		});

		if (gitStack.autoUpdate && gitStack.autoUpdateCron) {
			await registerSchedule(gitStack.id, 'git_stack_sync', gitStack.environmentId);
		}

		// reload env file on disk right before converting to avoid edge case where the file is modified on disk before the conversion happens.
		// this only loads new variables, it does not overwrite them. the user using the interface should be the authoritative source of truth for
		// the actual value
		const composeResult = await getStackComposeFile(stackName, envIdNum ?? null);
		const envFilePath = source.envPath === ''
			? null
			: source.envPath ?? composeResult.envPath ?? composeResult.suggestedEnvPath ?? null;
		const fileVars = envFilePath && existsSync(envFilePath)
			? parseEnvVars(readFileSync(envFilePath, 'utf-8'))
			: null;
		const dbVars = Array.isArray(data.envVars) ? data.envVars : null;

		if (fileVars || dbVars) {
			const existingVars = await getStackEnvVars(stackName, envIdNum ?? null, false);
			const varsToSave = buildAttachEnvVars(fileVars, dbVars, existingVars);
			await setStackEnvVars(stackName, envIdNum ?? null, varsToSave);
		}

		await auditStack(event, 'update', stackName, envIdNum ?? null, {
			action: 'convert_to_git'
		});
		await auditGitStack(event, 'create', gitStack.id, gitStack.stackName, gitStack.environmentId, {
			action: 'convert_from_internal'
		});

		// The webhook secret must not travel back in any response; expose only the flag.
		const { webhookSecret: _newSecret, ...safeGitStackRest } = gitStack;
		const safeGitStack = { ...safeGitStackRest, hasWebhookSecret: !!_newSecret };

		if (data.deployNow) {
			return createJobResponse(async (send) => {
				try {
					const deployResult = await deployGitStack(gitStack.id, {
						triggeredBy: 'manual',
						userId: auth.user?.id,
						onLine: (line) => send('progress', { type: 'line', line })
					});
					await auditGitStack(event, 'deploy', gitStack.id, gitStack.stackName, gitStack.environmentId);
					send('result', {
						...safeGitStack,
						deployResult
					});
				} catch (error) {
					console.error('Git 堆栈部署失败:', error);
					send('result', {
						...safeGitStack,
						deployResult: { success: false, error: 'Git 堆栈部署失败' }
					});
				}
			}, request);
		}

		return json(safeGitStack);
	} catch (error: any) {
		console.error('将本地堆栈转换为 Git 管理失败:', error);
		if (error.message?.includes('UNIQUE constraint failed')) {
			if (error.message?.includes('stack_environment_variables')) {
				return json({ error: '检测到重复的环境变量键' }, { status: 400 });
			}
			return json({ error: '该环境下已存在同名 Git 堆栈' }, { status: 400 });
		}
		return json({ error: '将堆栈转换为 Git 管理失败' }, { status: 500 });
	}
};
