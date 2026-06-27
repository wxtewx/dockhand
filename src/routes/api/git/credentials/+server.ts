import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getGitCredentials,
	createGitCredential,
	type GitAuthType
} from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import { auditGitCredential } from '$lib/server/audit';

export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('git', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const credentials = await getGitCredentials();
		// Don't expose sensitive data in list view
		const sanitized = credentials.map(cred => ({
			id: cred.id,
			name: cred.name,
			authType: cred.authType,
			username: cred.username,
			hasPassword: !!cred.password,
			hasSshKey: !!cred.sshPrivateKey,
			createdAt: cred.createdAt,
			updatedAt: cred.updatedAt
		}));
		return json(sanitized);
	} catch (error) {
		console.error('获取 Git 凭据失败:', error);
		return json({ error: '获取 Git 凭据失败' }, { status: 500 });
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

		const authType = (data.authType || 'none') as GitAuthType;
		if (!['none', 'password', 'ssh'].includes(authType)) {
			return json({ error: '无效的认证类型' }, { status: 400 });
		}

		if (authType === 'password' && !data.password) {
			return json({ error: '密码认证需要填写密码' }, { status: 400 });
		}

		if (authType === 'ssh' && !data.sshPrivateKey) {
			return json({ error: 'SSH 认证需要填写私钥' }, { status: 400 });
		}

		const credential = await createGitCredential({
			name: data.name,
			authType,
			username: data.username,
			password: data.password,
			sshPrivateKey: data.sshPrivateKey,
			sshPassphrase: data.sshPassphrase
		});

		// Audit log
		await auditGitCredential(event, 'create', credential.id, credential.name);

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
		console.error('创建 Git 凭据失败:', error);
		if (error.message?.includes('UNIQUE constraint failed')) {
			return json({ error: '同名凭据已存在' }, { status: 400 });
		}
		return json({ error: '创建 Git 凭据失败' }, { status: 500 });
	}
};
