import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getGitRepositories,
	createGitRepository,
	getGitCredentials
} from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import { auditGitRepository } from '$lib/server/audit';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('git', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		// Note: envId parameter is kept for backwards compatibility but repositories
		// are now global (not tied to environments). Use git stacks for env-specific deployments.
		const repositories = await getGitRepositories();
		return json(repositories);
	} catch (error) {
		console.error('获取 Git 仓库列表失败:', error);
		return json({ error: '获取 Git 仓库列表失败' }, { status: 500 });
	}
};

export const POST: RequestHandler = async (event) => {
	const { request, cookies } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('git', 'create')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const data = await request.json();

		if (!data.name || typeof data.name !== 'string') {
			return json({ error: '名称为必填项' }, { status: 400 });
		}

		if (!data.url || typeof data.url !== 'string') {
			return json({ error: '仓库 URL 为必填项' }, { status: 400 });
		}

		// Validate credential if provided
		if (data.credentialId) {
			const credentials = await getGitCredentials();
			const credential = credentials.find(c => c.id === data.credentialId);
			if (!credential) {
				return json({ error: '无效的凭据 ID' }, { status: 400 });
			}
		}

		// Create repository with just the basic fields
		// Deployment-specific config (composePath, autoUpdate, webhook) now belongs to git_stacks
		const repository = await createGitRepository({
			name: data.name,
			url: data.url,
			branch: data.branch || 'main',
			credentialId: data.credentialId || null
		});

		// Audit log
		await auditGitRepository(event, 'create', repository.id, repository.name);

		return json(repository);
	} catch (error: any) {
		console.error('创建 Git 仓库失败:', error);
		if (error.message?.includes('UNIQUE constraint failed')) {
			return json({ error: '同名仓库已存在' }, { status: 400 });
		}
		return json({ error: '创建 Git 仓库失败' }, { status: 500 });
	}
};
