import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitStack, updateGitStack, deleteGitStack, deleteStackSource, updateStackSourceName, updateStackEnvVarsName, setStackEnvVars, getStackEnvVars, deleteStackEnvVars } from '$lib/server/db';
import { deleteGitStackFiles, deployGitStack } from '$lib/server/git';
import { authorize } from '$lib/server/authorize';
import { registerSchedule, unregisterSchedule } from '$lib/server/scheduler';
import { auditGitStack } from '$lib/server/audit';
import { computeAuditDiff } from '$lib/utils/diff';
import { createJobResponse } from '$lib/server/sse';

// Stack name validation: must start with alphanumeric, can contain alphanumeric, hyphens, underscores
const STACK_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const id = parseInt(params.id);
		const gitStack = await getGitStack(id);
		if (!gitStack) {
			return json({ error: 'Git 堆栈不存在' }, { status: 404 });
		}

		// Permission check with environment context
		if (auth.authEnabled && !await auth.can('stacks', 'view', gitStack.environmentId || undefined)) {
			return json({ error: '权限不足' }, { status: 403 });
		}

		return json(gitStack);
	} catch (error) {
		console.error('获取 Git 堆栈失败:', error);
		return json({ error: '获取 Git 堆栈失败' }, { status: 500 });
	}
};

export const PUT: RequestHandler = async (event) => {
	const { params, request, cookies } = event;
	const auth = await authorize(cookies);

	try {
		const id = parseInt(params.id);
		const existing = await getGitStack(id);
		if (!existing) {
			return json({ error: 'Git 堆栈不存在' }, { status: 404 });
		}

		// Permission check with environment context
		if (auth.authEnabled && !await auth.can('stacks', 'edit', existing.environmentId || undefined)) {
			return json({ error: '权限不足' }, { status: 403 });
		}

		const data = await request.json();

		// Validate stack name if it's being changed
		if (data.stackName !== undefined) {
			const trimmedStackName = data.stackName.trim();
			if (!trimmedStackName) {
				return json({ error: '堆栈名称为必填项' }, { status: 400 });
			}
			if (!STACK_NAME_REGEX.test(trimmedStackName)) {
				return json({ error: '堆栈名称必须以字母或数字开头，仅允许包含字母、数字、连字符和下划线' }, { status: 400 });
			}
			data.stackName = trimmedStackName;
		}

		const oldStackName = existing.stackName;
		const updated = await updateGitStack(id, {
			stackName: data.stackName,
			composePath: data.composePath,
			envFilePath: data.envFilePath,
			autoUpdate: data.autoUpdate,
			autoUpdateSchedule: data.autoUpdateSchedule,
			autoUpdateCron: data.autoUpdateCron,
			webhookEnabled: data.webhookEnabled,
			webhookSecret: data.webhookSecret,
			buildOnDeploy: data.buildOnDeploy,
			repullImages: data.repullImages,
			forceRedeploy: data.forceRedeploy
		});

		// If stack name changed, update related records
		if (data.stackName && data.stackName !== oldStackName) {
			await updateStackSourceName(oldStackName, data.stackName, existing.environmentId);
			await updateStackEnvVarsName(oldStackName, data.stackName, existing.environmentId);
		}

		// Register or unregister schedule with croner
		if (updated.autoUpdate && updated.autoUpdateCron) {
			await registerSchedule(id, 'git_stack_sync', updated.environmentId);
		} else {
			unregisterSchedule(id, 'git_stack_sync');
		}

		// Compute diff for audit (exclude sensitive fields)
		const diff = computeAuditDiff(existing, updated, {
			excludeFields: ['webhookSecret', 'createdAt', 'updatedAt', 'lastSync', 'lastCommit', 'syncStatus', 'syncError']
		});

		// Audit log
		await auditGitStack(event, 'update', updated.id, updated.stackName, updated.environmentId, diff);

		// Save environment variable overrides before deploying
		if (data.envVars && Array.isArray(data.envVars)) {
			const stackName = data.stackName || existing.stackName;
			const envId = updated.environmentId ?? null;

			// Get existing secrets to preserve masked values
			const existingVars = await getStackEnvVars(stackName, envId, false); // false = unmasked
			const existingByKey = new Map(existingVars.map(v => [v.key, v]));

			const varsToSave = data.envVars
				.filter((v: any) => v.key?.trim())
				.map((v: any) => {
					// Preserve existing secret value if submitted value is masked
					if (v.isSecret && v.value === '***') {
						const existingVar = existingByKey.get(v.key.trim());
						if (existingVar && existingVar.isSecret) {
							return {
								key: v.key.trim(),
								value: existingVar.value, // Use real value from DB
								isSecret: true
							};
						}
						// No existing secret found - skip this entry (shouldn't happen normally)
						return null;
					}
					return {
						key: v.key.trim(),
						value: v.value ?? '',
						isSecret: v.isSecret ?? false
					};
				})
				.filter(Boolean); // Remove nulls

			await setStackEnvVars(stackName, envId, varsToSave as any);
		}

		// If deployNow is set, deploy after saving via SSE to keep connection alive
		if (data.deployNow) {
			return createJobResponse(async (send) => {
				try {
					const deployResult = await deployGitStack(id);
					await auditGitStack(event, 'deploy', updated.id, updated.stackName, updated.environmentId);
					send('result', {
						...updated,
						deployResult
					});
				} catch (error) {
					console.error('部署 Git 堆栈失败:', error);
					send('result', {
						...updated,
						deployResult: { success: false, error: '部署 Git 堆栈失败' }
					});
				}
			}, request);
		}

		return json(updated);
	} catch (error: any) {
		console.error('更新 Git 堆栈失败:', error);
		if (error.message?.includes('UNIQUE constraint failed')) {
			if (error.message?.includes('stack_environment_variables')) {
				return json({ error: '检测到重复的环境变量键' }, { status: 400 });
			}
			return json({ error: '该环境下已存在同名 Git 堆栈' }, { status: 400 });
		}
		return json({ error: '更新 Git 堆栈失败' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { params, cookies } = event;
	const auth = await authorize(cookies);

	try {
		const id = parseInt(params.id);
		const existing = await getGitStack(id);
		if (!existing) {
			return json({ error: 'Git 堆栈不存在' }, { status: 404 });
		}

		// Permission check with environment context
		if (auth.authEnabled && !await auth.can('stacks', 'remove', existing.environmentId || undefined)) {
			return json({ error: '权限不足' }, { status: 403 });
		}

		// Unregister schedule from croner
		unregisterSchedule(id, 'git_stack_sync');

		// Delete git files first
		await deleteGitStackFiles(id, existing.stackName, existing.environmentId);

		// Delete the stack_sources record to free up the stack name
		await deleteStackSource(existing.stackName, existing.environmentId);

		// Delete all env var overrides for this stack (all environments)
		await deleteStackEnvVars(existing.stackName);

		// Delete from database
		await deleteGitStack(id);

		// Audit log
		await auditGitStack(event, 'delete', id, existing.stackName, existing.environmentId);

		return json({ success: true });
	} catch (error) {
		console.error('删除 Git 堆栈失败:', error);
		return json({ error: '删除 Git 堆栈失败' }, { status: 500 });
	}
};
