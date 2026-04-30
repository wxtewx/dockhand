import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import {
	getRoles,
	createRole as dbCreateRole
} from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import { auditRole } from '$lib/server/audit';

// GET /api/roles - List all roles
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);

	// Allow viewing roles when auth is disabled (setup mode) or with enterprise license
	// This lets users see built-in roles before activating auth/enterprise
	if (auth.authEnabled && !auth.isEnterprise) {
		return json({ error: '需要企业版许可证' }, { status: 403 });
	}

	try {
		const roles = await getRoles();
		return json(roles);
	} catch (error) {
		console.error('获取角色列表失败:', error);
		return json({ error: '获取角色列表失败' }, { status: 500 });
	}
};

// POST /api/roles - Create a new role
export const POST: RequestHandler = async (event) => {
	const { request, cookies } = event;
	const auth = await authorize(cookies);

	// Check enterprise license
	if (!auth.isEnterprise) {
		return json({ error: '需要企业版许可证' }, { status: 403 });
	}

	// When auth is disabled, allow all operations (setup mode)
	// When auth is enabled, require admin access
	if (auth.authEnabled && !auth.isAdmin) {
		return json({ error: '需要管理员权限' }, { status: 403 });
	}

	try {
		const { name, description, permissions, environmentIds } = await request.json();

		if (!name || !permissions) {
			return json({ error: '名称和权限为必填项' }, { status: 400 });
		}

		const role = await dbCreateRole({
			name,
			description,
			permissions,
			environmentIds: environmentIds ?? null
		});

		// Audit log
		await auditRole(event, 'create', role.id, role.name);

		return json(role, { status: 201 });
	} catch (error: any) {
		console.error('创建角色失败:', error);
		if (error.message?.includes('UNIQUE constraint failed')) {
			return json({ error: '角色名称已存在' }, { status: 409 });
		}
		return json({ error: '创建角色失败' }, { status: 500 });
	}
};
