/**
 * Prometheus metrics for Dockhand (#339), gated by `EXPORT_METRICS=true`.
 *
 * Three families of series:
 *  1. Per-environment DOCKER STATE — containers by state/health, images (count +
 *     bytes), volumes, networks, stacks, vulnerabilities by severity, and event
 *     counts. Gathered fresh (per scrape) but behind a short TTL cache so a tight
 *     scrape interval can't hammer Docker; a dead environment is skipped, not fatal.
 *  2. Per-environment RESOURCE usage — cpu/memory. NOT re-collected here: these are
 *     surfaced from the Go collector's samples via metrics-store, so we add no load.
 *  3. Dockhand INTERNALS — build/uptime, process memory (prom-client defaults),
 *     hawser edge agents, jobs, scan queue, cache occupancy, scheduler, database.
 *
 * The registry and all metric objects are created once (module singletons). Each
 * scrape refreshes gauge values; prom-client renders the exposition text.
 */
import { Registry, collectDefaultMetrics, Gauge } from 'prom-client';
import {
	getEnvironments, getContainerEventStats, getPendingContainerUpdates,
	getUsers, getRegistries, getScanFreshness, getScheduleStats,
	getGitRepositories, getConfigSets, getBackupConfigMetrics
} from '$lib/server/db';
import { getApiTokenStats } from '$lib/server/api-tokens';
import { listContainers, listImages, listVolumes, listNetworks } from '$lib/server/docker';
import { listComposeStacks } from '$lib/server/stacks';
import { getVulnerabilitiesMeta } from '$lib/server/vulnerabilities';
import { getVulnerabilitiesCacheStats } from '$lib/server/vulnerabilities-cache';
import { getLatestMetric } from '$lib/server/metrics-store';
import { getServerUptime } from '$lib/server/uptime';
import { getJobStats } from '$lib/server/jobs';
import { getScannerStats } from '$lib/server/scanner';
import { getSchedulerStats } from '$lib/server/scheduler';
import { edgeConnections } from '$lib/server/hawser';
import { getDatabaseStats } from '$lib/server/db/drizzle';

export const METRICS_ENABLED = process.env.EXPORT_METRICS === 'true';

/** How long a gathered snapshot is reused before a scrape re-collects (ms). */
const COLLECT_TTL_MS = 15_000;
/** Hard cap on a full gather so a slow/hung environment can never stall a scrape. */
const COLLECT_TIMEOUT_MS = 10_000;
/** Max environments gathered concurrently — bounds the Docker/DB call burst so a
 *  scrape never monopolizes those resources against live user traffic. */
const ENV_CONCURRENCY = 4;

const PREFIX = 'dockhand_';
const appVersion = typeof __APP_VERSION__ !== 'undefined' ? (__APP_VERSION__ ?? 'unknown') : 'unknown';

// ---------------------------------------------------------------------------
// Registry + metric definitions (created once).
// ---------------------------------------------------------------------------

const registry = new Registry();
// Free Node/process metrics: heap, RSS, GC, event-loop lag, open FDs, etc.
collectDefaultMetrics({ register: registry, prefix: PREFIX });

const g = (name: string, help: string, labelNames: string[] = []) =>
	new Gauge({ name: PREFIX + name, help, labelNames, registers: [registry] });

// --- Build / process ---
const buildInfo = g('build_info', 'Dockhand 构建信息；数值固定为 1。', ['version']);
const uptimeSeconds = g('uptime_seconds', 'Dockhand 服务启动时长 (秒)。');

