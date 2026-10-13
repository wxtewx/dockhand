/** Maximum configured minimum image age. */
export const MAXIMUM_RELEASE_AGE_HOURS = 24 * 30;

/** Pull the digest that passed the age check, then restore the caller's local tag. */
export function verifiedImagePullPlan(imageName: string, digest: string): {
	reference: string;
	tag: { repo: string; tag: string } | null;
} {
	if (!/^sha256:[a-f0-9]{64}$/i.test(digest)) throw new Error('镜像仓库返回了无效的镜像摘要');
	if (imageName.includes('@')) {
		const requestedDigest = imageName.slice(imageName.lastIndexOf('@') + 1);
		if (requestedDigest.toLowerCase() !== digest.toLowerCase()) throw new Error('仓库摘要与请求的镜像摘要不匹配');
		return { reference: imageName, tag: null };
	}

	const colon = imageName.lastIndexOf(':');
	const slash = imageName.lastIndexOf('/');
	const hasTag = colon > slash;
	const repo = hasTag ? imageName.slice(0, colon) : imageName;
	const tag = hasTag ? imageName.slice(colon + 1) : 'latest';
	return { reference: repo + '@' + digest, tag: { repo, tag } };
}

export interface ReleaseAgeObservation {
	source: 'created' | 'first-observed';
	remainingMs: number;
	observedAt: string;
}

/** Explain an active cooldown without preventing a user-requested image pull. */
export function manualPullAgeWarning(image: string, hours: number, observation: ReleaseAgeObservation | null): string | null {
	if (hours <= 0) return null;
	if (!observation) return `无法确定 ${image} 的更新冷却时间。由于是手动请求，仍将执行拉取。`;
	if (observation.remainingMs <= 0) return null;
	const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(observation.observedAt)) / 60000));
	const remainingMinutes = Math.ceil(observation.remainingMs / 60000);
	const basis = observation.source === 'created'
		? `${image} 的该镜像摘要创建于 ${observation.observedAt}`
		: `无法获取创建时间。Dockhand 首次观测到 ${image} 的该摘要是在 ${observation.observedAt}`;
	return `${basis} (${elapsedMinutes} 分钟前)；自动更新冷却还剩 ${remainingMinutes} 分钟。由于是手动请求，仍将执行拉取。`;
}

export function parseMinimumReleaseAgeHours(value: unknown): number | null {
	const hours = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
	return Number.isInteger(hours) && hours >= 0 && hours <= MAXIMUM_RELEASE_AGE_HOURS ? hours : null;
}

export interface MinimumReleaseAgeConfig {
	hours: number;
	overridden: boolean;
	inherited: boolean;
}

export function resolveMinimumReleaseAgeConfig(
	environmentVariable: string | undefined,
	globalSetting: unknown,
	environmentSetting: unknown = null
): MinimumReleaseAgeConfig {
	if (environmentVariable !== undefined && environmentVariable.trim() !== '') {
		const hours = parseMinimumReleaseAgeHours(environmentVariable);
		if (hours === null) throw new Error('MINIMUM_RELEASE_AGE_HOURS 必须是 0 到 720 之间的整数');
		return { hours, overridden: true, inherited: true };
	}
	const specific = parseMinimumReleaseAgeHours(environmentSetting);
	if (specific !== null) return { hours: specific, overridden: false, inherited: false };
	return { hours: parseMinimumReleaseAgeHours(globalSetting) ?? 0, overridden: false, inherited: true };
}

export function releaseAgeRemainingMs(firstSeen: string, hours: number, now = Date.now()): number {
	const observed = Date.parse(firstSeen);
	if (!Number.isFinite(observed)) return hours * 60 * 60 * 1000;
	return Math.max(0, observed + hours * 60 * 60 * 1000 - now);
}

/** OCI creation dates must be RFC 3339 timestamps in the past. In particular,
 * Date.parse's permissive date-only/numeric forms must not bypass the fallback. */
export function validImageCreatedAt(value: unknown, now = Date.now()): string | null {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
	const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
	if (hour > 23 || minute > 59 || second > 59) return null;
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) return null;
	// JavaScript normalizes impossible dates such as February 30; reject them.
	const [year, month, day] = value.slice(0, 10).split('-').map(Number);
	if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
	return new Date(timestamp).toISOString();
}
