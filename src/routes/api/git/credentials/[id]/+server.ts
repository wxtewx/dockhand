import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getGitCredential,
	updateGitCredential,
	deleteGitCredential,
	type GitAuthType
} from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import { auditGitCredential } from '$lib/server/audit';
import { computeAuditDiff } from '$lib/utils/diff';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('git', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的凭据 ID' }, { status: 400 });
		}

		const credential = await getGitCredential(id);
		if (!credential) {
			return json({ error: '凭据不存在' }, { status: 404 });
		}

		// Don't expose sensitive data
		return json({
			id: credential.id,
			name: credential.name,
			authType: credential.authType,
			username: credential.username,
			hasPassword: !!credential.password,
			hasSshKey: !!credential.sshPrivateKey,
			createdAt: credential.createdAt,
			updatedAt: credential.updatedAt
		});
	} catch (error) {
		console.error('获取 Git 凭据失败:', error);
		return json({ error: '获取 Git 凭据失败' }, { status: 500 });
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
			return json({ error: '无效的凭据 ID' }, { status: 400 });
		}

		const existing = await getGitCredential(id);
		if (!existing) {
			return json({ error: '凭据不存在' }, { status: 404 });
		}

		const data = await request.json();

		if (data.authType && !['none', 'password', 'ssh'].includes(data.authType)) {
			return json({ error: '无效的认证类型' }, { status: 400 });
		}

		const credential = await updateGitCredential(id, {
			name: data.name,
			authType: data.authType as GitAuthType,
			username: data.username,
			password: data.password,
			sshPrivateKey: data.sshPrivateKey,
			sshPassphrase: data.sshPassphrase
		});

		if (!credential) {
			return json({ error: '更新凭据失败' }, { status: 500 });
		}

		// Compute diff for audit (only non-sensitive fields)
		const diff = computeAuditDiff(
			{ name: existing.name, authType: existing.authType, username: existing.username },
			{ name: credential.name, authType: credential.authType, username: credential.username }
		);

		// Audit log
		await auditGitCredential(event, 'update', credential.id, credential.name, diff);

		return json({
			id: credential.id,
			name: credential.name,
			authType: credential.authType,
			username: credential.username,
			hasPassword: !!credential.password,
			hasSshKey: !!credential.sshPrivateKey,
			createdAt: credential.createdAt,
			updatedAt: credential.updatedAt
		});
	} catch (error: any) {
		console.error('更新 Git 凭据失败:', error);
		if (error.message?.includes('UNIQUE constraint failed')) {
			return json({ error: '同名凭据已存在' }, { status: 400 });
		}
		return json({ error: '更新 Git 凭据失败' }, { status: 500 });
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
			return json({ error: '无效的凭据 ID' }, { status: 400 });
		}

		// Get credential name before deletion for audit log
		const credential = await getGitCredential(id);
		if (!credential) {
			return json({ error: '凭据不存在' }, { status: 404 });
		}

		// Get credential name before deletion for audit log
		const credential = await getGitCredential(id);
		if (!credential) {
			return json({ error: '未找到凭据' }, { status: 404 });
		}

		const deleted = await deleteGitCredential(id);
		if (!deleted) {
			return json({ error: '删除凭据失败' }, { status: 500 });
		}

		// Audit log
		await auditGitCredential(event, 'delete', id, credential.name);

		return json({ success: true });
	} catch (error) {
		console.error('删除 Git 凭据失败:', error);
		return json({ error: '删除 Git 凭据失败' }, { status: 500 });
	}
};
