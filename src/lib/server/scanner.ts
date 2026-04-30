// Vulnerability Scanner Service
// Supports Grype and Trivy scanners
// Uses long-running containers for faster subsequent scans (cached vulnerability databases)

import {
	listImages,
	pullImage,
	createVolume,
	listVolumes,
	removeVolume,
	runContainer,
	runContainerWithStreaming,
	inspectImage,
	checkImageUpdateAvailable,
	getNegotiatedApiVersion
} from './docker';
import { getEnvironment, getEnvSetting, getSetting } from './db';
import { sendEventNotification } from './notifications';
import {
	getHostDockerSocket,
	getHostDataDir,
	extractUidFromSocketPath,
	getOwnDockerHost,
	getOwnExtraHosts,
	getOwnNetworkMode
} from './host-path';
import { resolve } from 'node:path';
import { mkdir, chown, rm } from 'node:fs/promises';

export type ScannerType = 'none' | 'grype' | 'trivy' | 'both';

/**
 * Send vulnerability notifications based on scan results.
 * Sends the most severe notification type based on found vulnerabilities.
 */
export async function sendVulnerabilityNotifications(
	imageName: string,
	summary: VulnerabilitySeverity,
	envId?: number
): Promise<void> {
	const totalVulns = summary.critical + summary.high + summary.medium + summary.low + summary.negligible + summary.unknown;

	if (totalVulns === 0) {
		// No vulnerabilities found, no notification needed
		return;
	}

	// Send notifications based on severity (most severe first)
	// Note: Users can subscribe to specific severity levels, so we send all applicable
	if (summary.critical > 0) {
		await sendEventNotification('vulnerability_critical', {
			title: '发现严重漏洞',
			message: `镜像 "${imageName}" 存在 ${summary.critical} 个严重漏洞 (总计 ${totalVulns} 个)`,
			type: 'error'
		}, envId);
	}

	if (summary.high > 0) {
		await sendEventNotification('vulnerability_high', {
			title: '发现高危漏洞',
			message: `镜像 "${imageName}" 存在 ${summary.high} 个高危漏洞 (总计 ${totalVulns} 个)`,
			type: 'warning'
		}, envId);
	}

	// Only send 'any' notification if there are medium/low/negligible but no critical/high
	// This prevents notification spam for users who only want to know about lesser severities
	if (summary.critical === 0 && summary.high === 0 && totalVulns > 0) {
		await sendEventNotification('vulnerability_any', {
			title: '发现漏洞',
			message: `镜像 "${imageName}" 存在 ${totalVulns} 个漏洞 (中危：${summary.medium}，低危：${summary.low})`,
			type: 'info'
		}, envId);
	}
}

// Volume names for scanner database caching
const GRYPE_VOLUME_NAME = 'dockhand-grype-db';
const TRIVY_VOLUME_NAME = 'dockhand-trivy-db';

// Scanner cache directory for rootless Docker (bind mounts instead of volumes)
const DATA_DIR = process.env.DATA_DIR || '/app/data';
const SCANNER_CACHE_DIR = 'scanner-cache';

// Per-type serial lock to prevent concurrent scans of the same scanner type.
// This avoids DB lock conflicts AND ensures the second scan uses warm cache
// instead of re-downloading the entire vulnerability database (~100MB).
const scannerLocks = new Map<string, Promise<void>>(); // key: "grype" or "trivy"

async function withScannerLock<T>(scannerType: string, fn: () => Promise<T>): Promise<T> {
	const existing = scannerLocks.get(scannerType);
	if (existing) {
		console.log(`[扫描器] 等待上一次 ${scannerType} 扫描完成...`);
		await existing.catch(() => { }); // Don't fail if previous scan errored
	}

	let resolve: () => void;
	const lockPromise = new Promise<void>(r => { resolve = r; });
	scannerLocks.set(scannerType, lockPromise);

	try {
		return await fn();
	} finally {
		resolve!();
		if (scannerLocks.get(scannerType) === lockPromise) {
			scannerLocks.delete(scannerType);
		}
	}
}

// Track in-progress scans per image to prevent duplicate scans
// Key: "{scannerType}:{imageName}", Value: Promise that resolves to the scan result
const inProgressScans = new Map<string, Promise<string>>();

// Default CLI arguments for scanners (image name is substituted for {image})
export const DEFAULT_GRYPE_ARGS = '-o json -v {image}';
export const DEFAULT_TRIVY_ARGS = 'image --format json {image}';

// Pinned scanner images — avoid :latest after the March 2026 Trivy supply chain attack
export const DEFAULT_GRYPE_IMAGE = 'anchore/grype:v0.110.0';
export const DEFAULT_TRIVY_IMAGE = 'aquasec/trivy:0.69.3';

export interface VulnerabilitySeverity {
	critical: number;
	high: number;
	medium: number;
	low: number;
	negligible: number;
	unknown: number;
}

export interface Vulnerability {
	id: string;
	severity: string;
	package: string;
	version: string;
	fixedVersion?: string;
	description?: string;
	link?: string;
	scanner: 'grype' | 'trivy';
}