// --- Per-environment state ---
const envUp = g('env_up', '环境上次探测响应则为 1，否则为 0。', ['env', 'env_id', 'connection_type']);
const containers = g('containers', '按生命周期状态统计容器数量。', ['env', 'env_id', 'state']);
const containersHealth = g('containers_health', '按健康状态统计容器数量。', ['env', 'env_id', 'health']);
const containersRestarts = g('container_restarts_total', '容器重启次数总和。', ['env', 'env_id']);
const containersTotal = g('containers_count', '容器总数 (所有状态)。', ['env', 'env_id']);
const updatesAvailable = g('updates_available', '存在镜像更新的容器数量。', ['env', 'env_id']);
const imagesTotal = g('images_count', '镜像数量。', ['env', 'env_id']);
const imagesDangling = g('images_dangling', '无标签 (悬挂) 镜像。', ['env', 'env_id']);
const imageBytes = g('image_bytes', '镜像磁盘总占用大小 (字节)。', ['env', 'env_id']);
const volumesTotal = g('volumes_count', '数据卷数量。', ['env', 'env_id']);
const networksTotal = g('networks_count', '网络数量。', ['env', 'env_id']);
const stacksTotal = g('stacks_count', 'Compose 堆栈数量。', ['env', 'env_id']);
const vulnerabilities = g('vulnerabilities', '按严重等级统计漏洞条目。', ['env', 'env_id', 'severity']);
const vulnerabilitiesTotal = g('vulnerabilities_count', '漏洞条目总数。', ['env', 'env_id']);
const imagesScanned = g('images_scanned', '至少完成一次持久化扫描的镜像。', ['env', 'env_id']);
const eventsTotal = g('container_events_total', '记录的容器事件 (累计)。', ['env', 'env_id']);
const eventsToday = g('container_events_today', '本地午夜之后记录的容器事件。', ['env', 'env_id']);
const eventsByAction = g('container_events_by_action', '按操作类型统计容器事件。', ['env', 'env_id', 'action']);
const scanOldestAge = g('scan_oldest_age_seconds', '当前最早一次扫描的时长 (用于判断扫描滞后)。', ['env', 'env_id']);
const scanAvgDuration = g('scan_avg_duration_seconds', '平均扫描耗时。', ['env', 'env_id']);

// --- Per-environment resources (from the Go collector, via metrics-store) ---
const envCpu = g('env_cpu_percent', '宿主机 CPU 使用率 (采集器上报)。', ['env', 'env_id']);
const envMemUsed = g('env_memory_used_bytes', '宿主机已用内存 (字节，采集器上报)。', ['env', 'env_id']);
const envMemTotal = g('env_memory_total_bytes', '宿主机总内存 (字节，采集器上报)。', ['env', 'env_id']);

// --- Internals ---
const environmentsTotal = g('environments', '已配置环境数量。');
const usersTotal = g('users', '已配置用户数量。');
const registriesTotal = g('registries', '已配置镜像仓库数量。');
const gitReposTotal = g('git_repositories', '已配置 Git 仓库数量。');
const configSetsTotal = g('config_sets', '已保存配置集数量。');
const apiTokens = g('api_tokens', '按状态统计 API 令牌。', ['state']);
const scheduleExec = g('schedule_executions', '按类型与状态统计定时任务执行记录。', ['type', 'status']);
const scheduleLastRun = g('schedule_last_run_seconds', '各类定时任务上次执行距今时长。', ['type']);
const scheduleLastSuccess = g('schedule_last_success_seconds', '各类定时任务上次成功执行距今时长。', ['type']);
// Per-backup-config visibility (audit medium #16) so one silently-failing target
// is alertable, not hidden behind the type-level aggregates above.
const backupLastSuccess = g('backup_last_success_seconds', '各备份配置上次成功备份距今时长。', ['config_id', 'target', 'env']);
const backupLastStatus = g('backup_last_status', '各备份配置最近状态 (1=成功，0=失败/未知)。', ['config_id', 'target', 'env']);
const hawserAgents = g('hawser_agents_connected', '已连接 Hawser 边缘节点。');
const hawserPending = g('hawser_pending_requests', '所有边缘节点正在处理的请求。');
const hawserAgentInfo = g('hawser_agent_info', '已连接边缘节点信息；数值为连接时长 (秒)。', ['env_id', 'agent', 'agent_version', 'docker_version', 'hostname']);
const jobs = g('jobs', '按状态统计后台 SSE 任务。', ['status']);
const scanQueue = g('scan_queue', '漏洞扫描队列长度。', ['kind']);
const cacheEntries = g('vuln_cache_entries', '漏洞聚合缓存占用条目数。', ['kind']);
const schedulerRunning = g('scheduler_running', '调度器运行中为 1，否则为 0。');
const schedulerJobs = g('scheduler_active_jobs', '正在运行的定时 Cron 任务。');
const dbSizeBytes = g('database_size_bytes', '数据库磁盘占用大小 (字节)。', ['type']);
const dbInfo = g('database_info', '数据库引擎信息；数值固定为 1。', ['type', 'version']);
const dbRows = g('database_rows', '高频数据表行数统计。', ['table']);
const dbExtra = g('database_stat', '引擎专属数据库指标 (Postgres 连接数、SQLite WAL/空闲列表字节等)。', ['type', 'stat']);

