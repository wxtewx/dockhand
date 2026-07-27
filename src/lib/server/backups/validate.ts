/**
 * backups/validate.ts — pure, fail-fast validation for backup configs and
 * restore requests. Validation runs BEFORE any side effect starts, and reports
 * ALL problems at once (not just the first) so the user can fix them in one pass.
 *
 * These validators are pure — they take plain input and return a list of
 * problems. They do NOT check the world (does the repo exist, is the container
 * running): those are I/O checks the services do at run time. Here we only catch
 * what's wrong with the request/config itself.
 */
import { isValidCron } from '../scheduler/cron-utils';
import { isValidSnapshotId, isSafePathSegment } from './security';
import { parseRetention } from './retention';

/** A single validation problem: which field, and what's wrong. */
export interface ValidationIssue {
	field: string;
	message: string;
}

export type ValidationResult =
	| { ok: true }
	| { ok: false; issues: ValidationIssue[] };

function result(issues: ValidationIssue[]): ValidationResult {
	return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/** The fields of a backup config that this module can validate without I/O. */
export interface BackupConfigInput {
	type: string;
	targetName: string;
	destinationId: number | null | undefined;
	schedule?: string | null;
	retention?: string | null | Record<string, unknown>;
	enabled?: boolean;
	allVolumes?: boolean;
	selectedVolumes?: string[] | null;
}

/**
 * Validate a backup config. Checks the type, a non-empty target, a destination,
 * a well-formed cron (if scheduled), and that a non-"all-volumes" config actually
 * selects at least one volume (an empty selection would back up nothing).
 */
export function validateBackupConfig(input: BackupConfigInput): ValidationResult {
	const issues: ValidationIssue[] = [];

	if (input.type !== 'container' && input.type !== 'stack') {
		issues.push({ field: 'type', message: `类型必须为 "container" 或 "stack" (当前值: "${input.type}")` });
	}
	if (!input.targetName || !input.targetName.trim()) {
		issues.push({ field: 'targetName', message: '请填写目标名称' });
	}
	if (input.destinationId == null || !Number.isInteger(input.destinationId) || input.destinationId <= 0) {
		issues.push({ field: 'destinationId', message: '请选择有效的备份存储位置' });
	}
	if (input.schedule != null && input.schedule.trim() && !isValidCron(input.schedule.trim())) {
		issues.push({ field: 'schedule', message: `无效的 cron 表达式: "${input.schedule}"` });
	}
	// parseRetention already coerces a bad blob to "none" (safe), so retention is
	// never a hard error — but a non-object string that isn't empty is suspicious.
	if (typeof input.retention === 'string' && input.retention.trim()) {
		try { JSON.parse(input.retention); }
		catch { issues.push({ field: 'retention', message: '保留策略不是合法的 JSON' }); }
	}
	if (input.allVolumes === false) {
		const sel = input.selectedVolumes;
		if (!Array.isArray(sel) || sel.length === 0) {
			issues.push({ field: 'selectedVolumes', message: '至少选择一个数据卷，或开启 “全部数据卷” 选项' });
		}
	}

	return result(issues);
}

/** Restore into the live volumes (destructive) vs into a fresh path (safe). */
export type RestoreMode = 'in-place' | 'new-location';

/** A restore request, as the API/UI submits it. */
export interface RestoreRequestInput {
	destinationId: number | null | undefined;
	snapshotId: string | null | undefined;
	/** The volumes (by discovered name/key) to restore; empty = all in snapshot. */
	volumes?: string[];
	mode: RestoreMode;
	/** Required for in-place: the explicit destructive-intent confirmation. */
	confirmOverwrite?: boolean;
	/** For new-location: where to extract to (validated for containment by the service). */
	targetPath?: string | null;
	/** Whether to recreate the container / redeploy the stack as-is after restore. */
	recreate?: boolean;
	/** For a stack restore target dir (path-segment safety only here). */
	stackName?: string | null;
	environmentId?: number | null;
	/** Post-restore action. For a new-location CLONE (recreate/redeploy) requires a
	 * targetName so the engine knows what to bring up. */
	postRestore?: 'start' | 'recreate' | 'redeploy' | 'none';
	/** The container/stack name to bring up after a clone. */
	targetName?: string | null;
	/** New-location CLONE: per-volume destinations on the target env. */
	volumeDestinations?: Array<{ volume: string; kind: 'volume' | 'path'; target: string }>;
}

/**
 * Validate a restore request. In-place restore is destructive, so it REQUIRES an
 * explicit confirmOverwrite — a restore must never silently clobber live data.
 * A new-location restore is non-destructive and needs a target path.
 */
export function validateRestoreRequest(input: RestoreRequestInput): ValidationResult {
	const issues: ValidationIssue[] = [];

	if (input.destinationId == null || !Number.isInteger(input.destinationId) || input.destinationId <= 0) {
		issues.push({ field: 'destinationId', message: '请选择有效的备份存储位置' });
	}
	if (!input.snapshotId || !isValidSnapshotId(input.snapshotId)) {
		issues.push({ field: 'snapshotId', message: '请填写合法的快照 ID' });
	}
	if (input.mode !== 'in-place' && input.mode !== 'new-location') {
		issues.push({ field: 'mode', message: '恢复模式必须为 "in-place" 或 "new-location"' });
	}
	if (input.mode === 'in-place' && input.confirmOverwrite !== true) {
		issues.push({
			field: 'confirmOverwrite',
			message: '就地恢复将会覆盖正在运行的数据，需要显式确认',
		});
	}
	// A CLONE (new-location that populates real destinations and/or starts the
	// target) is selected by per-volume destinations or a recreate/redeploy action.
	const isClone = input.mode === 'new-location'
		&& ((input.volumeDestinations?.length ?? 0) > 0
			|| input.postRestore === 'recreate' || input.postRestore === 'redeploy');

	// targetPath is required for a plain new-location extract, but NOT for a clone
	// whose volumes all map to destinations (a fully-mapped clone extracts nothing
	// loose). Require it for a plain new-location, or a clone that still has loose
	// (un-mapped) volumes — the service falls those back to targetPath.
	if (input.mode === 'new-location' && !isClone && (!input.targetPath || !input.targetPath.trim())) {
		issues.push({ field: 'targetPath', message: '全新路径恢复需要指定目标路径' });
	}
	if (isClone) {
		const mappedVols = new Set((input.volumeDestinations ?? []).map((d) => d.volume));
		const looseCount = (input.volumes ?? []).filter((v) => !mappedVols.has(v)).length;
		// If any requested volume is un-mapped, it falls back to targetPath extraction.
		if (looseCount > 0 && (!input.targetPath || !input.targetPath.trim())) {
			issues.push({ field: 'targetPath', message: '未指定目标的数据包需要填写解压路径' });
		}
		if ((input.postRestore === 'recreate' || input.postRestore === 'redeploy')
			&& (!input.targetName || !input.targetName.trim())) {
			issues.push({ field: 'targetName', message: '重建/重新部署操作需要填写目标名称' });
		}
		for (const d of input.volumeDestinations ?? []) {
			if (!d || typeof d.volume !== 'string' || !d.volume) {
				issues.push({ field: 'volumeDestinations', message: '每条映射配置必须指定数据卷名称' });
				continue;
			}
			if (input.volumes && input.volumes.length > 0 && !input.volumes.includes(d.volume)) {
				issues.push({ field: 'volumeDestinations', message: `映射配置中的 "${d.volume}" 不在待恢复列表内` });
			}
			if (d.kind === 'path') {
				if (typeof d.target !== 'string' || !d.target.startsWith('/') || d.target.includes('..')) {
					issues.push({ field: 'volumeDestinations', message: `"${d.volume}" 的路径目标必须是绝对路径，不能包含 ".."` });
				}
			} else if (d.kind === 'volume') {
				if (typeof d.target !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(d.target)) {
					issues.push({ field: 'volumeDestinations', message: `"${d.volume}" 指定的数据卷名称格式非法` });
				}
			} else {
				issues.push({ field: 'volumeDestinations', message: `"${d.volume}" 的类型必须填写 "volume" 或 "path"` });
			}
		}
	}
	if (input.stackName != null && input.stackName !== '' && !isSafePathSegment(input.stackName)) {
		issues.push({ field: 'stackName', message: '堆栈名称非法，不能包含路径分隔符或 ".." ' });
	}

	return result(issues);
}

/** True if a parsed retention would ever prune (convenience for the service). */
export function retentionWouldPrune(retention: string | null | undefined | Record<string, unknown>): boolean {
	return parseRetention(retention).mode !== 'none';
}

/** The compose-file lookup assertStackBackupable depends on (injected for tests).
 * `needsFileLocation` = the stack's compose file location is unknown. */
export type GetComposeFile = (
	targetName: string,
	envId?: number,
) => Promise<{ needsFileLocation?: boolean }>;

/**
 * Assert a target is safe to back up. A container is always fine. A stack is only
 * backupable when Dockhand knows where its compose file lives — an external stack
 * with an unknown file location would produce an incomplete artifact that can't be
 * redeployed at restore time, so we refuse it up front. Pure over an injected
 * lookup; assertStackBackupable() wraps it with the real stacks module.
 */
export async function assertBackupableWith(
	getComposeFile: GetComposeFile,
	type: string,
	targetName: string,
	envId?: number | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	if (type !== 'stack') return { ok: true };
	const composeResult = await getComposeFile(targetName, envId ?? undefined);
	if (composeResult.needsFileLocation) {
		return {
			ok: false,
			reason: `堆栈 "${targetName}" 为外部堆栈，无法获取 compose 文件位置，备份产物无法完整恢复。请先将该堆栈接入 Dockhand (堆栈 → 导入) 后重试。`,
		};
	}
	return { ok: true };
}

/**
 * DB-bound wrapper: resolve the stack compose-file lookup lazily from ../stacks.
 * The dynamic import avoids a static import cycle between the backup and stacks
 * modules.
 */
export async function assertStackBackupable(
	type: string,
	targetName: string,
	envId?: number | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const { getStackComposeFile } = await import('../stacks');
	return assertBackupableWith(getStackComposeFile, type, targetName, envId);
}