export interface ScanResult {
	imageId: string;
	imageName: string;
	scanner: 'grype' | 'trivy';
	scannedAt: string;
	vulnerabilities: Vulnerability[];
	summary: VulnerabilitySeverity;
	scanDuration: number;
	error?: string;
}

export interface ScanProgress {
	stage: 'checking' | 'pulling-scanner' | 'scanning' | 'parsing' | 'complete' | 'error';
	message: string;
	scanner?: 'grype' | 'trivy';
	progress?: number;
	result?: ScanResult;
	results?: ScanResult[]; // All scanner results when using 'both'
	error?: string;
	output?: string; // Line of scanner output
}

// Get global default scanner CLI args and images from general settings (or fallback to hardcoded defaults)
export async function getGlobalScannerDefaults(): Promise<{
	grypeArgs: string;
	trivyArgs: string;
	grypeImage: string;
	trivyImage: string;
}> {
	const [grypeArgs, trivyArgs, grypeImage, trivyImage] = await Promise.all([
		getSetting('default_grype_args'),
		getSetting('default_trivy_args'),
		getSetting('default_grype_image'),
		getSetting('default_trivy_image')
	]);
	return {
		grypeArgs: grypeArgs ?? DEFAULT_GRYPE_ARGS,
		trivyArgs: trivyArgs ?? DEFAULT_TRIVY_ARGS,
		grypeImage: grypeImage ?? DEFAULT_GRYPE_IMAGE,
		trivyImage: trivyImage ?? DEFAULT_TRIVY_IMAGE
	};
}

// Get scanner settings (scanner type is per-environment, CLI args and images are global)
export async function getScannerSettings(envId?: number): Promise<{
	scanner: ScannerType;
	grypeArgs: string;
	trivyArgs: string;
	grypeImage: string;
	trivyImage: string;
}> {
	// CLI args and images are always global - no need for per-env settings
	const [globalDefaults, scanner] = await Promise.all([
		getGlobalScannerDefaults(),
		getEnvSetting('vulnerability_scanner', envId)
	]);

	return {
		scanner: scanner || 'none',
		grypeArgs: globalDefaults.grypeArgs,
		trivyArgs: globalDefaults.trivyArgs,
		grypeImage: globalDefaults.grypeImage,
		trivyImage: globalDefaults.trivyImage
	};
}

// Optimized version that accepts pre-cached global defaults (avoids redundant DB calls)
// Only looks up scanner type per-environment since CLI args and images are global
export async function getScannerSettingsWithDefaults(
	envId: number | undefined,
	globalDefaults: { grypeArgs: string; trivyArgs: string; grypeImage: string; trivyImage: string }
): Promise<{
	scanner: ScannerType;
	grypeArgs: string;
	trivyArgs: string;
	grypeImage: string;
	trivyImage: string;
}> {
	const scanner = await getEnvSetting('vulnerability_scanner', envId) || 'none';
	return {
		scanner,
		grypeArgs: globalDefaults.grypeArgs,
		trivyArgs: globalDefaults.trivyArgs,
		grypeImage: globalDefaults.grypeImage,
		trivyImage: globalDefaults.trivyImage
	};
}

// Parse CLI args string into array, substituting {image} placeholder
function parseCliArgs(argsString: string, imageName: string): string[] {
	// Replace {image} placeholder with actual image name
	const withImage = argsString.replace(/\{image\}/g, imageName);
	// Split by whitespace, respecting quoted strings
	const args: string[] = [];
	let current = '';
	let inQuote = false;
	let quoteChar = '';

	for (const char of withImage) {
		if ((char === '"' || char === "'") && !inQuote) {
			inQuote = true;
			quoteChar = char;
		} else if (char === quoteChar && inQuote) {
			inQuote = false;
			quoteChar = '';
		} else if (char === ' ' && !inQuote) {
			if (current) {
				args.push(current);
				current = '';
			}
		} else {
			current += char;
		}
	}
	if (current) {
		args.push(current);
	}
	return args;
}

// Check if a scanner image is available locally
async function isScannerImageAvailable(scannerImage: string, envId?: number): Promise<boolean> {
	try {
		const images = await listImages(envId);
		const imageWithTag = scannerImage.includes(':') ? scannerImage : `${scannerImage}:latest`;
		return images.some((img) =>
			img.tags?.some((tag: string) => tag === imageWithTag)
		);
	} catch {
		return false;
	}
}