// ---------------------------------------------------------------------------
// Collection.
// ---------------------------------------------------------------------------

let lastCollectAt = 0;
let inflight: Promise<void> | null = null;

/** Gather one environment's Docker state, tolerating a dead host. */
async function collectEnvironment(env: { id: number; name: string; connectionType?: string | null }): Promise<void> {
	const labels = { env: env.name, env_id: String(env.id) };
	const upLabels = { ...labels, connection_type: env.connectionType ?? 'socket' };

	// Emit env_up=0 up front so the series ALWAYS exists for every configured env,
	// even if this gather times out before the calls below settle — otherwise a
	// down env would have no series at all and `dockhand_env_up == 0` alerts would
	// never fire. Flipped to 1 only once Docker actually responds.
	envUp.set(upLabels, 0);

	// Resource usage from the collector's last sample — cheap, never touches Docker.
	const point = getLatestMetric(env.id);
	if (point) {
		envCpu.set(labels, point.cpuPercent);
		envMemUsed.set(labels, point.memoryUsed);
		envMemTotal.set(labels, point.memoryTotal);
	}

	// One failing call marks the env down but doesn't abort the others.
	let up = 1;
	const [cs, imgs, vols, nets, stacks, vuln, events, updates, freshness] = await Promise.allSettled([
		listContainers(true, env.id),
		listImages(env.id),
		listVolumes(env.id),
		listNetworks(env.id),
		listComposeStacks(env.id),
		getVulnerabilitiesMeta(env.id),
		getContainerEventStats(env.id),
		getPendingContainerUpdates(env.id),
		getScanFreshness(env.id)
	]);

	if (cs.status === 'fulfilled') {
		const byState: Record<string, number> = {};
		const byHealth: Record<string, number> = {};
		let restarts = 0;
		for (const c of cs.value) {
			byState[c.state] = (byState[c.state] ?? 0) + 1;
			if (c.health) byHealth[c.health] = (byHealth[c.health] ?? 0) + 1;
			restarts += c.restartCount ?? 0;
		}
		for (const [state, n] of Object.entries(byState)) containers.set({ ...labels, state }, n);
		for (const [health, n] of Object.entries(byHealth)) containersHealth.set({ ...labels, health }, n);
		containersTotal.set(labels, cs.value.length);
		containersRestarts.set(labels, restarts);
	} else up = 0; // ANY failure of a core Docker call means the env isn't fully reachable

	if (imgs.status === 'fulfilled') {
		imagesTotal.set(labels, imgs.value.length);
		// Dangling = no usable repo tag (untagged layers left after rebuilds/pulls).
		const dangling = imgs.value.filter((i) => {
			const tags = i.tags ?? [];
			return tags.length === 0 || tags.every((t) => t === '<none>:<none>' || t.startsWith('<none>'));
		}).length;
		imagesDangling.set(labels, dangling);
		imageBytes.set(labels, imgs.value.reduce((sum, i) => sum + (i.size ?? 0), 0));
	} else up = 0;

	if (vols.status === 'fulfilled') volumesTotal.set(labels, vols.value.length);
	else up = 0;

	if (nets.status === 'fulfilled') networksTotal.set(labels, nets.value.length);
	else up = 0;

	if (stacks.status === 'fulfilled') stacksTotal.set(labels, stacks.value.length);

	if (updates.status === 'fulfilled') updatesAvailable.set(labels, updates.value.length);

	if (vuln.status === 'fulfilled') {
		const s = vuln.value.summary;
		vulnerabilities.set({ ...labels, severity: 'critical' }, s.critical);
		vulnerabilities.set({ ...labels, severity: 'high' }, s.high);
		vulnerabilities.set({ ...labels, severity: 'medium' }, s.medium);
		vulnerabilities.set({ ...labels, severity: 'low' }, s.low);
		vulnerabilitiesTotal.set(labels, s.total);
		imagesScanned.set(labels, s.imagesScanned);
	}

	if (events.status === 'fulfilled') {
		eventsTotal.set(labels, events.value.total);
		eventsToday.set(labels, events.value.today);
		for (const [action, n] of Object.entries(events.value.byAction ?? {})) {
			eventsByAction.set({ ...labels, action }, n);
		}
	}

	if (freshness.status === 'fulfilled') {
		if (freshness.value.oldestAgeSeconds !== null) scanOldestAge.set(labels, freshness.value.oldestAgeSeconds);
		if (freshness.value.avgDurationSeconds !== null) scanAvgDuration.set(labels, freshness.value.avgDurationSeconds);
	}

	envUp.set(upLabels, up);
}

