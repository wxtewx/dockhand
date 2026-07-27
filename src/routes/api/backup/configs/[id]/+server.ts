import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { auditBackup } from '$lib/server/audit';
import {
	updateBackupConfig,
	deleteBackupConfig,
	getBackupDestination,
	getEnvironment
} from '$lib/server/db';
import { registerSchedule, unregisterSchedule, isValidCron } from '$lib/server/scheduler';
import { isBackupRunning } from '$lib/server/backups';
import { validateRetention, retentionToStore, resolveEnabledOnScheduleChange } from '$lib/server/backups/helpers';
import { requireBackups, loadConfigGateEnv } from '$lib/server/backups/route-guards';
import { isLocalRepo, isRemoteEnvironment } from '$lib/shared/repo-predicates';

export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	const denied = await requireBackups(auth, 'view');
	if (denied) return denied;

	// (audit LOW #41) Env-scope the single-config read too — the LIST endpoint
	// already filters, but this direct fetch leaked a config for an off-limits env.
	const gated = await loadConfigGateEnv(params.id, auth);
	if ('response' in gated) return gated.response;

	return json(gated.config);
};

export const PUT: RequestHandler = async (event) => {
	const { params, request, cookies } = event;
	const auth = await authorize(cookies);
	const denied = await requireBackups(auth, 'manage');
	if (denied) return denied;

	// Environment access check (enterprise RBAC). Config's env is fixed at creation.
	const gated = await loadConfigGateEnv(params.id, auth);
	if ('response' in gated) return gated.response;
	const existing = gated.config;
	const id = existing.id;

	const body = await request.json();

	// Validate cron schedule if provided (audit #7)
	if (typeof body.schedule === 'string' && body.schedule.trim() && !isValidCron(body.schedule.trim())) {
		return json({ error: `Cron 表达式无效: ${body.schedule}` }, { status: 400 });
	}

	// Validate retention keep-* values before persisting (audit medium #13).
	const retentionCheck = validateRetention(body.retention);
	if (!retentionCheck.ok) {
		return json({ error: `保留策略配置无效: ${retentionCheck.reason}` }, { status: 400 });
	}

	// (audit #56) Changing the destination while a backup is in flight would leave
	// the running backup on the OLD destination's lock while the schedule re-arms
	// under the new one — refuse the destination change until the run finishes.
	if (body.destinationId !== undefined && body.destinationId !== existing.destinationId && isBackupRunning(id)) {
		return json({ error: '该配置正在执行备份，暂时无法修改存储位置' }, { status: 409 });
	}

	// Refuse local repo + remote env (same rule as POST). Effective destination
	// is the body's value if supplied, otherwise the existing config's.
	const effectiveDestId = body.destinationId ?? existing.destinationId;
	const effectiveEnvId = existing.environmentId; // env is fixed at creation
	if (effectiveEnvId) {
		const [dest, env] = await Promise.all([
			getBackupDestination(effectiveDestId),
			getEnvironment(effectiveEnvId)
		]);
		if (dest && env && isRemoteEnvironment(env) && isLocalRepo(dest.repository)) {
			return json({
				error: `本地存储仓库 "${dest.name}" 无法备份远程环境 "${env.name}" 中的容器。请使用 S3、REST 或其他非本地存储后端。`
			}, { status: 400 });
		}
	}

	// Auto-enable a config that transitions from manual (no schedule) to scheduled
	// (a real cron) — otherwise a paused run-once config that the user edits to add a
	// schedule stays paused, forcing a manual un-pause. See resolveEnabledOnScheduleChange.
	const resolvedEnabled = resolveEnabledOnScheduleChange({
		requestedEnabled: body.enabled,
		existingSchedule: existing.schedule,
		newSchedule: body.schedule ?? existing.schedule
	});

	try {
		const updated = await updateBackupConfig(id, {
			destinationId: body.destinationId,
			enabled: resolvedEnabled,
			allVolumes: body.allVolumes,
			selectedVolumes: body.selectedVolumes ? JSON.stringify(body.selectedVolumes) : body.selectedVolumes,
			stopBeforeBackup: body.stopBeforeBackup,
			schedule: body.schedule,
			// Apply the default scheduled retention the same way create does, so a
			// config edited to add a schedule with no explicit retention doesn't end
			// up with pruning disabled and an unbounded-growth repo. Uses the effective
			// schedule (the incoming one, or the existing one if unchanged).
			retention: retentionToStore(body.retention, body.schedule ?? existing.schedule),
			options: body.options ? JSON.stringify(body.options) : body.options,
			tags: body.tags ? JSON.stringify(body.tags) : body.tags
		});

		if (!updated) return json({ error: '更新操作失败' }, { status: 500 });

		// Update schedule registration
		if (updated.enabled && updated.schedule) {
			await registerSchedule(updated.id, 'backup', updated.environmentId);
		} else {
			unregisterSchedule(updated.id, 'backup');
		}

		await auditBackup(event, 'update', updated.targetName, updated.environmentId, { configId: id });
		return json(updated);
	} catch (error: any) {
		return json({ error: error.message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async (event) => {
	const { params, cookies } = event;
	const auth = await authorize(cookies);
	const denied = await requireBackups(auth, 'manage');
	if (denied) return denied;

	// Environment access check (enterprise RBAC). Config's env is fixed at creation.
	const gated = await loadConfigGateEnv(params.id, auth);
	if ('response' in gated) return gated.response;
	const existing = gated.config;
	const id = existing.id;

	// (audit #55) Don't delete a config out from under an in-flight backup — the
	// run's helper containers + lock reference it; deleting mid-run is messy.
	if (isBackupRunning(id)) {
		return json({ error: '该配置正在执行备份，请等待任务结束后再删除' }, { status: 409 });
	}

	// Unregister schedule before deleting
	unregisterSchedule(id, 'backup');

	await deleteBackupConfig(id);
	await auditBackup(event, 'delete', existing.targetName, existing.environmentId, { configId: id });
	return json({ success: true });
};