// Pull scanner image if not available
async function ensureScannerImage(
	scannerImage: string,
	envId?: number,
	onProgress?: (progress: ScanProgress) => void
): Promise<boolean> {
	const isAvailable = await isScannerImageAvailable(scannerImage, envId);

	if (isAvailable) {
		return true;
	}

	onProgress?.({
		stage: 'pulling-scanner',
		message: `正在拉取扫描器镜像 ${scannerImage}...`
	});

	try {
		await pullImage(scannerImage, undefined, envId);
		return true;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[扫描器] 拉取镜像 ${scannerImage} 失败：`, errorMsg);
		return false;
	}
}

// Extract JSON object from raw scanner output that may contain non-JSON content
// (binary Docker stream headers, warning lines, control characters)
export function extractJson(output: string): string {
	const firstBrace = output.indexOf('{');
	const lastBrace = output.lastIndexOf('}');
	if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
		throw new Error('在扫描器输出中未找到 JSON 对象');
	}
	return output.slice(firstBrace, lastBrace + 1);
}

/**
 * Sanitize control characters inside JSON string values that would cause parse failures.
 * Some scanners (Grype) may include raw control chars (newlines, tabs, null bytes)
 * in vulnerability descriptions that aren't properly JSON-escaped.
 */
export function sanitizeJsonString(json: string): string {
	// Replace unescaped control characters (0x00-0x1F) inside JSON string values
	// by walking through the string and tracking whether we're inside a quoted string
	let result = '';
	let inString = false;
	let escaped = false;
	let sanitized = 0;

	for (let i = 0; i < json.length; i++) {
		const ch = json.charCodeAt(i);

		if (escaped) {
			// Validate JSON escape sequences: only " \ / b f n r t u are valid
			const ch2 = json[i];
			if ('"\\\/bfnrtu'.includes(ch2)) {
				result += ch2;
			} else if (ch < 0x20) {
				// Backslash followed by a raw control character (e.g. \ + 0x0A)
				// The backslash was already added to result — escape it as \\
				// then also escape the control character
				result += '\\';
				if (ch === 0x0A) result += '\\n';
				else if (ch === 0x0D) result += '\\r';
				else if (ch === 0x09) result += '\\t';
				else result += `\\u${ch.toString(16).padStart(4, '0')}`;
				sanitized++;
			} else {
				// Invalid escape like \x, \a, \e — convert backslash to literal \\
				result += '\\' + ch2;
				sanitized++;
			}
			escaped = false;
			continue;
		}

		if (inString) {
			if (ch === 0x5C) { // backslash
				result += json[i];
				escaped = true;
			} else if (ch === 0x22) { // closing quote
				result += json[i];
				inString = false;
			} else if (ch < 0x20) {
				// Control character inside a string - escape it
				if (ch === 0x0A) result += '\\n';
				else if (ch === 0x0D) result += '\\r';
				else if (ch === 0x09) result += '\\t';
				else result += `\\u${ch.toString(16).padStart(4, '0')}`;
				sanitized++;
			} else {
				result += json[i];
			}
		} else {
			if (ch === 0x22) { // opening quote
				inString = true;
			}
			result += json[i];
		}
	}

	if (sanitized > 0) {
		console.warn(`[扫描器] 已清理 JSON 输出中的 ${sanitized} 个控制/转义字符`);
	}

	return result;
}

// Parse Grype JSON output
function parseGrypeOutput(output: string): { vulnerabilities: Vulnerability[]; summary: VulnerabilitySeverity } {
	const vulnerabilities: Vulnerability[] = [];
	const summary: VulnerabilitySeverity = {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
		negligible: 0,
		unknown: 0
	};

	try {
		const extracted = extractJson(output);
		const sanitized = sanitizeJsonString(extracted);
		const data = JSON.parse(sanitized);

		if (data.matches) {
			for (const match of data.matches) {
				const severity = (match.vulnerability?.severity || 'Unknown').toLowerCase();
				const vuln: Vulnerability = {
					id: match.vulnerability?.id || 'Unknown',
					severity: severity,
					package: match.artifact?.name || 'Unknown',
					version: match.artifact?.version || 'Unknown',
					fixedVersion: match.vulnerability?.fix?.versions?.[0],
					description: match.vulnerability?.description,
					link: match.vulnerability?.dataSource,
					scanner: 'grype'
				};
				vulnerabilities.push(vuln);

				// Count by severity
				if (severity === 'critical') summary.critical++;
				else if (severity === 'high') summary.high++;
				else if (severity === 'medium') summary.medium++;
				else if (severity === 'low') summary.low++;
				else if (severity === 'negligible') summary.negligible++;
				else summary.unknown++;
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[Grype] 解析输出失败：', errorMsg);
		console.error('[Grype] 输出长度：', output.length);
		console.error('[Grype] 前 200 字符：', output.slice(0, 200));
		console.error('[Grype] 后 200 字符：', output.slice(-200));
		// Check if output looks like an error message from grype
		const firstLine = output.split('\n')[0].trim();
		if (firstLine && !firstLine.startsWith('{')) {
			throw new Error(`扫描器输出错误：${firstLine}`);
		}
		throw new Error('解析扫描器输出失败 - 请确保 CLI 参数包含 "-o json"');
	}

	return { vulnerabilities, summary };
}

// Parse Trivy JSON output
function parseTrivyOutput(output: string): { vulnerabilities: Vulnerability[]; summary: VulnerabilitySeverity } {
	const vulnerabilities: Vulnerability[] = [];
	const summary: VulnerabilitySeverity = {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
		negligible: 0,
		unknown: 0
	};

	try {
		const data = JSON.parse(sanitizeJsonString(extractJson(output)));

		const results = data.Results || [];
		for (const result of results) {
			const vulns = result.Vulnerabilities || [];
			for (const v of vulns) {
				const severity = (v.Severity || 'Unknown').toLowerCase();
				const vuln: Vulnerability = {
					id: v.VulnerabilityID || 'Unknown',
					severity: severity,
					package: v.PkgName || 'Unknown',
					version: v.InstalledVersion || 'Unknown',
					fixedVersion: v.FixedVersion,
					description: v.Description,
					link: v.PrimaryURL || v.References?.[0],
					scanner: 'trivy'
				};
				vulnerabilities.push(vuln);

				// Count by severity
				if (severity === 'critical') summary.critical++;
				else if (severity === 'high') summary.high++;
				else if (severity === 'medium') summary.medium++;
				else if (severity === 'low') summary.low++;
				else if (severity === 'negligible') summary.negligible++;
				else summary.unknown++;
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[Trivy] 解析输出失败：', errorMsg);
		console.error('[Trivy] 输出长度：', output.length);
		console.error('[Trivy] 前 32 字节 (十六进制)：', Buffer.from(output.slice(0, 32)).toString('hex'));
		console.error('[Trivy] 完整输出：', output);
		// Check if output looks like an error message from trivy
		const firstLine = output.split('\n')[0].trim();
		if (firstLine && !firstLine.startsWith('{')) {
			throw new Error(`扫描器输出错误：${firstLine}`);
		}
		throw new Error('解析扫描器输出失败 - 请确保 CLI 参数包含 "--format json"');
	}

	return { vulnerabilities, summary };
}

// Get the SHA256 image ID for a given image name/tag
async function getImageSha(imageName: string, envId?: number): Promise<string> {
	try {
		const imageInfo = await inspectImage(imageName, envId) as any;
		// The Id field contains the full sha256:... hash
		return imageInfo.Id || imageName;
	} catch {
		// If we can't inspect the image, fall back to the name
		return imageName;
	}
}

// Ensure a named volume exists for caching scanner databases
async function ensureVolume(volumeName: string, envId?: number): Promise<void> {
	const volumes = await listVolumes(envId);
	const exists = volumes.some(v => v.name === volumeName);
	if (!exists) {
		console.log(`[扫描器] 正在创建数据库数据卷：${volumeName}`);
		await createVolume({ name: volumeName }, envId);
	} else {
		console.log(`[扫描器] 使用已存在的数据库数据卷：${volumeName}`);
	}
}

/**
 * Ensure scanner cache directory exists with correct ownership for rootless Docker.
 * Creates the directory in Dockhand's data volume and chowns it to the target UID.
 *
 * This is needed because Docker volumes are always created with root ownership,
 * but rootless Docker scanners run as a non-root user (e.g., UID 1000).
 * By using a bind mount from Dockhand's data directory (which Dockhand can chown
 * since it runs as root), the scanner can write to its cache.
 *
 * @param scannerType - 'grype' or 'trivy'
 * @param uid - Target UID for ownership (e.g., '1000')
 * @returns The HOST path to the cache directory (for bind mounting into scanner)
 */
async function ensureScannerCacheDir(
	scannerType: 'grype' | 'trivy',
	uid: string
): Promise<string> {
	const containerPath = resolve(DATA_DIR, SCANNER_CACHE_DIR, scannerType);

	// Create directory if needed (recursive)
	await mkdir(containerPath, { recursive: true });

	// Chown to the target UID so scanner can write
	const uidNum = parseInt(uid, 10);
	await chown(containerPath, uidNum, uidNum);
	console.log(`[扫描器] 已将 ${containerPath} 所有权设置为 ${uid}:${uid}`);

	// Return the HOST path for bind mounting
	const hostDataDir = getHostDataDir();
	if (hostDataDir) {
		return `${hostDataDir}/${SCANNER_CACHE_DIR}/${scannerType}`;
	}

	// Fallback: not running in Docker, use container path as-is
	return containerPath;
}

// Run scanner in a fresh container with volume-cached database
async function runScannerContainer(
	scannerImage: string,
	scannerType: 'grype' | 'trivy',
	imageName: string,
	cmd: string[],
	envId?: number,
	onOutput?: (line: string) => void
): Promise<string> {
	// Check if a scan for this exact image is already in progress
	// This prevents duplicate scans when multiple containers use the same image
	const scanKey = `${scannerType}:${imageName}:${envId ?? 'local'}`;
	const existingScan = inProgressScans.get(scanKey);
	if (existingScan) {
		console.log(`[扫描器] 复用正在进行的 ${scannerType} 扫描：${imageName}`);
		return existingScan;
	}

	// Create the actual scan promise
	const scanPromise = runScannerContainerImpl(scannerImage, scannerType, imageName, cmd, envId, onOutput);

	// Register it so concurrent requests can reuse it
	inProgressScans.set(scanKey, scanPromise);

	try {
		return await scanPromise;
	} finally {
		// Clean up the tracking entry when done
		inProgressScans.delete(scanKey);
	}
}

// Internal implementation of scanner container run
async function runScannerContainerImpl(
	scannerImage: string,
	scannerType: 'grype' | 'trivy',
	imageName: string,
	cmd: string[],
	envId?: number,
	onOutput?: (line: string) => void
): Promise<string> {
	// Serialize scans of the same type to avoid DB lock conflicts and re-downloads
	return withScannerLock(scannerType, () =>
		runScannerContainerCore(scannerImage, scannerType, imageName, cmd, envId, onOutput)
	);
}

async function runScannerContainerCore(
	scannerImage: string,
	scannerType: 'grype' | 'trivy',
	imageName: string,
	cmd: string[],
	envId?: number,
	onOutput?: (line: string) => void
): Promise<string> {
	console.log(`[扫描器] 开始对镜像进行 ${scannerType} 扫描：${imageName}，环境ID：${envId ?? '本地'}`);

	// Always use the base cache path — serial lock prevents concurrent conflicts
	const basePath = scannerType === 'grype' ? '/cache/grype' : '/cache/trivy';
	const dbPath = basePath;

	// Detect how the scanner container should access Docker.
	// Strategy: mirror Dockhand's own Docker connection when running locally.
	const env = envId ? await getEnvironment(envId) : undefined;
	const connectionType = env?.connectionType;

	const isHawser = connectionType === 'hawser-standard' || connectionType === 'hawser-edge';

	let hostSocketPath: string | null = null;
	let rootlessUid: string | undefined;
	let scannerNetworkMode: string | undefined;
	let scannerDockerHost: string | undefined;
	const scannerExtraHosts = !isHawser ? getOwnExtraHosts() ?? undefined : undefined;

	// Check if Dockhand itself uses TCP to reach Docker (e.g., socket proxy).
	// Detected at startup from Dockhand's own container inspect data.
	// This applies to ALL non-hawser environments since the scanner container
	// runs on the same Docker daemon and needs the same access method.
	const ownDockerHost = getOwnDockerHost();

	if (!isHawser && ownDockerHost?.startsWith('tcp://')) {
		// TCP mode: scanner uses the same DOCKER_HOST + network as Dockhand
		scannerDockerHost = ownDockerHost;
		scannerNetworkMode = getOwnNetworkMode() ?? undefined;
		console.log(`[扫描器] TCP 模式 (来自容器检查) - DOCKER_HOST=${scannerDockerHost}，网络=${scannerNetworkMode ?? '默认'}`);
	} else if (isHawser) {
		// Hawser: scanner runs on remote host, uses remote host's standard Docker socket
		hostSocketPath = '/var/run/docker.sock';
		console.log(`[扫描器] 通过 Hawser 远程扫描 (${connectionType}) - 使用标准 socket 路径`);
	} else {
		// Local socket — detect host socket path (handles rootless Docker)
		hostSocketPath = getHostDockerSocket();
		console.log(`[扫描器] 本地 socket 扫描 (${connectionType || '默认'}) - 检测到主机 Docker socket：${hostSocketPath}`);

		// For user-specific Docker sockets (rootless Docker), detect UID for cache ownership
		const uid = extractUidFromSocketPath(hostSocketPath);
		if (uid) {
			rootlessUid = uid;
			console.log(`[扫描器] 检测到无 root Docker (UID ${rootlessUid})`);
			console.log(`[扫描器] 扫描器将在容器内以 root 运行 (通过用户命名空间映射到主机 UID ${rootlessUid})`);
		}
	}

	// Determine cache storage strategy based on environment
	// For rootless Docker: use bind mount from data directory with correct ownership
	// For standard Docker: use named volume (root-owned is fine when running as root)
	let cacheBind: string;
	const volumeName = scannerType === 'grype' ? GRYPE_VOLUME_NAME : TRIVY_VOLUME_NAME;

	if (rootlessUid) {
		// Rootless Docker: use bind mount from data directory with correct ownership
		const hostCachePath = await ensureScannerCacheDir(scannerType, rootlessUid);
		cacheBind = `${hostCachePath}:${basePath}`;
		console.log(`[扫描器] 无 root 模式 - 使用绑定挂载：${cacheBind}`);
	} else {
		// Standard Docker: use named volume (root-owned is fine when running as root)
		await ensureVolume(volumeName, envId);
		cacheBind = `${volumeName}:${basePath}`;
		console.log(`[扫描器] 标准模式 - 使用数据卷：${volumeName}`);
	}

	// Build binds — only include socket mount when using socket mode
	const binds: string[] = [];
	if (hostSocketPath) {
		binds.push(`${hostSocketPath}:/var/run/docker.sock:ro`);
	}
	binds.push(cacheBind);

	console.log(`[扫描器] 容器绑定挂载：${JSON.stringify(binds)}`);

	// Environment variables to ensure scanners use the correct cache path
	const envVars = scannerType === 'grype'
		? [`GRYPE_DB_CACHE_DIR=${dbPath}`]
		: [`TRIVY_CACHE_DIR=${dbPath}`];

	// Pin Docker API version so scanner's bundled Docker client doesn't request
	// a version newer than the host daemon supports (e.g. grype ships client v1.53
	// but the host may only support up to v1.43).
	const apiVersion = await getNegotiatedApiVersion(envId);
	if (apiVersion) {
		envVars.push(`DOCKER_API_VERSION=${apiVersion}`);
		console.log(`[扫描器] 使用协商后的 Docker API 版本：${apiVersion}`);
	}

	// Propagate proxy env vars so scanners can reach the internet in proxied environments
	const proxyVarNames = [
		'HTTP_PROXY', 'http_proxy',
		'HTTPS_PROXY', 'https_proxy',
		'NO_PROXY', 'no_proxy',
		'ALL_PROXY', 'all_proxy',
	];
	for (const name of proxyVarNames) {
		if (process.env[name]) {
			envVars.push(`${name}=${process.env[name]}`);
		}
	}

	// In TCP mode, pass DOCKER_HOST so scanner connects to Docker via TCP
	if (scannerDockerHost) {
		envVars.push(`DOCKER_HOST=${scannerDockerHost}`);
	}

	console.log(`[扫描器] 正在运行 ${scannerType}，缓存挂载于 ${basePath}`);
	console.log(`[扫描器] 容器命令：${cmd.join(' ')}`);
	// Run the scanner container with a 10-minute timeout to prevent indefinite hangs
	const output = await runContainerWithStreaming({
		image: scannerImage,
		cmd,
		binds,
		env: envVars,
		extraHosts: scannerExtraHosts,
		name: `dockhand-${scannerType}-${Date.now()}`,
		envId,
		networkMode: scannerNetworkMode,
		timeout: 600_000, // 10 minutes
		onStderr: (data) => {
			// Stream stderr lines for real-time progress output
			const lines = data.split('\n');
			for (const line of lines) {
				if (line.trim()) {
					onOutput?.(line);
				}
			}
		}
	});

	console.log(`[扫描器] ${scannerType} 容器执行完成，输出长度：${output.length}`);
	if (output.length < 100) {
		console.log(`[扫描器] ${scannerType} 输出预览：${output}`);
	}

	return output;
}

// Scan image with Grype
export async function scanWithGrype(
	imageName: string,
	envId?: number,
	onProgress?: (progress: ScanProgress) => void
): Promise<ScanResult> {
	const startTime = Date.now();
	const { grypeArgs, grypeImage: scannerImage } = await getScannerSettings(envId);

	onProgress?.({
		stage: 'checking',
		message: '正在检查 Grype 扫描器可用性...',
		scanner: 'grype'
	});

	// Ensure scanner image is available
	const available = await ensureScannerImage(scannerImage, envId, onProgress);
	if (!available) {
		throw new Error('获取 Grype 扫描器镜像失败。请确保 Docker 可以拉取镜像。');
	}

	onProgress?.({
		stage: 'scanning',
		message: `正在使用 Grype 扫描 ${imageName}...`,
		scanner: 'grype',
		progress: 30
	});

	try {
		// Parse CLI args from settings
		const cmd = parseCliArgs(grypeArgs, imageName);
		const output = await runScannerContainer(
			scannerImage,
			'grype',
			imageName,
			cmd,
			envId,
			(line) => {
				onProgress?.({
					stage: 'scanning',
					message: `正在使用 Grype 扫描 ${imageName}...`,
					scanner: 'grype',
					progress: 50,
					output: line
				});
			}
		);

		// Defensive logging for empty output
		console.log(`[Grype] 已接收扫描器容器输出，长度：${output.length}`);
		if (output.length === 0) {
			console.error('[Grype] 警告：扫描器容器输出为空 - 可能存在竞争条件');
		}

		onProgress?.({
			stage: 'parsing',
			message: '正在解析扫描结果...',
			scanner: 'grype',
			progress: 80
		});

		const { vulnerabilities, summary } = parseGrypeOutput(output);

		// Get the actual SHA256 image ID for reliable caching
		const imageId = await getImageSha(imageName, envId);

		const result: ScanResult = {
			imageId,
			imageName,
			scanner: 'grype',
			scannedAt: new Date().toISOString(),
			vulnerabilities,
			summary,
			scanDuration: Date.now() - startTime
		};

		onProgress?.({
			stage: 'complete',
			message: `Grype 扫描完成：严重 ${summary.critical}，高危 ${summary.high}，中危 ${summary.medium}，低危 ${summary.low}`,
			scanner: 'grype',
			progress: 100,
			result
		});

		return result;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		onProgress?.({
			stage: 'error',
			message: `Grype 扫描失败：${errorMsg}`,
			scanner: 'grype',
			error: errorMsg
		});
		throw error;
	}
}

// Scan image with Trivy
export async function scanWithTrivy(
	imageName: string,
	envId?: number,
	onProgress?: (progress: ScanProgress) => void
): Promise<ScanResult> {
	const startTime = Date.now();
	const { trivyArgs, trivyImage: scannerImage } = await getScannerSettings(envId);

	onProgress?.({
		stage: 'checking',
		message: '正在检查 Trivy 扫描器可用性...',
		scanner: 'trivy'
	});

	// Ensure scanner image is available
	const available = await ensureScannerImage(scannerImage, envId, onProgress);
	if (!available) {
		throw new Error('获取 Trivy 扫描器镜像失败。请确保 Docker 可以拉取镜像。');
	}

	onProgress?.({
		stage: 'scanning',
		message: `正在使用 Trivy 扫描 ${imageName}...`,
		scanner: 'trivy',
		progress: 30
	});

	try {
		// Parse CLI args from settings
		const cmd = parseCliArgs(trivyArgs, imageName);
		const output = await runScannerContainer(
			scannerImage,
			'trivy',
			imageName,
			cmd,
			envId,
			(line) => {
				onProgress?.({
					stage: 'scanning',
					message: `正在使用 Trivy 扫描 ${imageName}...`,
					scanner: 'trivy',
					progress: 50,
					output: line
				});
			}
		);

		// Defensive logging for empty output
		console.log(`[Trivy] 已接收扫描器容器输出，长度：${output.length}`);
		if (output.length === 0) {
			console.error('[Trivy] 警告：扫描器容器输出为空 - 可能存在竞争条件');
		}

		onProgress?.({
			stage: 'parsing',
			message: '正在解析扫描结果...',
			scanner: 'trivy',
			progress: 80
		});

		const { vulnerabilities, summary } = parseTrivyOutput(output);

		// Get the actual SHA256 image ID for reliable caching
		const imageId = await getImageSha(imageName, envId);

		const result: ScanResult = {
			imageId,
			imageName,
			scanner: 'trivy',
			scannedAt: new Date().toISOString(),
			vulnerabilities,
			summary,
			scanDuration: Date.now() - startTime
		};

		onProgress?.({
			stage: 'complete',
			message: `Trivy 扫描完成：严重 ${summary.critical}，高危 ${summary.high}，中危 ${summary.medium}，低危 ${summary.low}`,
			scanner: 'trivy',
			progress: 100,
			result
		});

		return result;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		onProgress?.({
			stage: 'error',
			message: `rivy 扫描失败：${errorMsg}`,
			scanner: 'trivy',
			error: errorMsg
		});
		throw error;
	}
}

// Scan image with configured scanner(s)
export async function scanImage(
	imageName: string,
	envId?: number,
	onProgress?: (progress: ScanProgress) => void,
	forceScannerType?: ScannerType
): Promise<ScanResult[]> {
	const { scanner } = await getScannerSettings(envId);
	const scannerType = forceScannerType || scanner;

	if (scannerType === 'none') {
		return [];
	}

	const results: ScanResult[] = [];

	const errors: Error[] = [];

	if (scannerType === 'grype' || scannerType === 'both') {
		try {
			const result = await scanWithGrype(imageName, envId, onProgress);
			results.push(result);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error('[Grype] 扫描失败：', errorMsg);
			errors.push(error instanceof Error ? error : new Error(String(error)));
			if (scannerType === 'grype') throw error;
		}
	}

	if (scannerType === 'trivy' || scannerType === 'both') {
		try {
			const result = await scanWithTrivy(imageName, envId, onProgress);
			results.push(result);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error('[Trivy] 扫描失败：', errorMsg);
			errors.push(error instanceof Error ? error : new Error(String(error)));
			if (scannerType === 'trivy') throw error;
		}
	}

	// If using 'both' and all scanners failed, throw an error
	if (scannerType === 'both' && results.length === 0 && errors.length > 0) {
		throw new Error(`所有扫描器均失败：${errors.map(e => e.message).join('; ')}`);
	}

	// Send vulnerability notifications based on combined results
	// When using 'both' scanners, take the MAX of each severity across all results
	if (results.length > 0) {
		const combinedSummary: VulnerabilitySeverity = {
			critical: Math.max(...results.map(r => r.summary.critical)),
			high: Math.max(...results.map(r => r.summary.high)),
			medium: Math.max(...results.map(r => r.summary.medium)),
			low: Math.max(...results.map(r => r.summary.low)),
			negligible: Math.max(...results.map(r => r.summary.negligible)),
			unknown: Math.max(...results.map(r => r.summary.unknown))
		};

		// Send notifications (async, don't block return)
		sendVulnerabilityNotifications(imageName, combinedSummary, envId).catch(err => {
			const errorMsg = err instanceof Error ? err.message : String(err);
			console.error('[扫描器] 发送漏洞通知失败：', errorMsg);
		});
	}

	return results;
}

// Check if scanner images are available
export async function checkScannerAvailability(envId?: number): Promise<{
	grype: boolean;
	trivy: boolean;
}> {
	const defaults = await getGlobalScannerDefaults();
	const [grypeAvailable, trivyAvailable] = await Promise.all([
		isScannerImageAvailable(defaults.grypeImage, envId),
		isScannerImageAvailable(defaults.trivyImage, envId)
	]);

	return {
		grype: grypeAvailable,
		trivy: trivyAvailable
	};
}

// Get scanner version by running a temporary container
async function getScannerVersion(
	scannerType: 'grype' | 'trivy',
	envId?: number
): Promise<string | null> {
	try {
		const defaults = await getGlobalScannerDefaults();
		const scannerImage = scannerType === 'grype' ? defaults.grypeImage : defaults.trivyImage;

		// Check if image exists first — match by repo name prefix, not exact tag
		const imageRepo = scannerType === 'grype' ? 'anchore/grype' : 'aquasec/trivy';
		const images = await listImages(envId);
		const hasImage = images.some((img) =>
			img.tags?.some((tag: string) => tag.startsWith(imageRepo + ':'))
		);
		if (!hasImage) return null;

		// Create temporary container to get version
		const versionCmd = scannerType === 'grype' ? ['version'] : ['--version'];
		console.log(`[扫描器] 获取 ${scannerType} 版本，命令：`, versionCmd);
		const { stdout, stderr } = await runContainer({
			image: scannerImage,
			cmd: versionCmd,
			name: `dockhand-${scannerType}-version-${Date.now()}`,
			envId
		});

		console.log(`[扫描器] ${scannerType} 版本检查结果：stdout="${stdout.substring(0, 100)}", stderr="${stderr.substring(0, 100)}"`);
		const output = stdout || stderr;

		// Parse version from output
		// Grype: "grype 0.74.0" or "Application:    grype\nVersion:    0.86.1"
		// Trivy: "Version: 0.48.0" or just "0.48.0"
		const versionMatch = output.match(/(?:grype|trivy|Version:?\s*)?([\d]+\.[\d]+\.[\d]+)/i);
		const version = versionMatch ? versionMatch[1] : null;

		if (!version) {
			console.error(`无法从输出解析 ${scannerType} 版本：`, output.substring(0, 200));
		}

		return version;
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[扫描器] 获取 ${scannerType} 版本失败：`, errorMsg);
		return null;
	}
}