/** Refresh Dockhand's own internal gauges — all cheap in-memory reads + one DB stat. */
async function collectInternals(envCount: number): Promise<void> {
	buildInfo.set({ version: appVersion }, 1);
	uptimeSeconds.set(getServerUptime());
	environmentsTotal.set(envCount);

	try { usersTotal.set((await getUsers()).length); } catch { /* auth may be off */ }
	try { registriesTotal.set((await getRegistries()).length); } catch { /* best-effort */ }
	try { gitReposTotal.set((await getGitRepositories()).length); } catch { /* best-effort */ }
	try { configSetsTotal.set((await getConfigSets()).length); } catch { /* best-effort */ }
	try {
		const t = await getApiTokenStats();
		apiTokens.set({ state: 'total' }, t.total);
		apiTokens.set({ state: 'expired' }, t.expired);
		apiTokens.set({ state: 'never_used' }, t.neverUsed);
	} catch { /* best-effort */ }
	try {
		scheduleExec.reset(); scheduleLastRun.reset(); scheduleLastSuccess.reset();
		const s = await getScheduleStats();
		for (const r of s.byTypeStatus) scheduleExec.set({ type: r.type, status: r.status }, r.count);
		for (const [type, age] of Object.entries(s.lastRunSecondsByType)) scheduleLastRun.set({ type }, age);
		for (const [type, age] of Object.entries(s.lastSuccessSecondsByType)) scheduleLastSuccess.set({ type }, age);
	} catch { /* best-effort */ }

	// Per-config backup health (audit medium #16). A config that has never
	// succeeded gets a last_status of 0 and NO last_success value emitted, so
	// staleness/absence is visible to alerting rather than defaulting to green.
	try {
		backupLastSuccess.reset(); backupLastStatus.reset();
		const configs = await getBackupConfigMetrics();
		for (const c of configs) {
			const labels = { config_id: String(c.configId), target: c.target, env: c.envId == null ? 'local' : String(c.envId) };
			backupLastStatus.set(labels, c.status === 'success' ? 1 : 0);
			if (c.lastSuccessSeconds !== null) backupLastSuccess.set(labels, c.lastSuccessSeconds);
		}
	} catch { /* best-effort */ }

	hawserAgents.set(edgeConnections.size);
	hawserAgentInfo.reset();
	let pending = 0;
	const nowMs = Date.now();
	for (const [envId, conn] of edgeConnections) {
		pending += conn.pendingRequests.size;
		hawserAgentInfo.set({
			env_id: String(envId),
			agent: conn.agentName || conn.agentId,
			agent_version: conn.agentVersion || 'unknown',
			docker_version: conn.dockerVersion || 'unknown',
			hostname: conn.hostname || 'unknown'
		}, Math.max(0, Math.round((nowMs - conn.connectedAt.getTime()) / 1000)));
	}
	hawserPending.set(pending);

	const j = getJobStats();
	jobs.set({ status: 'running' }, j.running);
	jobs.set({ status: 'done' }, j.done);
	jobs.set({ status: 'error' }, j.error);

	const sc = getScannerStats();
	scanQueue.set({ kind: 'in_progress' }, sc.inProgress);
	scanQueue.set({ kind: 'locked' }, sc.locked);

	const cache = getVulnerabilitiesCacheStats();
	cacheEntries.set({ kind: 'envs' }, cache.envs);
	cacheEntries.set({ kind: 'views' }, cache.views);
	cacheEntries.set({ kind: 'inflight' }, cache.inflight);

	const sched = getSchedulerStats();
	schedulerRunning.set(sched.running ? 1 : 0);
	schedulerJobs.set(sched.activeJobs);

	try {
		const db = await getDatabaseStats();
		dbSizeBytes.set({ type: db.type }, db.sizeBytes);
		dbInfo.set({ type: db.type, version: db.version }, 1);
		for (const [table, n] of Object.entries(db.rowCounts)) dbRows.set({ table }, n);
		for (const [stat, n] of Object.entries(db.extra)) dbExtra.set({ type: db.type, stat }, n);
	} catch { /* best-effort */ }
}

