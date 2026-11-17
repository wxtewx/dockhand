export interface SftpRepositoryConfig {
	username: string;
	host: string;
	port: string;
	path: string;
}

export interface SftpCredentialValidationInput {
	repository: string;
	sshPrivateKey?: unknown;
	sshKnownHosts?: unknown;
	hasStoredSshPrivateKey?: boolean;
	hasStoredSshKnownHosts?: boolean;
}

const MAX_SFTP_CREDENTIAL_BYTES = 1024 * 1024;
const PRIVATE_KEY_HEADER = /-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/;
const textEncoder = new TextEncoder();

export function isSftpRepository(repository: string | null | undefined): boolean {
	return typeof repository === 'string' && repository.trim().startsWith('sftp:');
}

function decodeUrlPart(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

function stripIpv6Brackets(host: string): string {
	return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

export function parseSftpRepository(repository: string): SftpRepositoryConfig | null {
	const repo = repository.trim();
	if (!repo.startsWith('sftp:')) return null;

	if (repo.startsWith('sftp://')) {
		let url: URL;
		try {
			url = new URL(repo);
		} catch {
			return null;
		}
		if (url.protocol !== 'sftp:' || url.password || url.search || url.hash) return null;
		const username = decodeUrlPart(url.username);
		const path = decodeUrlPart(url.pathname.slice(1));
		if (username === null || path === null) return null;
		return {
			username,
			host: stripIpv6Brackets(url.hostname),
			port: url.port || '22',
			path,
		};
	}

	const remainder = repo.slice('sftp:'.length);
	const pathSeparator = remainder.indexOf(':');
	if (pathSeparator < 0) return null;
	const authority = remainder.slice(0, pathSeparator);
	const path = remainder.slice(pathSeparator + 1);
	const userSeparator = authority.lastIndexOf('@');
	if (userSeparator <= 0) return null;
	return {
		username: authority.slice(0, userSeparator),
		host: authority.slice(userSeparator + 1),
		port: '22',
		path,
	};
}

export function validateSftpRepository(repository: string): string | null {
	if (!isSftpRepository(repository)) return null;
	if (repository !== repository.trim()) {
		return '无效的 SFTP 仓库：不允许存在前导或尾随空白字符';
	}
	if (repository.startsWith('sftp://')) {
		try {
			const url = new URL(repository);
			if (url.password) return '无效的 SFTP 仓库：仓库 URL 中不允许填写密码';
			if (url.search || url.hash) return '无效的 SFTP 仓库：不允许使用查询字符串和片段';
		} catch {
			return 'SFTP 仓库 URL 无效';
		}
	}

	const parsed = parseSftpRepository(repository);
	if (!parsed) {
		return '无效的 SFTP 仓库：请使用 sftp:user@host:/path 或 sftp://user@host:port//path';
	}
	if (!parsed.username.trim()) return '无效的 SFTP 仓库：必须填写 SSH 用户名';
	if (!parsed.host.trim() || /\s/.test(parsed.host)) return '无效的 SFTP 仓库：必须填写有效的 SSH 主机地址';
	// A leading dash reaches ssh in the host position, where it reads as an option and
	// the connection fails on a usage error instead of saying the host is wrong.
	if (parsed.host.startsWith('-')) return '无效的SFTP仓库：主机不能以 "-" 开头';
	const port = Number(parsed.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return '无效的 SFTP 仓库：SSH 端口必须介于 1 到 65535 之间';
	}
	if (parsed.path.startsWith('~')) {
		return '无效的 SFTP 仓库：请使用相对路径或绝对路径，不要使用 ~';
	}
	return null;
}

function encodePath(path: string): string {
	return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

export function buildSftpRepository(fields: Partial<SftpRepositoryConfig>): string {
	const username = encodeURIComponent(fields.username?.trim() || '');
	const rawHost = stripIpv6Brackets(fields.host?.trim() || '');
	const host = rawHost.includes(':') ? `[${rawHost}]` : rawHost;
	const port = fields.port?.trim() || '22';
	const portPart = port === '22' ? '' : `:${port}`;
	const path = encodePath(fields.path?.trim() || '.');
	return `sftp://${username}@${host}${portPart}/${path}`;
}

function suppliedSecret(value: unknown, stored: boolean): { present: boolean; invalidType: boolean; text: string } {
	if (value === undefined) return { present: stored, invalidType: false, text: '' };
	if (typeof value !== 'string') return { present: false, invalidType: true, text: '' };
	return { present: value.trim().length > 0, invalidType: false, text: value };
}

export function validateSftpCredentials(input: SftpCredentialValidationInput): string | null {
	const privateKey = suppliedSecret(input.sshPrivateKey, !!input.hasStoredSshPrivateKey);
	const knownHosts = suppliedSecret(input.sshKnownHosts, !!input.hasStoredSshKnownHosts);
	if (privateKey.invalidType) return 'SSH 私钥必须为文本格式';
	if (knownHosts.invalidType) return 'SSH known_hosts 数据必须为文本格式';
	if (!isSftpRepository(input.repository)) return null;
	if (!privateKey.present) return 'SFTP 目标需要 SSH 私钥';
	if (!knownHosts.present) return 'SFTP 目标需要已验证的 SSH known_hosts 数据';

	if (privateKey.text) {
		if (textEncoder.encode(privateKey.text).byteLength > MAX_SFTP_CREDENTIAL_BYTES) {
			return 'SSH 私钥过大';
		}
		if (privateKey.text.includes('\0')) return 'SSH 私钥不能包含空字节';
		if (!PRIVATE_KEY_HEADER.test(privateKey.text)) return 'SSH 私钥不是可识别的私钥 PEM 格式';
	}
	if (knownHosts.text) {
		if (textEncoder.encode(knownHosts.text).byteLength > MAX_SFTP_CREDENTIAL_BYTES) {
			return 'SSH known_hosts 数据过大';
		}
		if (knownHosts.text.includes('\0')) return 'SSH known_hosts 数据不能包含空字节';
		const entries = knownHosts.text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith('#'));
		if (entries.length === 0 || entries.some((line) => line.split(/\s+/).length < 3)) {
			return 'SSH known_hosts 数据至少需要包含一条有效的主机密钥条目';
		}
	}
	return null;
}
