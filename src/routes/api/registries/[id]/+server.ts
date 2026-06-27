import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRegistry, updateRegistry, deleteRegistry, setDefaultRegistry } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import { auditRegistry } from '$lib/server/audit';
import { computeAuditDiff } from '$lib/utils/diff';
import { parseRegistryUrl, DOCKER_HUB_HOSTS } from '$lib/server/docker';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('registries', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的镜像仓库 ID' }, { status: 400 });
		}

		const registry = await getRegistry(id);
		if (!registry) {
			return json({ error: '未找到镜像仓库' }, { status: 404 });
		}

		// Don't expose password
		const { password, ...safeRegistry } = registry;
		return json({ ...safeRegistry, hasCredentials: !!password });
	} catch (error) {
		console.error('获取镜像仓库失败:', error);
		return json({ error: '获取镜像仓库失败' }, { status: 500 });
	}
};

export const PUT: RequestHandler = async (event) => {
	const { params, request, cookies } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('registries', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的镜像仓库 ID' }, { status: 400 });
		}

		// Get old values before update for diff
		const oldRegistry = await getRegistry(id);
		if (!oldRegistry) {
			return json({ error: '未找到镜像仓库' }, { status: 404 });
		}

		const data = await request.json();
		// Trim username/password to prevent stray whitespace from copy-paste corrupting
		// the X-Registry-Auth / Authorization headers (#1105).
		const trimmedUsername = typeof data.username === 'string' ? data.username.trim() : data.username;
		const trimmedPassword = typeof data.password === 'string' ? data.password.trim() : data.password;

		// Diagnostic logging (#1105) — never logs the plaintext credential
		const userLen = typeof trimmedUsername === 'string' ? trimmedUsername.length : 0;
		const pwLen = typeof trimmedPassword === 'string' ? trimmedPassword.length : 0;
		const { host: normalizedHost } = parseRegistryUrl(data.url);
		const hubTag = DOCKER_HUB_HOSTS.has(normalizedHost) ? ' (docker-hub)' : '';
		console.log(`[镜像仓库] 更新 ID=${id}: 地址=${data.url} 标准化主机=${normalizedHost}${hubTag} 用户名(长度=${userLen}) 密码(长度=${pwLen})`);
		const registry = await updateRegistry(id, {
			name: data.name,
			url: data.url,
			username: trimmedUsername,
			password: trimmedPassword,
			isDefault: data.isDefault
		});

		if (!registry) {
			return json({ error: '未找到镜像仓库' }, { status: 404 });
		}

		// If this registry should be default, set it
		if (data.isDefault) {
			await setDefaultRegistry(id);
		}

		// Compute diff for audit
		const diff = computeAuditDiff(oldRegistry, registry);

		// Audit log
		await auditRegistry(event, 'update', registry.id, registry.name, diff);

		// Don't expose password
		const { password, ...safeRegistry } = registry;
		return json({ ...safeRegistry, hasCredentials: !!password });
	} catch (error: any) {
		console.error('更新镜像仓库失败:', error);
		if (error.message?.includes('UNIQUE constraint failed')) {
			return json({ error: '同名镜像仓库已存在' }, { status: 400 });
		}
		return json({ error: '更新镜像仓库失败' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { params, cookies } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('registries', 'delete')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的镜像仓库 ID' }, { status: 400 });
		}

		// Get registry name before deletion for audit log
		const registry = await getRegistry(id);
		if (!registry) {
			return json({ error: '未找到镜像仓库' }, { status: 404 });
		}

		const deleted = await deleteRegistry(id);
		if (!deleted) {
			return json({ error: '无法删除该镜像仓库' }, { status: 400 });
		}

		// Audit log
		await auditRegistry(event, 'delete', id, registry.name);

		return json({ success: true });
	} catch (error) {
		console.error('删除镜像仓库失败:', error);
		return json({ error: '删除镜像仓库失败' }, { status: 500 });
	}
};