/**
 * Reset per-env gauges before a fresh gather so a removed environment (or a
 * container state that disappeared) doesn't leave a stale series lingering.
 */
function resetPerEnvGauges(): void {
	for (const m of [
		envUp, containers, containersHealth, containersTotal, containersRestarts, updatesAvailable,
		imagesTotal, imagesDangling, imageBytes, volumesTotal, networksTotal, stacksTotal,
		vulnerabilities, vulnerabilitiesTotal, imagesScanned, eventsTotal, eventsToday, eventsByAction,
		scanOldestAge, scanAvgDuration, envCpu, envMemUsed, envMemTotal
	]) m.reset();
}

/**
 * Gather everything. Resolves `true` if the full gather completed within the
 * timeout, `false` if it timed out. Bounding the wait protects the live UI from
 * a hung environment; the caller uses the return value so a timed-out (partial)
 * gather is NOT cached as if it were fresh — the next scrape re-collects.
 */
/** Run `worker` over `items` with at most `limit` in flight at once. */
async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
	let i = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (i < items.length) {
			const item = items[i++];
			await worker(item).catch(() => { /* isolated per item */ });
		}
	});
	await Promise.all(runners);
}

async function collectAll(): Promise<boolean> {
	const envs = await getEnvironments();
	resetPerEnvGauges();
	const TIMED_OUT = Symbol('timeout');
	const deadline = new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), COLLECT_TIMEOUT_MS));
	// Gather envs in bounded batches (not all at once) so the Docker/DB call burst
	// can't monopolize resources against live traffic; internals run alongside.
	const gather = Promise.all([
		mapLimit(envs, ENV_CONCURRENCY, collectEnvironment),
		collectInternals(envs.length).catch(() => {})
	]).then(() => true as const);
	const result = await Promise.race([gather, deadline]);
	return result !== TIMED_OUT;
}

/**
 * Render the exposition text. Collection is refreshed at most once per
 * COLLECT_TTL_MS; concurrent scrapes within the window share one gather. A
 * gather that times out does NOT advance the cache clock, so the next scrape
 * retries rather than serving the partial snapshot for a full TTL.
 */
export async function renderMetrics(): Promise<string> {
	const now = Date.now();
	if (now - lastCollectAt >= COLLECT_TTL_MS) {
		if (!inflight) {
			inflight = collectAll()
				.then((completed) => { if (completed) lastCollectAt = Date.now(); })
				.catch((e) => { console.error('[metrics] collection failed:', e); })
				.finally(() => { inflight = null; });
		}
		await inflight;
	}
	return registry.metrics();
}

export const metricsContentType = registry.contentType;