// Get versions of available scanners
export async function getScannerVersions(envId?: number): Promise<{
	grype: string | null;
	trivy: string | null;
}> {
	const [grypeVersion, trivyVersion] = await Promise.all([
		getScannerVersion('grype', envId),
		getScannerVersion('trivy', envId)
	]);

	return {
		grype: grypeVersion,
		trivy: trivyVersion
	};
}

// Check if scanner images have updates available by comparing local digest with remote
export async function checkScannerUpdates(envId?: number): Promise<{
	grype: { hasUpdate: boolean; localDigest?: string; remoteDigest?: string };
	trivy: { hasUpdate: boolean; localDigest?: string; remoteDigest?: string };
}> {
	const result = {
		grype: { hasUpdate: false, localDigest: undefined as string | undefined, remoteDigest: undefined as string | undefined },
		trivy: { hasUpdate: false, localDigest: undefined as string | undefined, remoteDigest: undefined as string | undefined }
	};

	try {
		const defaults = await getGlobalScannerDefaults();
		const images = await listImages(envId);

		// Check both scanners
		for (const [scanner, imageName] of [['grype', defaults.grypeImage], ['trivy', defaults.trivyImage]] as const) {
			try {
				// Find local image
				const localImage = images.find((img) =>
					img.tags?.includes(imageName)
				);

				if (localImage && localImage.id) {
					const updateResult = await checkImageUpdateAvailable(imageName, localImage.id, envId);
					result[scanner].hasUpdate = updateResult.hasUpdate;
					result[scanner].localDigest = updateResult.currentDigest;
					result[scanner].remoteDigest = updateResult.registryDigest;
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.error(`[扫描器] 检查 ${scanner} 更新失败：`, errorMsg);
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[扫描器] 检查扫描器更新失败：', errorMsg);
	}

	return result;
}

// Clean up scanner database volumes (removes cached vulnerability databases)
export async function cleanupScannerVolumes(envId?: number): Promise<void> {
	try {
		// Remove scanner database volumes
		for (const volumeName of [GRYPE_VOLUME_NAME, TRIVY_VOLUME_NAME]) {
			try {
				await removeVolume(volumeName, true, envId);
				console.log(`[扫描器] 已删除数据卷：${volumeName}`);
			} catch {
				// Volume might not exist, ignore
			}
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[扫描器] 清理扫描器数据卷失败：', errorMsg);
	}
}

/**
 * Clean up all scanner cache storage (volumes + bind mount directories).
 * Handles both standard Docker (named volumes) and rootless Docker (bind mounts).
 * Next scan after cleanup will re-download a fresh vulnerability database (~200MB).
 */
export async function cleanupScannerCache(envId?: number): Promise<{ volumes: string[]; dirs: string[] }> {
	const removedVolumes: string[] = [];
	const removedDirs: string[] = [];

	// 1. Remove named volumes (standard Docker mode)
	for (const volumeName of [GRYPE_VOLUME_NAME, TRIVY_VOLUME_NAME]) {
		try {
			await removeVolume(volumeName, true, envId);
			removedVolumes.push(volumeName);
			const envSuffix = envId ? ` (env ${envId})` : '';
			console.log(`[Scanner] Removed volume: ${volumeName}${envSuffix}`);
		} catch {
			// Volume might not exist, ignore
		}
	}

	// 2. Remove bind mount cache directories (rootless Docker mode, local only)
	if (!envId) {
		for (const scannerType of ['grype', 'trivy'] as const) {
			const cachePath = resolve(DATA_DIR, SCANNER_CACHE_DIR, scannerType);
			try {
				await rm(cachePath, { recursive: true, force: true });
				removedDirs.push(cachePath);
				console.log(`[Scanner] Removed cache directory: ${cachePath}`);
			} catch {
				// Directory might not exist, ignore
			}
		}
	}

	if (removedVolumes.length > 0 || removedDirs.length > 0) {
		console.log(`[Scanner] Cache cleanup complete: ${removedVolumes.length} volumes, ${removedDirs.length} directories removed`);
	}

	return { volumes: removedVolumes, dirs: removedDirs };
}
