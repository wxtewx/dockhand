/**
 * Compose Validate rule catalog (plugin model).
 *
 * Each rule is a self-contained RuleDefinition: { id, description, group,
 * defaultSeverity, check }. The engine (index.ts) runs each rule, stamps the effective
 * severity (default OR user override), and isolates a crashing rule. A rule's `check`
 * returns findings WITHOUT severity (the engine fills it) unless the rule is
 * intrinsically graded, in which case it sets its own and the engine respects it.
 *
 * ADDING A RULE: write one RuleDefinition and push it into RULES below. That's it -
 * the id auto-appears in the settings UI and the config accepts disable/severity for it.
 */

import type { RuleDefinition, RuleFinding, ParsedCompose } from './types';
import { SERVICE_KEYS, TOP_LEVEL_KEYS, isLikelyTypo } from './vocab';

// --- small readers over the plain-object compose --------------------------------

function services(p: ParsedCompose): Record<string, Record<string, unknown>> {
	const s = p.doc?.services;
	return s && typeof s === 'object' && !Array.isArray(s)
		? (s as Record<string, Record<string, unknown>>)
		: {};
}

function asRecord(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function ports(svc: Record<string, unknown>): unknown[] {
	return Array.isArray(svc.ports) ? svc.ports : [];
}

/**
 * Parse a compose port entry into { hostIp, hostPort }. Handles the short string
 * form ("8080:80", "127.0.0.1:8080:80", "8080", "8080-8090:80"), and the long
 * object form ({ published, target, host_ip }). Returns null when there's no host
 * publish (e.g. a bare container port with no mapping).
 */
export function parsePortEntry(
	entry: unknown
): { hostIp: string | null; hostPort: number | null; raw: string } | null {
	if (typeof entry === 'number') return { hostIp: null, hostPort: null, raw: String(entry) };
	if (typeof entry === 'string') {
		const raw = entry;
		// Bracketed IPv6 host ip: "[::1]:8080:80" / "[::]:8080:80". Split off the bracket
		// first so the ':' inside the address doesn't break the field split.
		const v6 = /^\[([0-9a-fA-F:]+)\]:(.+)$/.exec(entry);
		if (v6) {
			const rest = v6[2].split(':'); // host[:container]
			return { hostIp: v6[1], hostPort: toPort(rest[0]), raw };
		}
		const parts = entry.split(':');
		if (parts.length === 1) return { hostIp: null, hostPort: null, raw }; // "80" - not published
		if (parts.length === 2) return { hostIp: null, hostPort: toPort(parts[0]), raw };
		return { hostIp: parts[0] || null, hostPort: toPort(parts[1]), raw }; // ip:host:container
	}
	const obj = asRecord(entry);
	if (obj) {
		const raw = JSON.stringify(obj);
		const published = obj.published;
		const hostPort =
			typeof published === 'number'
				? published
				: typeof published === 'string'
					? toPort(published)
					: null;
		return { hostIp: typeof obj.host_ip === 'string' ? obj.host_ip : null, hostPort, raw };
	}
	return null;
}

function toPort(s: string): number | null {
	const first = s.split('-')[0].trim();
	const n = Number(first);
	return Number.isInteger(n) && n > 0 ? n : null;
}

const DB_CACHE_IMAGE =
	/(?:^|\/)(postgres|mysql|mariadb|mongo|redis|memcached|rabbitmq|elasticsearch|clickhouse|cassandra|couchdb|influxdb)(?::|$)/i;

// Admin / management UIs that expose control over data or the host. Broadly
// published (0.0.0.0) these are worse than a password-protected datastore: many
// ship with a default or no login. Kept DISJOINT from DB_CACHE_IMAGE so a given
// service produces at most one exposure finding (datastore=warn, panel=error).
const ADMIN_PANEL_IMAGE =
	/(?:^|\/)(adminer|phpmyadmin|pgadmin\d?|portainer(?:-ce|-ee)?|cloudbeaver|mongo-express|redis-?commander|dpage\/pgadmin\d?)(?::|$)/i;

// Env-var NAMES that look like a secret (matched case-insensitively as a whole word part).
// Secret-looking env NAMES. Anchored on word/underscore boundaries so a secret word
// must be a whole segment (matches DB_PASSWORD, API_KEY; not TOKENIZED, PASSWORD_POLICY-
// style substrings). Plural credentials allowed.
const SECRET_NAME =
	/(^|[_-])(password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|token|credentials?)([_-]|$)/i;
// `*_FILE` / `*_PATH` name a file to READ the secret from - that's the SAFE pattern
// (Docker/compose secrets), so don't flag those even if the name contains "password".
const SECRET_FILE_REF = /(_file|_path)$/i;

// Dockhand's own image (any registry prefix / tag). A stack deploying Dockhand
// legitimately needs the Docker socket, so the socket-mount rule treats it as
// info, not a misconfiguration.
const DOCKHAND_IMAGE = /(?:^|\/)(?:fin?sys\/)?dockhand(?::|$)/i;

// Host paths that must never be bind-mounted writable - a rw mount here = own the host.
const SENSITIVE_HOST_ROOTS = ['/', '/etc', '/usr', '/bin', '/sbin', '/boot', '/lib', '/var', '/root'];

// Linux capabilities that approach privileged.
const DANGEROUS_CAPS = new Set(['ALL', 'SYS_ADMIN', 'NET_ADMIN', 'SYS_PTRACE', 'SYS_MODULE', 'DAC_READ_SEARCH']);

/**
 * Iterate a service `environment:` as [key, value, index] regardless of the two forms:
 * a mapping ({KEY: val}) or a list of "KEY=val" strings. `value` is null when absent
 * (list entry with no '=', or mapping value null). `index` is the list position for
 * lineOf, or the key for the mapping form.
 */
function envEntries(svc: Record<string, unknown>): { key: string; value: string | null; at: string | number }[] {
	const env = svc.environment;
	const out: { key: string; value: string | null; at: string | number }[] = [];
	if (Array.isArray(env)) {
		env.forEach((e, i) => {
			if (typeof e !== 'string') return;
			const eq = e.indexOf('=');
			out.push(eq === -1 ? { key: e, value: null, at: i } : { key: e.slice(0, eq), value: e.slice(eq + 1), at: i });
		});
	} else {
		const rec = asRecord(env);
		if (rec) for (const [k, v] of Object.entries(rec)) out.push({ key: k, value: v == null ? null : String(v), at: k });
	}
	return out;
}

// A short-form volume's option field is the last ':'-segment, a comma list
// ("ro", "ro,z", "z,ro", "rw"). Read-only if it contains the `ro` option.
function optsAreReadonly(optField: string): boolean {
	return optField.split(',').some((o) => o.trim() === 'ro');
}

/** The bind SOURCE (host side) of a volume entry, short or long form; null if not a bind. */
function bindSource(v: unknown): { source: string; readonly: boolean } | null {
	if (typeof v === 'string') {
		const parts = v.split(':');
		if (parts.length < 2) return null; // anonymous volume, not a bind
		const source = parts[0];
		if (!source.startsWith('/') && !source.startsWith('.') && !source.startsWith('~')) return null; // named volume
		// The option field only exists when there are 3+ segments (src:dst:opts).
		return { source, readonly: parts.length >= 3 && optsAreReadonly(parts[parts.length - 1]) };
	}
	const o = asRecord(v);
	if (o?.type === 'bind' && typeof o.source === 'string') {
		return { source: o.source, readonly: o.read_only === true };
	}
	return null;
}

// --- Docker socket-proxy classifier (adapted from sencho #1791) ------------------
//
// A well-configured docker-socket-proxy sidecar is intentional, not a footgun, so
// it must not be flagged like a direct socket mount. These pure helpers read the
// RAW parsed compose (we have no rendered effective model in this linter), so
// per-network `internal:` is read literally from the top-level networks: block.

const SOCKET_PROXY_IMAGE_HINTS = [
	'tecnativa/docker-socket-proxy',
	'lscr.io/linuxserver/socket-proxy',
	'docker-socket-proxy'
];

// docker-socket-proxy API-group env flags. A group is "enabled" only when its
// rendered value is exactly `1` (proxy convention); key presence alone is not.
const PROXY_API_FLAGS = new Set([
	'CONTAINERS', 'IMAGES', 'INFO', 'EVENTS', 'NETWORKS', 'VOLUMES', 'SERVICES',
	'TASKS', 'NODES', 'SECRETS', 'CONFIGS', 'SWARM', 'SYSTEM', 'BUILD', 'COMMIT',
	'DISTRIBUTION', 'EXEC', 'PING', 'PLUGINS', 'SESSION', 'POST', 'DELETE'
]);
const MUTATING_PROXY_API_FLAGS = new Set(['POST', 'DELETE']);

/** All docker.sock bind mounts of a service (short or long form). */
function socketBinds(svc: Record<string, unknown>): { readonly: boolean }[] {
	const vols = Array.isArray(svc.volumes) ? svc.volumes : [];
	const out: { readonly: boolean }[] = [];
	for (const v of vols) {
		const src = typeof v === 'string' ? v : asRecord(v)?.source;
		if (typeof src === 'string' && src.includes('docker.sock')) {
			const raw = typeof v === 'string' ? v : '';
			const parts = raw.split(':');
			const readonly =
				(parts.length >= 3 && optsAreReadonly(parts[parts.length - 1])) ||
				asRecord(v)?.read_only === true;
			out.push({ readonly });
		}
	}
	return out;
}

function mountsDockerSocket(svc: Record<string, unknown>): boolean {
	return socketBinds(svc).length > 0;
}

/** The enabled proxy API-group flag NAMES (value exactly `1`). */
function enabledProxyApiFlags(svc: Record<string, unknown>): string[] {
	return envEntries(svc)
		.filter((e) => PROXY_API_FLAGS.has(e.key.toUpperCase()) && e.value?.trim() === '1')
		.map((e) => e.key.toUpperCase());
}

function hasSocketProxyImage(svc: Record<string, unknown>): boolean {
	const image = typeof svc.image === 'string' ? svc.image.toLowerCase() : '';
	return SOCKET_PROXY_IMAGE_HINTS.some((h) => image.includes(h));
}

function hasSocketProxyNameHint(name: string, svc: Record<string, unknown>): boolean {
	const cn = typeof svc.container_name === 'string' ? svc.container_name : '';
	return `${name} ${cn}`.toLowerCase().replace(/[_.]/g, '-').includes('socket-proxy');
}

/**
 * Is this service a dedicated Docker socket proxy? A known image is an artifact
 * identity, so it stands alone. A service NAME is author-controlled free text, so
 * it only counts with an observable fact (a read-only socket, or >=1 enabled API
 * flag). With neither name nor image hint, require both. Prefer false negatives:
 * a miss keeps the high direct-mount finding.
 */
function isSocketProxyService(name: string, svc: Record<string, unknown>): boolean {
	if (!mountsDockerSocket(svc)) return false;
	if (hasSocketProxyImage(svc)) return true;
	const readOnly = socketBinds(svc).some((b) => b.readonly);
	const apiKeyCount = enabledProxyApiFlags(svc).length;
	if (hasSocketProxyNameHint(name, svc)) return readOnly || apiKeyCount >= 1;
	return readOnly && apiKeyCount >= 2;
}

/** The service NAMES that are classified socket proxies in this compose. */
function socketProxyNames(p: ParsedCompose): string[] {
	return Object.entries(services(p))
		.filter(([name, svc]) => isSocketProxyService(name, svc))
		.map(([name]) => name);
}

/** Network keys a service is attached to (array or map form); empty = implicit default. */
function serviceNetworkKeys(svc: Record<string, unknown>): string[] {
	const nets = svc.networks;
	if (Array.isArray(nets)) return nets.filter((n): n is string => typeof n === 'string');
	const rec = asRecord(nets);
	return rec ? Object.keys(rec) : [];
}

/**
 * True unless EVERY network the proxy joins is declared `internal: true` in the
 * top-level networks: block. No membership -> implicit default network (not
 * internal). A network the file does not describe cannot be shown internal.
 * NOTE: reads the LITERAL source networks: block, not a merged/extends model.
 */
function proxyAttachesNonInternalNetwork(p: ParsedCompose, svc: Record<string, unknown>): boolean {
	const keys = serviceNetworkKeys(svc);
	if (keys.length === 0) return true;
	const topNets = asRecord(p.doc?.networks) ?? {};
	return keys.some((k) => asRecord(topNets[k])?.internal !== true);
}

/** tcp:// hosts a service points its Docker client at (DOCKER_HOST env + tcp in command). */
function dockerEndpointHosts(svc: Record<string, unknown>): string[] {
	const hosts: string[] = [];
	for (const e of envEntries(svc)) {
		if (e.key.toUpperCase() === 'DOCKER_HOST' && e.value) {
			const m = /tcp:\/\/([^:/\s]+)/i.exec(e.value);
			if (m) hosts.push(m[1].toLowerCase());
		}
	}
	const cmd = svc.command;
	const cmdStr = Array.isArray(cmd) ? cmd.join(' ') : typeof cmd === 'string' ? cmd : '';
	for (const m of cmdStr.matchAll(/tcp:\/\/([^:/\s]+)/gi)) hosts.push(m[1].toLowerCase());
	return hosts;
}

/** Names a dependent could use to reach this proxy on a shared network. */
function proxyReachableNames(name: string, svc: Record<string, unknown>): string[] {
	const out = [name.toLowerCase()];
	if (typeof svc.container_name === 'string') out.push(svc.container_name.toLowerCase());
	// network aliases (map form: networks: { net: { aliases: [...] } })
	const rec = asRecord(svc.networks);
	if (rec) {
		for (const membership of Object.values(rec)) {
			const aliases = asRecord(membership)?.aliases;
			if (Array.isArray(aliases)) for (const a of aliases) if (typeof a === 'string') out.push(a.toLowerCase());
		}
	}
	return out;
}

// --- rule catalog ---------------------------------------------------------------

export const RULES: RuleDefinition[] = [
	{
		id: 'NO_SERVICES',
		description: '该 Compose 文件未定义任何服务',
		group: 'correctness',
		defaultSeverity: 'error',
		check(p) {
			if (!p.doc) return [];
			if (Object.keys(services(p)).length === 0) {
				return [
					{
						ruleId: 'NO_SERVICES',
						message: '未定义任何服务 — 该 Compose 文件部署后不会运行任何容器',
						hint: '添加 `services:` 配置块，或检查配置项是否存在拼写错误。',
						line: p.lineOf(['services'])
					}
				];
			}
			return [];
		}
	},
	{
		id: 'DUPLICATE_HOST_PORT',
		description: '当前堆栈内两个服务发布了相同的主机端口',
		group: 'correctness',
		defaultSeverity: 'error',
		check(p) {
			const out: RuleFinding[] = [];
			const seen = new Map<number, string>();
			for (const [name, svc] of Object.entries(services(p))) {
				for (let i = 0; i < ports(svc).length; i++) {
					const parsed = parsePortEntry(ports(svc)[i]);
					if (!parsed?.hostPort) continue;
					const prev = seen.get(parsed.hostPort);
					if (prev && prev !== name) {
						out.push({
							ruleId: 'DUPLICATE_HOST_PORT',
							service: name,
							message: `主机端口 ${parsed.hostPort} 已被服务 "${prev}" 占用`,
							hint: '多个服务不能绑定同一个主机端口，请修改其中一个端口。',
							line: p.lineOf(['services', name, 'ports', i]) ?? p.lineOf(['services', name])
						});
					} else if (!prev) {
						seen.set(parsed.hostPort, name);
					}
				}
			}
			return out;
		}
	},
	{
		id: 'CROSS_STACK_PORT_COLLISION',
		description: '该主机端口已被环境内其他容器占用',
		group: 'correctness',
		defaultSeverity: 'error',
		check(p, ctx) {
			if (!ctx.usedHostPorts || ctx.usedHostPorts.size === 0) return [];
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				for (let i = 0; i < ports(svc).length; i++) {
					const parsed = parsePortEntry(ports(svc)[i]);
					if (parsed?.hostPort && ctx.usedHostPorts.has(parsed.hostPort)) {
						const owner = ctx.hostPortOwners?.get(parsed.hostPort);
						out.push({
							ruleId: 'CROSS_STACK_PORT_COLLISION',
							service: name,
							message: owner
								? `主机端口 ${parsed.hostPort} 已被当前环境内容器 "${owner}" 占用`
								: `主机端口 ${parsed.hostPort} 已被当前环境内其他容器占用`,
							hint: owner
								? `选择一个未占用的主机端口，或停止容器 "${owner}".`
								: '选择一个未占用的主机端口，或停止占用该端口的容器。',
							line: p.lineOf(['services', name, 'ports', i]) ?? p.lineOf(['services', name])
						});
					}
				}
			}
			return out;
		}
	},
	{
		id: 'DB_PORT_ON_ALL_INTERFACES',
		description: '数据库/缓存服务在所有网卡上对外开放端口',
		group: 'security',
		defaultSeverity: 'warn',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				const image = typeof svc.image === 'string' ? svc.image : '';
				if (!DB_CACHE_IMAGE.test(image)) continue;
				for (let i = 0; i < ports(svc).length; i++) {
					const entry = ports(svc)[i];
					const parsed = parsePortEntry(entry);
					if (parsed?.hostPort && (!parsed.hostIp || parsed.hostIp === '0.0.0.0')) {
						const line = p.lineOf(['services', name, 'ports', i]);
						// A fix is only unambiguous for the short string form ("5432:5432" ->
						// "127.0.0.1:5432:5432"). "0.0.0.0:..." is replaced in place; the long
						// object form has no single-token edit, so it gets no fix.
						let fix: RuleFinding['fix'];
						if (line && typeof entry === 'string') {
							const replaceTok =
								parsed.hostIp === '0.0.0.0'
									? entry.replace(/^0\.0\.0\.0:/, '127.0.0.1:')
									: `127.0.0.1:${entry}`;
							// Anchor to this entry's column so a short port that is a substring
							// of an earlier port token on the same (flow) line isn't corrupted.
							const at = p.columnOf(['services', name, 'ports', i]);
							fix = { kind: 'replace-in-line', line, find: entry, replace: replaceTok, at };
						}
						out.push({
							ruleId: 'DB_PORT_ON_ALL_INTERFACES',
							service: name,
							message: `数据库/缓存服务 "${name}" 在所有网卡上发布端口 ${parsed.hostPort}`,
							hint: '绑定至 127.0.0.1 (例如 "127.0.0.1:5432:5432") ，或移除主机端口映射，通过 Compose 内网访问。',
							line: line ?? p.lineOf(['services', name]),
							fix,
							fixDescription: '将此端口绑定至 127.0.0.1 (仅本地访问)'
						});
					}
				}
			}
			return out;
		}
	},
	{
		id: 'DEPENDS_ON_UNDEFINED',
		description: 'depends_on 引用了文件中未定义的服务',
		group: 'correctness',
		defaultSeverity: 'error',
		check(p) {
			const out: RuleFinding[] = [];
			const svcNames = new Set(Object.keys(services(p)));
			for (const [name, svc] of Object.entries(services(p))) {
				const dep = svc.depends_on;
				const deps = Array.isArray(dep)
					? dep
					: dep && typeof dep === 'object'
						? Object.keys(dep as Record<string, unknown>)
						: [];
				for (const d of deps) {
					if (typeof d === 'string' && !svcNames.has(d)) {
						out.push({
							ruleId: 'DEPENDS_ON_UNDEFINED',
							service: name,
							message: `"${name}" 通过 depends_on 依赖 "${d}"，但该服务未在本文件中定义`,
							hint: '修正服务名称，或补充定义对应的服务。',
							line: p.lineOf(['services', name, 'depends_on']) ?? p.lineOf(['services', name])
						});
					}
				}
			}
			return out;
		}
	},
	{
		id: 'UNDEFINED_NETWORK_REF',
		description: '服务引用了未在顶层定义的网络',
		group: 'correctness',
		defaultSeverity: 'error',
		check(p) {
			const defined = new Set(Object.keys(asRecord(p.doc?.networks) ?? {}));
			// The implicit `default` network always exists.
			defined.add('default');
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				const nets = svc.networks;
				const refs = Array.isArray(nets)
					? nets
					: nets && typeof nets === 'object'
						? Object.keys(nets as Record<string, unknown>)
						: [];
				for (const ref of refs) {
					if (typeof ref === 'string' && !defined.has(ref)) {
						out.push({
							ruleId: 'UNDEFINED_NETWORK_REF',
							service: name,
							message: `"${name}" 使用网络 "${ref}"，该网络未在顶层 networks 配置中定义:`,
							hint: `在顶层 networks 下添加 "${ref}" (如果主机上已存在该网络，请标记 external: true)。`,
							line: p.lineOf(['services', name, 'networks']) ?? p.lineOf(['services', name])
						});
					}
				}
			}
			return out;
		}
	},
	{
		id: 'UNDEFINED_VOLUME_REF',
		description: '服务挂载了未在顶层定义的命名数据卷',
		group: 'correctness',
		defaultSeverity: 'error',
		check(p) {
			const defined = new Set(Object.keys(asRecord(p.doc?.volumes) ?? {}));
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				const vols = Array.isArray(svc.volumes) ? svc.volumes : [];
				for (let i = 0; i < vols.length; i++) {
					const v = vols[i];
					// A NAMED volume source is a bare token (no '/' or '.') on the left of ':'
					// in short form, or a { type: volume, source } in long form. Bind mounts
					// (paths) are not named volumes and are exempt.
					let src: string | null = null;
					if (typeof v === 'string') {
						const left = v.split(':')[0];
						if (left && !left.startsWith('/') && !left.startsWith('.') && !left.startsWith('~')) {
							src = left;
						}
					} else {
						const o = asRecord(v);
						if (o?.type === 'volume' && typeof o.source === 'string') src = o.source;
					}
					if (src && !defined.has(src)) {
						out.push({
							ruleId: 'UNDEFINED_VOLUME_REF',
							service: name,
							message: `"${name}" 挂载命名数据卷 "${src}"，该数据卷未在顶层 volumes 配置中定义`,
							hint: `在顶层 volumes 下添加 "${src}" (如果主机上已存在该数据卷，请标记 external: true)。`,
							line: p.lineOf(['services', name, 'volumes', i]) ?? p.lineOf(['services', name])
						});
					}
				}
			}
			return out;
		}
	},
	{
		id: 'CONTAINER_NAME_COLLISION',
		description: 'container_name 已被环境内现有容器占用',
		group: 'correctness',
		defaultSeverity: 'error',
		check(p, ctx) {
			if (!ctx.existingContainerNames || ctx.existingContainerNames.size === 0) return [];
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				const cn = svc.container_name;
				if (typeof cn === 'string' && ctx.existingContainerNames.has(cn)) {
					out.push({
						ruleId: 'CONTAINER_NAME_COLLISION',
						service: name,
						message: `容器名称 "${cn}" 已被当前环境内的容器占用`,
						hint: '固定 container_name 会导致容器无法正常重建，请移除该配置或使用唯一名称。',
						line: p.lineOf(['services', name, 'container_name']) ?? p.lineOf(['services', name])
					});
				}
			}
			return out;
		}
	},
	{
		id: 'MISSING_EXTERNAL_RESOURCE',
		description: '外部网络/数据卷在当前环境中不存在',
		group: 'correctness',
		defaultSeverity: 'error',
		check(p, ctx) {
			const out: RuleFinding[] = [];
			const check = (kind: 'networks' | 'volumes', existing: Set<string> | undefined) => {
				if (!existing) return;
				const block = asRecord(p.doc?.[kind]);
				if (!block) return;
				for (const [resName, def] of Object.entries(block)) {
					const d = asRecord(def);
					if (d?.external === true || asRecord(d?.external)) {
						const actual =
							(asRecord(d?.external)?.name as string) ||
							(typeof d?.name === 'string' ? (d.name as string) : resName);
						if (!existing.has(actual)) {
							out.push({
								ruleId: 'MISSING_EXTERNAL_RESOURCE',
								message: `外部${kind === 'networks' ? '网络' : '数据卷'} "${actual}" 在当前环境不存在`,
								hint: '先创建该资源，或删除 external: true 由 Compose 自动创建。',
								line: p.lineOf([kind, resName])
							});
						}
					}
				}
			};
			check('networks', ctx.existingNetworks);
			check('volumes', ctx.existingVolumes);
			return out;
		}
	},
	{
		id: 'LATEST_TAG',
		description: '镜像使用 :latest 标签或未指定标签',
		group: 'reliability',
		defaultSeverity: 'warn',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				const image = typeof svc.image === 'string' ? svc.image : '';
				if (!image) continue;
				const afterSlash = image.substring(image.lastIndexOf('/') + 1);
				const tag = afterSlash.includes(':') ? afterSlash.split(':').pop() : '';
				if (!tag || tag === 'latest') {
					out.push({
						ruleId: 'LATEST_TAG',
						service: name,
						message: `"${name}" 使用了${tag ? '`:latest`' : '无标签镜像'} (${image})`,
						hint: '锁定具体版本标签，保证部署可复现，同时支持新版本检测。',
						line: p.lineOf(['services', name, 'image']) ?? p.lineOf(['services', name])
					});
				}
			}
			return out;
		}
	},
	{
		id: 'PRIVILEGED_CONTAINER',
		description: '服务以特权模式运行 (拥有主机完整访问权限)',
		group: 'security',
		defaultSeverity: 'warn',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				if (svc.privileged === true) {
					out.push({
						ruleId: 'PRIVILEGED_CONTAINER',
						service: name,
						message: `"${name}" 以特权模式运行 (拥有主机完整访问权限)`,
						hint: '如非必要，请使用 cap_add 授予最小权限，而非开启特权模式。',
						line: p.lineOf(['services', name, 'privileged']) ?? p.lineOf(['services', name])
					});
				}
			}
			return out;
		}
	},
	{
		id: 'DOCKER_SOCKET_MOUNT',
		description: '服务挂载了 Docker socket',
		group: 'security',
		defaultSeverity: 'warn', // graded: the check upgrades rw to error itself
		check(p) {
			const out: RuleFinding[] = [];
			const proxies = socketProxyNames(p);
			// When the stack already runs a proxy, point a direct-mount finding at it
			// instead of telling the user to adopt something they already have.
			const proxyHint =
				proxies.length > 0
					? `该堆栈已运行 socket 代理(${proxies.map((n) => `"${n}"`).join(', ')}); 请将此服务通过该代理访问，不要直接挂载 docker.sock。`
					: '读写权限的 docker.sock 等同于宿主机 root 权限。请使用具备权限隔离的 socket 代理。';
			for (const [name, svc] of Object.entries(services(p))) {
				// A classified socket proxy legitimately mounts the socket - the
				// docker-socket-proxy* rules cover it, so skip it here.
				if (isSocketProxyService(name, svc)) continue;
				// Dockhand itself REQUIRES the socket (rw) to manage Docker, so a stack
				// that deploys Dockhand is not a footgun - info note, not error.
				const image = typeof svc.image === 'string' ? svc.image : '';
				const isDockhand = DOCKHAND_IMAGE.test(image);
				const vols = Array.isArray(svc.volumes) ? svc.volumes : [];
				for (let i = 0; i < vols.length; i++) {
					const v = vols[i];
					const src = typeof v === 'string' ? v : asRecord(v)?.source;
					const raw = typeof v === 'string' ? v : '';
					if (typeof src === 'string' && src.includes('docker.sock')) {
						// Read-only if the short-form option field contains `ro` (ro / ro,z /
						// z,ro), or the long form sets read_only. Only 3+ segments have opts.
						const parts = raw.split(':');
						const readonly =
							(parts.length >= 3 && optsAreReadonly(parts[parts.length - 1])) ||
							asRecord(v)?.read_only === true;
						const line = p.lineOf(['services', name, 'volumes', i]) ?? p.lineOf(['services', name]);
						if (isDockhand) {
							out.push({
								ruleId: 'DOCKER_SOCKET_MOUNT',
								severity: 'info',
								service: name,
								message: `"${name}" 为 Dockhand 服务并挂载了 Docker socket — 该配置为必需配置，不属于错误配置`,
								hint: 'Dockhand 需要 socket 来管理 Docker。如需强化安全，请在前端部署具备权限隔离的 socket 代理。',
								line
							});
						} else {
							out.push({
								ruleId: 'DOCKER_SOCKET_MOUNT',
								severity: readonly ? 'warn' : 'error',
								service: name,
								message: `"${name}" 挂载了 Docker socket${readonly ? '(只读)' : '读写 (完整守护进程控制权)'}`,
								hint: readonly ? '只读模式依旧会暴露守护进程；建议使用 socket 代理。' : proxyHint,
								line
							});
						}
					}
				}
			}
			return out;
		}
	},
	{
		id: 'DOCKER_SOCKET_PROXY',
		description: '检测到 Docker socket 代理附属容器 (主动配置)',
		group: 'security',
		defaultSeverity: 'info',
		check(p) {
			const out: RuleFinding[] = [];
			for (const name of socketProxyNames(p)) {
				out.push({
					ruleId: 'DOCKER_SOCKET_PROXY',
					service: name,
					message: `"${name}" 是 Docker socket 代理 — 该服务主动挂载 socket，用于向其他服务提供受限制的 API`,
					hint: '请将代理置于内部网络，不要对外发布端口，并且仅启用依赖服务所必需的 API 分组。',
					line: p.lineOf(['services', name])
				});
			}
			return out;
		}
	},
	{
		id: 'DOCKER_SOCKET_PROXY_WRITABLE',
		description: 'Docker socket 代理以读写模式挂载 socket',
		group: 'security',
		defaultSeverity: 'error',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				if (!isSocketProxyService(name, svc)) continue;
				if (!socketBinds(svc).some((b) => !b.readonly)) continue;
				out.push({
					ruleId: 'DOCKER_SOCKET_PROXY_WRITABLE',
					service: name,
					message: `socket 代理 "${name}" 以读写模式挂载 docker.sock — 代理一旦被攻陷将获得宿主机完整控制权`,
					hint: '在 socket 挂载后追加 `:ro`，依靠 API 分组标志实现权限限制。',
					line: p.lineOf(['services', name, 'volumes']) ?? p.lineOf(['services', name])
				});
			}
			return out;
		}
	},
	{
		id: 'DOCKER_SOCKET_PROXY_PUBLISHED',
		description: 'Docker socket 代理发布了宿主机端口',
		group: 'security',
		defaultSeverity: 'error',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				if (!isSocketProxyService(name, svc)) continue;
				const hasPublished = ports(svc).some((e) => {
					const parsed = parsePortEntry(e);
					return parsed?.hostPort != null;
				});
				if (!hasPublished) continue;
				out.push({
					ruleId: 'DOCKER_SOCKET_PROXY_PUBLISHED',
					service: name,
					message: `socket 代理 "${name}" 将端口发布到宿主机，代理后的 Docker API 可被 compose 堆栈网络之外访问`,
					hint: '移除宿主机端口映射；依赖服务仅允许通过内部 compose 堆栈网络访问代理。',
					line: p.lineOf(['services', name, 'ports']) ?? p.lineOf(['services', name])
				});
			}
			return out;
		}
	},
	{
		id: 'DOCKER_SOCKET_PROXY_MUTATING',
		description: 'Docker socket 代理允许执行修改类 (POST/DELETE) API 操作',
		group: 'security',
		defaultSeverity: 'warn',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				if (!isSocketProxyService(name, svc)) continue;
				const mutating = enabledProxyApiFlags(svc).filter((f) => MUTATING_PROXY_API_FLAGS.has(f));
				if (mutating.length === 0) continue;
				out.push({
					ruleId: 'DOCKER_SOCKET_PROXY_MUTATING',
					service: name,
					message: `socket 代理 "${name}" 已开启 ${mutating.join(' 和 ')} — 依赖服务可通过代理执行写入/删除操作`,
					hint: '除非依赖服务确实需要修改类 Docker API 调用，否则请禁用 POST 和 DELETE。',
					line: p.lineOf(['services', name])
				});
			}
			return out;
		}
	},
	{
		id: 'DOCKER_SOCKET_PROXY_EXPOSURE',
		description: 'Docker socket 代理接入非内部网络',
		group: 'security',
		defaultSeverity: 'warn',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				if (!isSocketProxyService(name, svc)) continue;
				if (!proxyAttachesNonInternalNetwork(p, svc)) continue;
				out.push({
					ruleId: 'DOCKER_SOCKET_PROXY_EXPOSURE',
					service: name,
					message: `Socket 代理 "${name}" 接入未标记为 internal: true 的网络，扩大了代理 Docker API 的可访问范围`,
					hint: '代理仅应接入受信任依赖服务所使用、设置 internal: true 的 compose 堆栈网络。',
					line: p.lineOf(['services', name, 'networks']) ?? p.lineOf(['services', name])
				});
			}
			return out;
		}
	},
	{
		id: 'DOCKER_SOCKET_PROXY_CLIENT',
		description: '服务通过 socket 代理访问 Docker，而非直接挂载 socket',
		group: 'security',
		defaultSeverity: 'info',
		check(p) {
			const proxyEntries = Object.entries(services(p)).filter(([n, s]) => isSocketProxyService(n, s));
			if (proxyEntries.length === 0) return [];
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				if (mountsDockerSocket(svc)) continue; // it mounts directly - not a proxy client
				const hosts = new Set(dockerEndpointHosts(svc));
				if (hosts.size === 0) continue;
				const svcNets = serviceNetworkKeys(svc);
				const isClient = proxyEntries.some(([pn, ps]) => {
					const reach = proxyReachableNames(pn, ps);
					if (!reach.some((r) => hosts.has(r))) return false;
					const proxyNets = serviceNetworkKeys(ps);
					// Empty membership on either side = implicit default; match only if BOTH default.
					if (svcNets.length === 0 || proxyNets.length === 0) return svcNets.length === 0 && proxyNets.length === 0;
					return svcNets.some((n) => proxyNets.includes(n));
				});
				if (!isClient) continue;
				out.push({
					ruleId: 'DOCKER_SOCKET_PROXY_CLIENT',
					service: name,
					message: `"${name}" 通过 socket 代理访问 Docker，没有直接挂载 docker.sock — 属于更安全的实现方式`,
					line: p.lineOf(['services', name])
				});
			}
			return out;
		}
	},
	{
		id: 'OBSOLETE_VERSION_KEY',
		description: '顶层 version: 配置项已废弃',
		group: 'schema',
		defaultSeverity: 'info',
		check(p) {
			if (p.doc && 'version' in p.doc) {
				const line = p.lineOf(['version']);
				return [
					{
						ruleId: 'OBSOLETE_VERSION_KEY',
						message: 'Compose 规范中顶层 `version:` 配置项已废弃，将会被忽略',
						hint: '可以安全删除。',
						line,
						fix: line ? { kind: 'delete-line', line } : undefined,
						fixDescription: '移除已废弃的 version: 配置行'
					}
				];
			}
			return [];
		}
	},
	{
		id: 'UNKNOWN_SERVICE_KEY',
		description: '服务配置项疑似合法 Compose 配置的拼写错误',
		group: 'schema',
		defaultSeverity: 'warn',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				for (const key of Object.keys(svc)) {
					const suggestion = isLikelyTypo(key, SERVICE_KEYS);
					if (suggestion) {
						const line = p.lineOf(['services', name, key]);
						out.push({
							ruleId: 'UNKNOWN_SERVICE_KEY',
							service: name,
							message: `"${key}" 不是合法的服务配置项 — 是否应为 "${suggestion}"？`,
							hint: 'Docker 会静默忽略未知配置项，该设置不会生效。',
							line: line ?? p.lineOf(['services', name]),
							fix: line ? { kind: 'replace-in-line', line, find: key, replace: suggestion } : undefined,
							fixDescription: `将 "${key}" 重命名为 "${suggestion}"`
						});
					}
				}
			}
			return out;
		}
	},
	{
		id: 'UNKNOWN_TOP_LEVEL_KEY',
		description: '顶层配置项疑似拼写错误',
		group: 'schema',
		defaultSeverity: 'warn',
		check(p) {
			if (!p.doc) return [];
			const out: RuleFinding[] = [];
			for (const key of Object.keys(p.doc)) {
				if (key.startsWith('x-')) continue;
				const suggestion = isLikelyTypo(key, TOP_LEVEL_KEYS);
				if (suggestion) {
					const line = p.lineOf([key]);
					out.push({
						ruleId: 'UNKNOWN_TOP_LEVEL_KEY',
						message: `顶层配置项 "${key}" 不是合法配置 — 是否应为 "${suggestion}"？`,
						line,
						fix: line ? { kind: 'replace-in-line', line, find: key, replace: suggestion } : undefined,
						fixDescription: `将 "${key}" 重命名为 "${suggestion}"`
					});
				}
			}
			return out;
		}
	},
	{
		id: 'SECRET_IN_ENVIRONMENT',
		description: '密钥类明文硬编码在 environment 中，应使用密钥或 ${VAR} 引用',
		group: 'security',
		defaultSeverity: 'warn',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				for (const { key, value, at } of envEntries(svc)) {
					if (value == null || value === '') continue;
					// A ${VAR} interpolation is exactly the safe pattern - never flag it.
					if (value.includes('${')) continue;
					if (!SECRET_NAME.test(key)) continue;
					// *_FILE / *_PATH point at a file to read the secret from - safe.
					if (SECRET_FILE_REF.test(key)) continue;
					// A numeric/boolean value isn't a credential - it's a policy/flag
					// (PASSWORD_POLICY_DAYS=30, TOKEN_ENABLED=true), so don't flag it.
					if (/^(true|false|\d+)$/i.test(value.trim())) continue;
					out.push({
						ruleId: 'SECRET_IN_ENVIRONMENT',
						service: name,
						message: `"${name}" 在 environment 中硬编码了密钥类变量 ${key}`,
						hint: '将密钥存入 Dockhand 密钥管理并使用 ${' + key + '} 引用，避免明文保存在 Compose/.env 文件中。',
						line: p.lineOf(['services', name, 'environment', at]) ?? p.lineOf(['services', name])
					});
				}
			}
			return out;
		}
	},
	{
		id: 'HOST_NETWORK_MODE',
		description: '服务使用 network_mode: host (无网络隔离)',
		group: 'security',
		defaultSeverity: 'warn',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				if (svc.network_mode === 'host') {
					out.push({
						ruleId: 'HOST_NETWORK_MODE',
						service: name,
						message: `"${name}" 使用 network_mode: host — 与主机共享网络，不存在网络隔离`,
						hint: '按需发布所需端口，让容器运行在独立网络中。',
						line: p.lineOf(['services', name, 'network_mode']) ?? p.lineOf(['services', name])
					});
				}
			}
			return out;
		}
	},
	{
		id: 'WRITABLE_ROOT_MOUNT',
		description: '敏感主机路径被绑定挂载 (可写挂载会导致主机完全失陷)',
		group: 'security',
		defaultSeverity: 'error', // graded: ro is downgraded to warn by the check
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				const vols = Array.isArray(svc.volumes) ? svc.volumes : [];
				for (let i = 0; i < vols.length; i++) {
					const bind = bindSource(vols[i]);
					if (!bind) continue;
					// docker.sock has its own dedicated rule; don't double-report it here.
					if (bind.source.includes('/var/run/docker.sock')) continue;
					const normalized = bind.source.replace(/\/+$/, '') || '/';
					if (!SENSITIVE_HOST_ROOTS.includes(normalized)) continue;
					out.push({
						ruleId: 'WRITABLE_ROOT_MOUNT',
						severity: bind.readonly ? 'warn' : 'error',
						service: name,
						message: `"${name}" 绑定挂载主机路径 "${bind.source}"${bind.readonly ? ' (只读)' : ' 读写'}`,
						hint: bind.readonly
							? '即使只读挂载，依然会暴露主机系统文件；请仅挂载所需子目录。'
							: '系统路径可写挂载允许容器修改主机文件，请挂载指定子目录并使用只读模式。',
						line: p.lineOf(['services', name, 'volumes', i]) ?? p.lineOf(['services', name])
					});
				}
			}
			return out;
		}
	},
	{
		id: 'CAP_ADD_DANGEROUS',
		description: '服务添加了高风险 Linux 能力，近似特权模式',
		group: 'security',
		defaultSeverity: 'warn',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				const caps = Array.isArray(svc.cap_add) ? svc.cap_add : [];
				for (let i = 0; i < caps.length; i++) {
					const cap = typeof caps[i] === 'string' ? (caps[i] as string).toUpperCase() : '';
					if (DANGEROUS_CAPS.has(cap)) {
						out.push({
							ruleId: 'CAP_ADD_DANGEROUS',
							service: name,
							message: `"${name}" 授予 ${cap} 权限 (近似特权模式)`,
							hint: '仅授予业务实际必需的最小权限。',
							line: p.lineOf(['services', name, 'cap_add', i]) ?? p.lineOf(['services', name])
						});
					}
				}
			}
			return out;
		}
	},
	{
		id: 'MISSING_RESTART_POLICY',
		description: '服务未配置重启策略 (主机重启后不会自动拉起)',
		group: 'reliability',
		defaultSeverity: 'info',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				if ('restart' in svc) continue;
				// Compose Spec: deploy.restart_policy is the swarm-mode equivalent.
				const deploy = asRecord(svc.deploy);
				if (deploy && 'restart_policy' in deploy) continue;

				const svcLine = p.lineOf(['services', name]);
				const firstKey = Object.keys(svc)[0];
				// Only offer an insert-after fix for a BLOCK-style service (children on
				// their own lines). A flow map (`web: {}` or `web: {image: x}`) has no
				// child line to insert under - splicing `restart:` there produces invalid
				// YAML - so those get the finding but no fix.
				const firstKeyLine = firstKey ? p.lineOf(['services', name, firstKey]) : undefined;
				const isBlockService = firstKeyLine != null && svcLine != null && firstKeyLine > svcLine;
				const childIndent = (firstKey ? p.indentOf(['services', name, firstKey]) : undefined) ?? 0;
				const fix =
					isBlockService && childIndent > 0
						? ({
								kind: 'insert-after',
								line: svcLine!,
								text: `${' '.repeat(childIndent)}restart: unless-stopped`
							} as const)
						: undefined;
				out.push({
					ruleId: 'MISSING_RESTART_POLICY',
					service: name,
					message: `"${name}" 未配置 restart 重启策略 — 容器崩溃或主机重启后不会自动拉起`,
					hint: '添加 restart: unless-stopped (或 on-failure)，一次性任务除外。',
					line: svcLine,
					fix,
					fixDescription: '加 restart: unless-stopped 重启策略'
				});
			}
			return out;
		}
	},
	{
		id: 'SENSITIVE_SERVICE_BROAD_EXPOSURE',
		description: '管理后台 UI 向全部网络接口发布端口',
		group: 'security',
		defaultSeverity: 'error',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				const image = typeof svc.image === 'string' ? svc.image : '';
				if (!ADMIN_PANEL_IMAGE.test(image)) continue;
				for (let i = 0; i < ports(svc).length; i++) {
					const parsed = parsePortEntry(ports(svc)[i]);
					if (parsed?.hostPort && (!parsed.hostIp || parsed.hostIp === '0.0.0.0')) {
						out.push({
							ruleId: 'SENSITIVE_SERVICE_BROAD_EXPOSURE',
							service: name,
							message: `管理后台 UI "${name}" 在全部网络接口发布端口 ${parsed.hostPort} — 整个网络均可访问`,
							hint: '绑定至 127.0.0.1，通过带鉴权的反向代理访问，或移除宿主机端口映射。',
							line: p.lineOf(['services', name, 'ports', i]) ?? p.lineOf(['services', name])
						});
					}
				}
			}
			return out;
		}
	},
	{
		id: 'ANONYMOUS_VOLUME',
		description: '服务使用匿名数据卷 (数据无固定名称，极易丢失)',
		group: 'reliability',
		defaultSeverity: 'info',
		check(p) {
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				const vols = Array.isArray(svc.volumes) ? svc.volumes : [];
				for (let i = 0; i < vols.length; i++) {
					const v = vols[i];
					// Anonymous = a container path with no source. Short form: a single
					// segment ("/data"), i.e. no ':' mapping. Long form: type volume with
					// no `source`. A bind (./x, /x:/y) or named volume (data:/x) has a
					// source and is NOT anonymous.
					let anon = false;
					if (typeof v === 'string') {
						anon = !v.includes(':');
					} else {
						const o = asRecord(v);
						if (o && (o.type === 'volume' || o.type === undefined) && !o.source) anon = true;
					}
					if (anon) {
						out.push({
							ruleId: 'ANONYMOUS_VOLUME',
							service: name,
							message: `"${name}" 使用匿名数据卷 — 该数据没有固定名称，重建容器后会成为孤立数据`,
							hint: '请使用命名数据卷 (名称:/路径) 或绑定挂载，保证数据可定位与可迁移。',
							line: p.lineOf(['services', name, 'volumes', i]) ?? p.lineOf(['services', name])
						});
					}
				}
			}
			return out;
		}
	},
	{
		id: 'SWARM_ONLY_DEPLOY_KEYS',
		description: '仅 Swarm 模式生效的 deploy.* 配置项，独立版 docker compose 会静默忽略',
		group: 'reliability',
		defaultSeverity: 'warn',
		check(p) {
			// Keys under `deploy:` that ONLY take effect in Swarm mode; `docker
			// compose up` ignores them without warning. Deliberately conservative:
			// deploy.replicas, deploy.mode and deploy.resources ARE partially honored
			// by Compose v2, so they are NOT flagged.
			const SWARM_ONLY = ['placement', 'update_config', 'rollback_config', 'endpoint_mode'];
			const out: RuleFinding[] = [];
			for (const [name, svc] of Object.entries(services(p))) {
				const deploy = asRecord(svc.deploy);
				if (!deploy) continue;
				const present = SWARM_ONLY.filter((k) => k in deploy);
				if (present.length === 0) continue;
				out.push({
					ruleId: 'SWARM_ONLY_DEPLOY_KEYS',
					service: name,
					message: `"${name}" 设置了 deploy.${present.join(', deploy.')} — 独立版 docker compose 会忽略这些配置(仅在 Swarm 模式下生效)`,
					hint: '除非部署到 Swarm，否则请使用顶层等效配置 (例如 cpus:/mem_limit:，或通过命令行设置实例数量)。',
					line: p.lineOf(['services', name, 'deploy']) ?? p.lineOf(['services', name])
				});
			}
			return out;
		}
	}
];
