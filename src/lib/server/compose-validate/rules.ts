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

// Env-var NAMES that look like a secret (matched case-insensitively as a whole word part).
// Secret-looking env NAMES. Anchored on word/underscore boundaries so a secret word
// must be a whole segment (matches DB_PASSWORD, API_KEY; not TOKENIZED, PASSWORD_POLICY-
// style substrings). Plural credentials allowed.
const SECRET_NAME =
	/(^|[_-])(password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|token|credentials?)([_-]|$)/i;
// `*_FILE` / `*_PATH` name a file to READ the secret from - that's the SAFE pattern
// (Docker/compose secrets), so don't flag those even if the name contains "password".
const SECRET_FILE_REF = /(_file|_path)$/i;

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
			for (const [name, svc] of Object.entries(services(p))) {
				const vols = Array.isArray(svc.volumes) ? svc.volumes : [];
				for (let i = 0; i < vols.length; i++) {
					const v = vols[i];
					const src = typeof v === 'string' ? v : asRecord(v)?.source;
					const raw = typeof v === 'string' ? v : '';
					if (typeof src === 'string' && src.includes('/var/run/docker.sock')) {
						// Read-only if the short-form option field contains `ro` (ro / ro,z /
						// z,ro), or the long form sets read_only. Only 3+ segments have opts.
						const parts = raw.split(':');
						const readonly =
							(parts.length >= 3 && optsAreReadonly(parts[parts.length - 1])) ||
							asRecord(v)?.read_only === true;
						out.push({
							ruleId: 'DOCKER_SOCKET_MOUNT',
							severity: readonly ? 'warn' : 'error',
							service: name,
							message: `"${name}" 挂载 Docker socket${readonly ? ' (只读)' : ' 读写 (拥有完整守护进程控制权限)'}`,
							hint: readonly
								? '只读挂载依然会暴露守护进程，建议使用 socket 代理。'
								: '读写 docker.sock 等价于获取主机 root 权限，请使用范围受限的 socket 代理。',
							line: p.lineOf(['services', name, 'volumes', i]) ?? p.lineOf(['services', name])
						});
					}
				}
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
	}
];
