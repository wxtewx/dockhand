import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { auditBackupDestination } from '$lib/server/audit';
import { getBackupDestination } from '$lib/server/db';
import { rotateDestinationPassword } from '$lib/server/backups';

/**
 * Rotate the restic repository password for a destination.
 *
 * Body: { currentPassword: string, newPassword: string }
 *
 * 200 — rotated, DB updated
 * 400 — input invalid or current password wrong
 * 404 — destination not found
 * 409 — restic rotated but DB write failed (manual recovery needed; details
 *       include dbOutOfSync: true)
 * 500 — restic call failed for an unrelated reason
 */
export const POST: RequestHandler = async (event) => {
	const { params, request, cookies } = event;
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('backups', 'manage')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	const id = parseInt(params.id);
	if (isNaN(id)) return json({ error: 'ID 格式非法' }, { status: 400 });

	const body = await request.json().catch(() => ({}));
	const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
	const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

	if (!currentPassword || !newPassword) {
		return json({ error: 'currentPassword 与 newPassword 为必填参数' }, { status: 400 });
	}

	const dest = await getBackupDestination(id);
	if (!dest) return json({ error: '未找到该存储位置' }, { status: 404 });

	const result = await rotateDestinationPassword(id, currentPassword, newPassword);
	if (!result.ok) {
		// Audit the failed attempt — useful signal for spotting wrong-password
		// probes against destinations.
		await auditBackupDestination(event, 'update', id, dest.name, {
			action: 'rotate-key',
			success: false,
			error: result.error,
			dbOutOfSync: result.dbOutOfSync ?? false
		});
		if (result.dbOutOfSync) {
			return json({ error: result.error, dbOutOfSync: true }, { status: 409 });
		}
		// Restic reports an incorrect current password as "wrong password" or
		// "no key found" — surface a clearer 400 so the UI can say the current
		// password is incorrect rather than a generic failure.
		if (/wrong password|no key found/i.test(result.error)) {
			return json({ error: '当前密码不正确' }, { status: 400 });
		}
		if (result.error.toLowerCase().includes('does not match') || result.error.toLowerCase().includes('must')) {
			return json({ error: result.error }, { status: 400 });
		}
		return json({ error: result.error }, { status: 500 });
	}

	await auditBackupDestination(event, 'update', id, dest.name, { action: 'rotate-key', success: true });
	return json({ success: true });
};
