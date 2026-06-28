import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
	getRole,
	updateRole as dbUpdateRole,
	deleteRole as dbDeleteRole
} from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import { auditRole } from '$lib/server/audit';
import { computeAuditDiff } from '$lib/utils/diff';
import { clearTokenCache } from '$lib/server/api-tokens';

// GET /api/roles/[id] - Get a specific role
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);

	// Allow viewing roles when auth is disabled (setup mode) or with enterprise license
	if (auth.authEnabled && !auth.isEnterprise) {
		return json({ error: '需要企业版授权' }, { status: 403 });
	}

	if (!params.id) {
		return json({ error: '必须提供角色 ID' }, { status: 400 });
	}

	try {
		const id = parseInt(params.id);
		const role = await getRole(id);

		if (!role) {
			return json({ error: '未找到角色' }, { status: 404 });
		}

		return json(role);
	} catch (error) {
		console.error('获取角色失败:', error);
		return json({ error: '获取角色失败' }, { status: 500 });
	}
};

// PUT /api/roles/[id] - Update a role
export const PUT: RequestHandler = async (event) => {
	const { params, request, cookies } = event;
	const auth = await authorize(cookies);

	// Check enterprise license
	if (!auth.isEnterprise) {
		return json({ error: '需要企业版授权' }, { status: 403 });
	}

	// When auth is disabled, allow all operations (setup mode)
	// When auth is enabled, require admin access
	if (auth.authEnabled && !auth.isAdmin) {
		return json({ error: '需要管理员权限' }, { status: 403 });
	}

	if (!params.id) {
		return json({ error: '必须提供角色 ID' }, { status: 400 });
	}

	try {
		const id = parseInt(params.id);
		const data = await request.json();

		const existingRole = await getRole(id);
		if (!existingRole) {
			return json({ error: '未找到角色' }, { status: 404 });
		}

		if (existingRole.isSystem) {
			return json({ error: '无法修改系统角色' }, { status: 400 });
		}

		const role = await dbUpdateRole(id, data);
		if (!role) {
			return json({ error: '更新角色失败' }, { status: 500 });
		}

		// Clear token cache — any cached user with this role has stale permissions
		clearTokenCache();

		// Compute diff for audit
		const diff = computeAuditDiff(existingRole, role);

		// Audit log
		await auditRole(event, 'update', role.id, role.name, diff);

		return json(role);
	} catch (error: any) {
		console.error('更新角色失败:', error);
		if (error.message?.includes('UNIQUE constraint failed')) {
			return json({ error: '角色名称已存在' }, { status: 409 });
		}
		return json({ error: '更新角色失败' }, { status: 500 });
	}
};

// DELETE /api/roles/[id] - Delete a role
export const DELETE: RequestHandler = async (event) => {
	const { params, cookies } = event;
	const auth = await authorize(cookies);

	// Check enterprise license
	if (!auth.isEnterprise) {
		return json({ error: '需要企业版授权' }, { status: 403 });
	}

	// When auth is disabled, allow all operations (setup mode)
	// When auth is enabled, require admin access
	if (auth.authEnabled && !auth.isAdmin) {
		return json({ error: '需要管理员权限' }, { status: 403 });
	}

	if (!params.id) {
		return json({ error: '必须提供角色 ID' }, { status: 400 });
	}

	try {
		const id = parseInt(params.id);
		const role = await getRole(id);

		if (!role) {
			return json({ error: '未找到角色' }, { status: 404 });
		}

		if (role.isSystem) {
			return json({ error: '无法删除系统角色' }, { status: 400 });
		}

		const deleted = await dbDeleteRole(id);
		if (!deleted) {
			return json({ error: '删除角色失败' }, { status: 500 });
		}

		// Clear token cache — users with this role may have stale cached permissions
		clearTokenCache();

		// Audit log
		await auditRole(event, 'delete', id, role.name);

		return json({ success: true });
	} catch (error) {
		console.error('删除角色失败:', error);
		return json({ error: '删除角色失败' }, { status: 500 });
	}
};
