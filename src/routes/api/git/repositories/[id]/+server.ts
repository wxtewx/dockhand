import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getGitRepository,
	updateGitRepository,
	deleteGitRepository,
	getGitCredentials,
	getGitStacksByRepositoryId
} from '$lib/server/db';
import { deleteRepositoryFiles, deleteGitStackFiles } from '$lib/server/git';
import { authorize } from '$lib/server/authorize';
import { auditGitRepository } from '$lib/server/audit';
import { computeAuditDiff } from '$lib/utils/diff';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('git', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的仓库 ID' }, { status: 400 });
		}

		const repository = await getGitRepository(id);
		if (!repository) {
			return json({ error: '仓库不存在' }, { status: 404 });
		}

		return json(repository);
	} catch (error) {
		console.error('获取 Git 仓库失败:', error);
		return json({ error: '获取 Git 仓库失败' }, { status: 500 });
	}
};

export const PUT: RequestHandler = async (event) => {
	const { params, request, cookies } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('git', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的仓库 ID' }, { status: 400 });
		}

		const existing = await getGitRepository(id);
		if (!existing) {
			return json({ error: '仓库不存在' }, { status: 404 });
		}

		const data = await request.json();

		// Validate credential if provided
		if (data.credentialId) {
			const credentials = await getGitCredentials();
			const credential = credentials.find(c => c.id === data.credentialId);
			if (!credential) {
				return json({ error: '无效的凭据 ID' }, { status: 400 });
			}
		}

		// Update only the basic repository fields
		// Deployment-specific config (composePath, autoUpdate, webhook) now belongs to git_stacks
		const repository = await updateGitRepository(id, {
			name: data.name,
			url: data.url,
			branch: data.branch,
			credentialId: data.credentialId
		});

		if (!repository) {
			return json({ error: '更新仓库失败' }, { status: 500 });
		}

		// Compute diff for audit
		const diff = computeAuditDiff(existing, repository);

		// Audit log
		await auditGitRepository(event, 'update', repository.id, repository.name, diff);

		return json(repository);
	} catch (error: any) {
		console.error('更新 Git 仓库失败:', error);
		if (error.message?.includes('UNIQUE constraint failed')) {
			return json({ error: '同名仓库已存在' }, { status: 400 });
		}
		return json({ error: '更新 Git 仓库失败' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { params, cookies } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('git', 'delete')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的仓库 ID' }, { status: 400 });
		}

		// Get repository name before deletion for audit log
		const repository = await getGitRepository(id);
		if (!repository) {
			return json({ error: '仓库不存在' }, { status: 404 });
		}

		// Delete git stack clone directories before cascade deletes the DB rows
		const stacks = await getGitStacksByRepositoryId(id);
		for (const stack of stacks) {
			await deleteGitStackFiles(stack.id, stack.stackName, stack.environmentId);
		}

		// Delete repository clone directory
		deleteRepositoryFiles(id);

		const deleted = await deleteGitRepository(id);
		if (!deleted) {
			return json({ error: '删除仓库失败' }, { status: 500 });
		}

		// Audit log
		await auditGitRepository(event, 'delete', id, repository.name);

		return json({ success: true });
	} catch (error) {
		console.error('删除 Git 仓库失败:', error);
		return json({ error: '删除 Git 仓库失败' }, { status: 500 });
	}
};
