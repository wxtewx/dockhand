import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getConfigSet, updateConfigSet, deleteConfigSet } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import { auditConfigSet } from '$lib/server/audit';
import { computeAuditDiff } from '$lib/utils/diff';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('configsets', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的 ID' }, { status: 400 });
		}

		const configSet = await getConfigSet(id);
		if (!configSet) {
			return json({ error: '未找到配置集' }, { status: 404 });
		}

		return json(configSet);
	} catch (error) {
		console.error('获取配置集失败:', error);
		return json({ error: '获取配置集失败' }, { status: 500 });
	}
};

export const PUT: RequestHandler = async (event) => {
	const { params, request, cookies } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('configsets', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的 ID' }, { status: 400 });
		}

		// Get old values before update for diff
		const oldConfigSet = await getConfigSet(id);
		if (!oldConfigSet) {
			return json({ error: '未找到配置集' }, { status: 404 });
		}

		const body = await request.json();

		const configSet = await updateConfigSet(id, {
			name: body.name?.trim(),
			description: body.description?.trim(),
			envVars: body.envVars,
			labels: body.labels,
			ports: body.ports,
			volumes: body.volumes,
			networkMode: body.networkMode,
			restartPolicy: body.restartPolicy
		});

		if (!configSet) {
			return json({ error: '未找到配置集' }, { status: 404 });
		}

		// Compute diff for audit
		const diff = computeAuditDiff(oldConfigSet, configSet);

		// Audit log
		await auditConfigSet(event, 'update', configSet.id, configSet.name, diff);

		return json(configSet);
	} catch (error: any) {
		console.error('更新配置集失败:', error);
		if (error.message?.includes('UNIQUE constraint')) {
			return json({ error: '该名称的配置集已存在' }, { status: 400 });
		}
		return json({ error: '更新配置集失败' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { params, cookies } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('configsets', 'delete')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的 ID' }, { status: 400 });
		}

		// Get config set name before deletion for audit log
		const configSet = await getConfigSet(id);
		if (!configSet) {
			return json({ error: '未找到配置集' }, { status: 404 });
		}

		const deleted = await deleteConfigSet(id);
		if (!deleted) {
			return json({ error: '删除配置集失败' }, { status: 500 });
		}

		// Audit log
		await auditConfigSet(event, 'delete', id, configSet.name);

		return json({ success: true });
	} catch (error) {
		console.error('删除配置集失败:', error);
		return json({ error: '删除配置集失败' }, { status: 500 });
	}
};
