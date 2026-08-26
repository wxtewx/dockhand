import { existsSync, mkdirSync, rmSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { GIT_SSH_KEY_PATH_ENV, makeSshKeyPath, removeSshKey } from './git-ssh-key';
import {
	getGitRepository,
	getGitCredential,
	updateGitRepository,
	getGitStack,
	updateGitStack,
	upsertStackSource,
	getEnvironment,
	type GitRepository,
	type GitCredential,
	type GitStackWithRepo
} from './db';
import { deployStack, getStackDir } from './stacks';
import { sendEventNotification } from './notifications';
import { buildBasicAuthHeader } from './git-auth';
import { assertSafeRepoUrl, assertSafeGitRef, repoFilePath } from './git-url-safety';
import { assertSafeRepoTarget } from './git-branch-lookup';
import { resolveStackBranch } from '../git-stack-branch';
import {
	parseManifest,
	serializeManifest,
	hashDirFiles,
	computeDeletions,
	buildNextManifest,
	buildSyncChangeSummary,
	formatChangeTable,
	skipReasonMessage,
	deletionSafetyCheck,
	type DeletionPlan,
	type DeletionApplyResult,
	type DeletionSkip,
	type SyncManifest
} from './git-deletions';

const MERGED_CA_BUNDLE_PATH = '/tmp/dockhand-merged-ca-bundle.crt';
let mergedCaBundleReady = false;

/**
 * Create a merged CA bundle combining system CAs with the custom cert from
 * NODE_EXTRA_CA_CERTS. GIT_SSL_CAINFO replaces the default CA store, so without
 * merging, public CAs (GitHub, GitLab) break.
 */
function getMergedCaBundlePath(): string {
	if (mergedCaBundleReady && existsSync(MERGED_CA_BUNDLE_PATH)) {
		console.log(`[Git] 使用缓存的合并 CA 证书包: ${MERGED_CA_BUNDLE_PATH}`);
		return MERGED_CA_BUNDLE_PATH;
	}

	const customCertPath = process.env.NODE_EXTRA_CA_CERTS!;
	console.log(`[Git] NODE_EXTRA_CA_CERTS 已设置为: ${customCertPath}`);

	const systemCaPaths = [
		process.env.SSL_CERT_FILE,
		'/etc/ssl/certs/ca-certificates.crt',
		'/etc/pki/tls/certs/ca-bundle.crt',
		'/etc/ssl/cert.pem'
	];

	let systemCaContent = '';
	let systemCaSource = '';
	for (const caPath of systemCaPaths) {
		if (caPath && existsSync(caPath)) {
			try {
				systemCaContent = readFileSync(caPath, 'utf-8');
				systemCaSource = caPath;
				console.log(`[Git] 找到系统 CA 证书包：${caPath} (${systemCaContent.split('-----BEGIN CERTIFICATE-----').length - 1} 个证书)`);
				break;
			} catch (err) {
				console.log(`[Git] 无法读取系统 CA 证书包 ${caPath}: ${err}`);
			}
		}
	}

	if (!systemCaSource) {
		console.log(`[Git] 未找到系统 CA 证书包，仅使用自定义证书：${customCertPath}`);
	}

	try {
		const customCaContent = readFileSync(customCertPath, 'utf-8');
		const customCertCount = customCaContent.split('-----BEGIN CERTIFICATE-----').length - 1;
		console.log(`[Git] 自定义CA文件包含 ${customCertCount} 个证书`);

		const merged = systemCaContent
			? systemCaContent.trimEnd() + '\n' + customCaContent.trimEnd() + '\n'
			: customCaContent;
		writeFileSync(MERGED_CA_BUNDLE_PATH, merged);
		mergedCaBundleReady = true;

		const totalCerts = merged.split('-----BEGIN CERTIFICATE-----').length - 1;
		console.log(`[Git] 已创建合并的CA证书包：${MERGED_CA_BUNDLE_PATH} (共 ${totalCerts} 个证书 — 系统来自 ${systemCaSource || '无'} + 自定义来自 ${customCertPath})`);
	} catch (err) {
		console.warn(`[Git] 创建合并的CA证书包失败，回退至仅使用自定义证书：${customCertPath}`, err);
		return customCertPath;
	}

	return MERGED_CA_BUNDLE_PATH;
}

/**
 * Collect stdout, stderr and exit code from a spawned process.
 */
function collectProcess(proc: ChildProcess): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
		proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
		proc.on('error', reject);
		proc.on('close', (code) => {
			resolve({
				exitCode: code ?? 1,
				stdout: Buffer.concat(stdoutChunks).toString(),
				stderr: Buffer.concat(stderrChunks).toString()
			});
		});
	});
}

// Directory for storing cloned repositories
const dataDir = process.env.DATA_DIR || './data';
const GIT_REPOS_DIR = resolve(process.env.GIT_REPOS_DIR || join(dataDir, 'git-repos'));

// Ensure git repos directory exists
if (!existsSync(GIT_REPOS_DIR)) {
	mkdirSync(GIT_REPOS_DIR, { recursive: true });
}

export function getGitReposDir(): string {
	return GIT_REPOS_DIR;
}

/**
 * Redact all env var values for safe logging. Only key names are preserved.
 */
function redactEnvVarsForLog(vars: Record<string, string>): Record<string, string> {
	const redacted: Record<string, string> = {};
	for (const key of Object.keys(vars)) {
		redacted[key] = '***';
	}
	return redacted;
}

function getRepoPath(repoId: number): string {
	return join(GIT_REPOS_DIR, `repo-${repoId}`);
}

interface GitEnv {
	[key: string]: string;
}

const NSS_WRAPPER_LIB = '/usr/lib/libnss_wrapper.so';
const TMP_PASSWD = '/tmp/dockhand-passwd';
const TMP_GROUP = '/tmp/dockhand-group';

// Cache the check so we only do it once per process
let _nssWrapperChecked = false;
let _nssWrapperNeeded = false;

/**
 * Ensures the current UID exists in /etc/passwd for git/SSH operations.
 * SSH calls getpwuid() which fails with "No user exists for uid XXXX" if the
 * UID isn't in /etc/passwd (common with Docker --user or read-only containers).
 * Creates a temp passwd file and configures LD_PRELOAD with libnss_wrapper.
 */
async function ensurePasswdEntry(env: GitEnv): Promise<void> {
	if (_nssWrapperChecked) {
		if (_nssWrapperNeeded) {
			env.LD_PRELOAD = env.LD_PRELOAD ? `${env.LD_PRELOAD}:${NSS_WRAPPER_LIB}` : NSS_WRAPPER_LIB;
			env.NSS_WRAPPER_PASSWD = TMP_PASSWD;
			env.NSS_WRAPPER_GROUP = TMP_GROUP;
		}
		return;
	}
	_nssWrapperChecked = true;

	// Check if current UID is in /etc/passwd
	const uid = process.getuid?.();
	if (uid === undefined || uid === 0) return; // root or not available

	try {
		const passwd = readFileSync('/etc/passwd', 'utf-8');
		const uidStr = `:${uid}:`;
		if (passwd.split('\n').some(line => {
			const parts = line.split(':');
			return parts[2] === String(uid);
		})) {
			return; // UID exists, nothing to do
		}
	} catch {
		return; // can't read passwd, bail
	}

	// UID not found — check if libnss_wrapper is available
	if (!existsSync(NSS_WRAPPER_LIB)) {
		console.warn(`[git] UID ${uid} 不在 /etc/passwd 中，且未找到 libnss_wrapper — SSH 可能失败`);
		return;
	}

	// Create temp passwd/group with the missing entry
	try {
		const gid = process.getgid?.() ?? uid;
		const passwd = readFileSync('/etc/passwd', 'utf-8');
		const group = readFileSync('/etc/group', 'utf-8');

		const passwdEntry = `dockhand:x:${uid}:${gid}:Dockhand:/home/dockhand:/bin/sh`;
		writeFileSync(TMP_PASSWD, passwd.trimEnd() + '\n' + passwdEntry + '\n');

		const gidExists = group.split('\n').some(line => line.split(':')[2] === String(gid));
		if (gidExists) {
			writeFileSync(TMP_GROUP, group);
		} else {
			writeFileSync(TMP_GROUP, group.trimEnd() + '\n' + `dockhand:x:${gid}:\n`);
		}

		_nssWrapperNeeded = true;
		env.LD_PRELOAD = env.LD_PRELOAD ? `${env.LD_PRELOAD}:${NSS_WRAPPER_LIB}` : NSS_WRAPPER_LIB;
		env.NSS_WRAPPER_PASSWD = TMP_PASSWD;
		env.NSS_WRAPPER_GROUP = TMP_GROUP;
		console.log(`[git] 已使用 libnss_wrapper 为 UID ${uid} 创建临时密码文件`);
	} catch (err) {
		console.warn(`[git] 创建临时密码文件失败：`, err);
	}
}

async function buildGitEnv(credential: GitCredential | null): Promise<GitEnv> {
	const env: GitEnv = {
		...process.env as GitEnv,
		GIT_TERMINAL_PROMPT: '0',
		// Prevent SSH agent from providing keys automatically
		SSH_AUTH_SOCK: ''
	};

	// Pass custom CA certificate to git CLI (NODE_EXTRA_CA_CERTS only affects Node.js).
	// GIT_SSL_CAINFO replaces the default CA store, so we merge system CAs with the
	// custom cert so both self-signed repos and public repos (GitHub etc.) work (#967).
	if (process.env.NODE_EXTRA_CA_CERTS) {
		env.GIT_SSL_CAINFO = getMergedCaBundlePath();
	}

	// Ensure current UID is resolvable for SSH/git operations
	await ensurePasswdEntry(env);

	// For HTTPS password/token auth, inject credentials via http.extraHeader env vars
	// instead of embedding them in the URL (which leaks via /proc/<pid>/cmdline, #1081).
	// Uses GIT_CONFIG_COUNT mechanism (git >= 2.31) to set Authorization header.
	if (credential?.authType === 'password' && (credential.username || credential.password)) {
		// Basic auth (base64 of username:password) — works with GitHub PATs, GitLab
		// tokens, Gitea tokens, and standard username/password combos. Empty username
		// is defaulted inside buildBasicAuthHeader (see #1273).
		env.GIT_CONFIG_COUNT = '1';
		env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
		env.GIT_CONFIG_VALUE_0 = buildBasicAuthHeader(credential.username || '', credential.password || '');
	}

	if (credential?.authType === 'ssh' && credential.sshPrivateKey) {
		// Write SSH key to /tmp instead of data volume — some filesystems (TrueNAS ZFS,
		// NFS, CIFS) silently ignore chmod, leaving the key group-readable (e.g. 0670).
		// SSH refuses keys that are accessible by others. /tmp is always a proper filesystem.
		// Unique per operation so concurrent syncs of the SAME credential don't share
		// one file; otherwise one op's cleanup deletes the key mid-clone of another
		// (#1413). The path is stashed in env for cleanupSshKey to remove exactly.
		const sshKeyPath = makeSshKeyPath(credential.id);

		// Ensure SSH key ends with a newline (newer SSH versions are strict about this)
		let keyContent = credential.sshPrivateKey;
		if (!keyContent.endsWith('\n')) {
			keyContent += '\n';
		}

		writeFileSync(sshKeyPath, keyContent);
		// Ensure SSH key has correct permissions (0600 = owner read/write only)
		// writeFileSync's mode option doesn't always work reliably, so use chmodSync
		chmodSync(sshKeyPath, 0o600);

		// If key has a passphrase, decrypt it in-place so SSH can use it non-interactively
		if (credential.sshPassphrase) {
			const result = spawnSync(
				'ssh-keygen',
				['-p', '-f', sshKeyPath, '-P', credential.sshPassphrase, '-N', ''],
				{ env, stdio: ['pipe', 'pipe', 'pipe'] }
			);
			if (result.status !== 0) {
				const stderr = result.stderr.toString().trim();
				console.warn(`[git] 解密 SSH 密钥失败：${stderr}`);
			}
		}

		// Configure SSH to use ONLY this key (no agent, no default keys)
		env.GIT_SSH_COMMAND = `ssh -i "${sshKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes`;
		env[GIT_SSH_KEY_PATH_ENV] = sshKeyPath;
	} else {
		// No SSH credential - prevent using any keys (IdentitiesOnly=yes with no -i means no keys)
		env.GIT_SSH_COMMAND = 'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o PasswordAuthentication=no -o PubkeyAuthentication=no';
	}

	return env;
}

function cleanupSshKey(credential: GitCredential | null, env?: GitEnv): void {
	if (credential?.authType === 'ssh') {
		// Removes the exact per-operation key this env created; falls back to the old
		// deterministic path only if no env is available (legacy callers). See #1413.
		removeSshKey(credential.id, env);
	}
}

function buildRepoUrl(url: string, credential: GitCredential | null): string {
	assertSafeRepoUrl(url);
	// Never embed credentials in the URL — they leak via /proc/<pid>/cmdline (see #1081).
	// HTTPS credentials are injected via GIT_CONFIG_COUNT env vars in buildGitEnv().
	// Strip any existing credentials from the URL for safety.
	if (credential?.authType === 'password' && !url.startsWith('git@')) {
		try {
			const parsed = new URL(url);
			parsed.username = '';
			parsed.password = '';
			return parsed.toString();
		} catch {
			return url;
		}
	}
	return url;
}

/**
 * Hard timeout (ms) for the remote-branch lookup (git ls-remote) ONLY.
 * The lookup is the single git call whose target URL can be driven by an
 * attacker-chosen URL (POST /api/git/branches, the new-repository branch
 * picker), so an unbounded ls-remote is a resource-exhaustion vector.
 * NOTE: this constant is deliberately NOT applied to ordinary deploy/sync
 * operations (clone / pull / fetch / rev-parse) — those target the
 * operator's own repository over a controlled URL, and a legitimate
 * large-repo clone or slow WAN fetch can exceed this limit, so they stay
 * UNBOUNDED (execGit without an explicit timeout). */
export const GIT_TIMEOUT_MS = Number(process.env.GIT_TIMEOUT_MS) || 20000;

/**
 * Run a git command.
 *
 * Timeouts are OPT-IN: the default is UNBOUNDED. Ordinary deploy/sync
 * operations (clone, pull, fetch, rev-parse) are unbounded because their
 * target is the operator's own repository and a slow network or large repo
 * is a legitimate outcome — they must not be killed mid-flight. Callers
 * that need a bounded operation (the remote-branch lookup, whose target
 * URL is attacker-influenced) pass `timeoutMs` explicitly (see
 * listRemoteBranches).
 */
function execGit(
	args: string[],
	cwd: string,
	env: GitEnv,
	timeoutMs?: number
): Promise<{ stdout: string; stderr: string; code: number; timedOut?: boolean }> {
	return new Promise((resolve) => {
		let settled = false;
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		const proc = nodeSpawn('git', args, {
			cwd,
			env,
			stdio: ['pipe', 'pipe', 'pipe']
		});

		const finish = (
			partial: { stdout: string; stderr: string; code: number; timedOut?: boolean }
		) => {
			if (settled) return;
			settled = true;
			// Only clear a timer if one was actually created — the default
			// (no timeout) never creates one.
			if (timer) clearTimeout(timer);
			if (partial.timedOut) {
				// The process is still running — kill it so the git subprocess
				// (and any child ssh) cannot keep running after we give up.
				proc.kill('SIGKILL');
			}
			resolve(partial);
		};

		// Only arm a timer when a valid timeout was explicitly provided —
		// undefined (or non-finite / non-positive) means "run unbounded".
		const timer: ReturnType<typeof setTimeout> | undefined =
			timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0
				? setTimeout(() => {
						finish({
							stdout: Buffer.concat(stdoutChunks).toString(),
							stderr: Buffer.concat(stderrChunks).toString(),
							code: 124,
							timedOut: true
						});
					}, timeoutMs)
				: undefined;

		proc.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
		proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
		proc.on('error', (err: any) => {
			finish({ stdout: '', stderr: err.message, code: 1 });
		});
		proc.on('close', (code) => {
			finish({
				stdout: Buffer.concat(stdoutChunks).toString(),
				stderr: Buffer.concat(stderrChunks).toString(),
				code: code ?? 1
			});
		});
	});
}

/**
 * Get list of files that changed between two commits in a specific directory.
 * Returns array of changed file paths (relative to repo root).
 */
async function getChangedFilesInDir(
	repoPath: string,
	previousCommit: string,
	newCommit: string,
	dirPath: string,
	env: GitEnv
): Promise<{ changed: boolean; files: string[]; error?: string }> {
	if (!previousCommit) {
		// No previous commit means this is a new clone - always deploy
		return { changed: true, files: ['(全新克隆 - 所有文件)'] };
	}

	// Use git diff --name-only to get all changed files in the directory
	// The trailing slash ensures we only match files IN that directory (and subdirs)
	const dirPattern = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
	const result = await execGit(
		['diff', '--name-only', previousCommit, newCommit, '--', dirPattern],
		repoPath,
		env
	);

	// If the command fails (e.g., previousCommit no longer exists after force push),
	// assume files changed to be safe
	if (result.code !== 0) {
		return { changed: true, files: ['(差异对比失败 - 假定已变更)'], error: result.stderr };
	}

	// Parse changed files
	const changedFiles = result.stdout.trim()
		.split('\n')
		.filter(f => f.length > 0);

	return { changed: changedFiles.length > 0, files: changedFiles };
}

/**
 * Compute the deletion plan for a sync: hash the new clone's compose dir and
 * diff against the manifest from the last sync. Deletions converge the deploy
 * dir toward the clone state; the applier additionally verifies each file's
 * disk hash. A sanity guard blocks ALL deletions when the clone walk looks
 * broken (empty, or missing the compose file).
 */
async function computeSyncDeletionPlan(options: {
	logPrefix: string;
	composeDir: string; // absolute path inside the clone
	composeFileName: string | undefined; // compose file relative to composeDir
	rawManifest: string | null | undefined;
}): Promise<{ plan: DeletionPlan; newFiles: Record<string, string>; previousManifest: SyncManifest }> {
	const { logPrefix, composeDir, composeFileName, rawManifest } = options;

	const previousManifest = parseManifest(rawManifest);
	const newFiles = hashDirFiles(composeDir);

	const manifestSize = Object.keys(previousManifest.files).length;
	console.log(`${logPrefix} 删除同步: 清单包含 ${manifestSize} 个文件${manifestSize === 0 ? ' (首次同步，不会删除任何文件)' : ''}`);

	// First sync / legacy manifest: nothing was recorded, so nothing can be deleted
	if (manifestSize === 0) {
		return { plan: { toDelete: [], skipped: [] }, newFiles, previousManifest };
	}

	const blocked = deletionSafetyCheck(previousManifest.files, newFiles, composeFileName);
	if (blocked) {
		console.warn(`${logPrefix} 删除同步: ${blocked}`);
		return { plan: { toDelete: [], skipped: [] }, newFiles, previousManifest };
	}

	const plan = computeDeletions(previousManifest.files, newFiles);

	for (const file of plan.toDelete) {
		console.log(`${logPrefix} 删除同步: 将移除 "${file.path}" — 该文件已从仓库中移除`);
	}
	for (const skip of plan.skipped) {
		console.warn(`${logPrefix} 删除同步: 保留 "${skip.path}" — ${skipReasonMessage(skip.reason)}`);
	}

	return { plan, newFiles, previousManifest };
}

/**
 * Persist the manifest after a deploy and log the per-file change summary.
 * Called only after a successful deploy (locally applied or agent-confirmed).
 * Progress popovers show the plan-based change table before the deploy
 * instead (#1260); this summary (with real apply results) goes to the
 * server log only.
 */
async function finalizeDeletionSync(options: {
	stackId: number;
	logPrefix: string;
	previousManifest: SyncManifest;
	newCommitFull: string;
	newFiles: Record<string, string>;
	plan: DeletionPlan;
	applyResult: DeletionApplyResult | undefined;
}): Promise<void> {
	const { stackId, logPrefix, previousManifest, newCommitFull, newFiles, plan, applyResult } = options;

	// No apply result means deletions were requested but nothing reported back
	// (defensive — executors always return one). Logged as skips; skips are final.
	const effectiveApply: DeletionApplyResult = applyResult ?? {
		deleted: [],
		skipped: plan.toDelete.map((f): DeletionSkip => ({ path: f.path, reason: 'apply-failed' }))
	};

	// Pass only the plan-stage skips; buildSyncChangeSummary already merges
	// in effectiveApply.skipped itself. Concatenating here duplicated every
	// apply-stage skip (locally-modified, agent-no-support, apply-failed).
	const summary = buildSyncChangeSummary(previousManifest.files, newFiles, effectiveApply, plan.skipped);
	const tableLines = formatChangeTable(summary);

	console.log(`${logPrefix} 同步文件变更: ${tableLines[0]}`);
	for (const line of tableLines.slice(1)) {
		console.log(`${logPrefix}   ${line}`);
	}

	const nextManifest = buildNextManifest(newCommitFull, newFiles);
	await updateGitStack(stackId, { syncedFiles: serializeManifest(nextManifest) });
	console.log(`${logPrefix} 清单已持久化: 共 ${Object.keys(nextManifest.files).length} 个文件，提交哈希 ${nextManifest.commit?.substring(0, 7)}`);
}

export interface SyncResult {
	success: boolean;
	commit?: string;
	composeContent?: string;
	composeDir?: string; // Directory containing the compose file (for copying all files)
	composeFileName?: string; // Filename of the compose file (e.g., "docker-compose.yaml")
	envFileVars?: Record<string, string>; // Variables from .env file in repo
	envFileContent?: string; // Raw .env file content (for Hawser deployments)
	envFileName?: string; // Filename of env file relative to composeDir (e.g., ".env" or "../.env")
	error?: string;
	updated?: boolean;
	changedFiles?: string[]; // List of files that changed (for logging/debugging)
	// Deletion sync (#966/#1162): manifest-vs-clone data
	deletionPlan?: DeletionPlan; // Files safe to delete (manifest entries absent from the new clone) + plan-stage skips
	newFiles?: Record<string, string>; // path → sha256 of files in the new clone (next manifest)
	newCommitFull?: string; // Full 40-char commit hash (manifest commit)
	previousManifest?: SyncManifest; // Manifest from the last successful sync
}

export interface TestResult {
	success: boolean;
	branch?: string;
	lastCommit?: string;
	composeFileExists?: boolean;
	error?: string;
}

/**
 * Clean up git/SSH error messages for user display
 */
function cleanGitError(stderr: string): string {
	// Remove SSH warnings and noise
	const lines = stderr.split('\n').filter(line => {
		const l = line.trim().toLowerCase();
		// Skip SSH warnings
		if (l.startsWith('警告：')) return false;
		if (l.includes('已添加') && l.includes('到已知主机列表')) return false;
		// Skip empty lines
		if (!l) return false;
		return true;
	});

	// Find the most relevant error
	const fatalLine = lines.find(l => l.toLowerCase().includes('致命错误：'));
	const permissionLine = lines.find(l => l.toLowerCase().includes('权限被拒绝'));
	const errorLine = lines.find(l => l.toLowerCase().includes('错误：'));

	// Return cleaner message
	if (permissionLine) {
		return '权限被拒绝。请检查你的 SSH 凭据。';
	}
	if (fatalLine) {
		// Clean up common fatal messages
		const msg = fatalLine.replace(/^fatal:\s*/i, '').trim();
		if (msg.includes('Could not read from remote repository')) {
			return '无法访问仓库。请检查 URL 和凭据。';
		}
		return msg;
	}
	if (errorLine) {
		return errorLine.replace(/^error:\s*/i, '').trim();
	}

	// Fallback to original (joined and trimmed)
	return lines.join(' ').trim() || '连接仓库失败';
}

/**
 * Core function to test a git repository connection.
 * Tests the URL, branch, and credentials passed directly (not from DB).
 */
async function testRepositoryConnection(options: {
	url: string;
	branch: string;
	credential: GitCredential | null;
}): Promise<TestResult> {
	const { url, branch, credential } = options;

	const env = await buildGitEnv(credential);
	assertSafeGitRef(branch);
	const repoUrl = buildRepoUrl(url, credential);

	try {
		// Use git ls-remote to test connection and verify branch
		const result = await execGit(
			['ls-remote', '--heads', '--refs', repoUrl, branch || 'HEAD'],
			process.cwd(),
			env
		);

		if (result.code !== 0) {
			console.error('[Git] 连接测试失败：', result.stderr);
			return { success: false, error: cleanGitError(result.stderr) };
		}

		// Parse the output to get commit hash
		const lines = result.stdout.split('\n').filter(l => l.trim());
		if (lines.length === 0) {
			// Branch not found, but connection worked - check if repo has any branches
			const allBranchesResult = await execGit(
				['ls-remote', '--heads', '--refs', repoUrl],
				process.cwd(),
				env
			);

			if (allBranchesResult.code !== 0) {
				return { success: false, error: cleanGitError(allBranchesResult.stderr) };
			}

			const allBranches = allBranchesResult.stdout.split('\n')
				.filter(l => l.trim())
				.map(l => {
					const m = l.match(/refs\/heads\/(.+)$/);
					return m ? m[1] : null;
				})
				.filter(Boolean);

			if (allBranches.length === 0) {
				return { success: true, branch: '(空仓库)' };
			}

			return {
				success: false,
				error: `未找到分支 '${branch}'。可用分支：${allBranches.slice(0, 5).join(', ')}${allBranches.length > 5 ? '...' : ''}`
			};
		}

		const match = lines[0].match(/^([a-f0-9]+)\s+refs\/heads\/(.+)$/);
		const lastCommit = match ? match[1].substring(0, 7) : undefined;
		const foundBranch = match ? match[2] : branch;

		return {
			success: true,
			branch: foundBranch,
			lastCommit
		};
	} catch (error: any) {
		return { success: false, error: error.message };
	} finally {
		cleanupSshKey(credential, env);
	}
}

/**
 * Test a saved repository from the database (used by grid test button).
 */
export async function testRepository(repoId: number): Promise<TestResult> {
	const repo = await getGitRepository(repoId);
	if (!repo) {
		return { success: false, error: '仓库不存在' };
	}

	const credential = repo.credentialId ? await getGitCredential(repo.credentialId) : null;

	return testRepositoryConnection({
		url: repo.url,
		branch: repo.branch,
		credential
	});
}

/**
 * Test a repository configuration before saving (used by modal test button).
 * Uses credentialId to fetch stored credentials from the database.
 */
export async function testRepositoryConfig(options: {
	url: string;
	branch: string;
	credentialId?: number | null;
}): Promise<TestResult> {
	const { url, branch, credentialId } = options;

	if (!url) {
		return { success: false, error: '仓库 URL 为必填项' };
	}

	// Transport denylist (ext::/fd::/file::/local paths) — applied here so the
	// denylist holds on every path into a git subprocess, not only via
	// buildRepoUrl (same pattern as listRemoteBranches).
	assertSafeRepoUrl(url);

	// Fetch credential from database if credentialId is provided
	const credential = credentialId ? await getGitCredential(credentialId) : null;
	if (credentialId && !credential) {
		return { success: false, error: '凭据不存在' };
	}

	return testRepositoryConnection({
		url,
		branch: branch || 'main',
		credential
	});
}

/**
 * List remote branches for a repository URL using git ls-remote.
 * Resolves credentials from the database if a credentialId is provided.
 * Bounded by a hard timeout (default GIT_TIMEOUT_MS, 20s) so a dead or
 * black-holed host cannot stall the request — see execGit. This is the
 * only git operation with a timeout: its target URL is the one that can be
 * attacker-influenced, so an unbounded ls-remote would be a resource-
 * exhaustion vector.
 *
 * The transport denylist (ext::/fd::/file::/local paths) is applied HERE,
 * explicitly, rather than only via buildRepoUrl — a future parser change in
 * buildRepoUrl must not be able to reopen command execution on this path.
 */
export interface RemoteBranch {
	name: string;
	/** Short (7-char) commit SHA the branch points at, from ls-remote. */
	sha: string;
}

export async function listRemoteBranches(options: {
	url: string;
	credentialId?: number | null;
	timeoutMs?: number;
}): Promise<{ branches: RemoteBranch[]; error?: string }> {
	const { url, credentialId, timeoutMs } = options;

	// The effective branch-lookup timeout: an explicitly provided (valid)
	// override wins; otherwise the default GIT_TIMEOUT_MS. This is the ONLY
	// bounded git operation — see execGit for why deploy/sync operations are
	// left unbounded.
	const effectiveTimeoutMs = timeoutMs ?? GIT_TIMEOUT_MS;

	// Transport denylist — the same check buildRepoUrl applies, applied
	// explicitly here so the denylist holds even if buildRepoUrl changes.
	assertSafeRepoUrl(url);

	// Fetch credential from database if credentialId is provided
	const credential = credentialId ? await getGitCredential(credentialId) : null;

	const env = await buildGitEnv(credential);
	const repoUrl = buildRepoUrl(url, credential);

	try {
		const result = await execGit(
			['ls-remote', '--heads', '--refs', repoUrl],
			process.cwd(),
			env,
			effectiveTimeoutMs
		);

		if (result.timedOut) {
			return { branches: [], error: `git ls-remote 在 ${Math.round(effectiveTimeoutMs / 1000)} 秒后超时` };
		}

		if (result.code !== 0) {
			return { branches: [], error: cleanGitError(result.stderr) };
		}

		// Each line: "<sha>\trefs/heads/<name>". Keep the SHA (short) so the
		// picker can show it; it was previously discarded.
		const branches = result.stdout.split('\n')
			.map(l => {
				const m = l.match(/^([0-9a-f]+)\s+refs\/heads\/(.+)$/);
				return m ? { name: m[2], sha: m[1].slice(0, 7) } : null;
			})
			.filter(Boolean) as RemoteBranch[];

		return { branches };
	} catch (error: any) {
		return { branches: [], error: error.message };
	} finally {
		cleanupSshKey(credential);
	}
}

export async function syncRepository(repoId: number): Promise<SyncResult> {
	const repo = await getGitRepository(repoId);
	if (!repo) {
		return { success: false, error: '仓库不存在' };
	}

	// Check if sync is already in progress
	if (repo.syncStatus === 'syncing') {
		return { success: false, error: '同步已在进行中' };
	}

	const credential = repo.credentialId ? await getGitCredential(repo.credentialId) : null;
	const repoPath = getRepoPath(repoId);
	const env = await buildGitEnv(credential);

	try {
		// Update sync status
		await updateGitRepository(repoId, { syncStatus: 'syncing', syncError: null });

		let updated = false;
		let currentCommit = '';

		if (!existsSync(repoPath)) {
			// Clone the repository (blobless clone - fetches all commits but blobs on-demand)
			assertSafeGitRef(repo.branch);
			const repoUrl = buildRepoUrl(repo.url, credential);

			const result = await execGit(
				['clone', '--filter=blob:none', '--branch', repo.branch, repoUrl, repoPath],
				process.cwd(),
				env
			);
			if (result.code !== 0) {
				// Clean up partial clone directory on failure
				if (existsSync(repoPath)) {
					rmSync(repoPath, { recursive: true, force: true });
				}
				throw new Error(`Git 拉取失败：${result.stderr}`);
			}

			updated = true;
		} else {
			// Get current commit before pull
			const beforeResult = await execGit(['rev-parse', 'HEAD'], repoPath, env);
			const beforeCommit = beforeResult.stdout;

			// Pull latest changes
			const result = await execGit(['pull', 'origin', repo.branch], repoPath, env);
			if (result.code !== 0) {
				throw new Error(`Git 克隆失败：${result.stderr}`);
			}

			// Get commit after pull
			const afterResult = await execGit(['rev-parse', 'HEAD'], repoPath, env);
			const afterCommit = afterResult.stdout;

			updated = beforeCommit !== afterCommit;
		}

		// Get current commit hash
		const commitResult = await execGit(['rev-parse', 'HEAD'], repoPath, env);
		currentCommit = commitResult.stdout.substring(0, 7);

		// Read the compose file
		const composePath = repoFilePath(repoPath, repo.composePath, "Compose path");
		if (!existsSync(composePath)) {
			throw new Error(`未找到 Compose 文件：${repo.composePath}`);
		}

		const composeContent = readFileSync(composePath, 'utf-8');

		// Update repository status
		await updateGitRepository(repoId, {
			syncStatus: 'synced',
			lastSync: new Date().toISOString(),
			lastCommit: currentCommit,
			syncError: null
		});

		cleanupSshKey(credential, env);

		return {
			success: true,
			commit: currentCommit,
			composeContent,
			updated
		};
	} catch (error: any) {
		cleanupSshKey(credential, env);
		await updateGitRepository(repoId, {
			syncStatus: 'error',
			syncError: error.message
		});
		return { success: false, error: error.message };
	}
}

export async function deployFromRepository(repoId: number): Promise<{ success: boolean; output?: string; error?: string }> {
	const repo = await getGitRepository(repoId);
	if (!repo) {
		return { success: false, error: '仓库不存在' };
	}

	// Sync first
	const syncResult = await syncRepository(repoId);
	if (!syncResult.success) {
		return { success: false, error: syncResult.error };
	}

	const stackName = repo.name;

	// Deploy using unified function - handles both new and existing stacks
	const result = await deployStack({
		name: stackName,
		compose: syncResult.composeContent!,
		envId: repo.environmentId
	});

	if (result.success) {
		// Record the stack source
		await upsertStackSource({
			stackName: stackName,
			environmentId: repo.environmentId,
			sourceType: 'git',
			gitRepositoryId: repoId
		});
	}

	return result;
}

export async function checkForUpdates(repoId: number): Promise<{ hasUpdates: boolean; currentCommit?: string; latestCommit?: string; error?: string }> {
	const repo = await getGitRepository(repoId);
	if (!repo) {
		return { hasUpdates: false, error: '仓库不存在' };
	}

	const credential = repo.credentialId ? await getGitCredential(repo.credentialId) : null;
	const repoPath = getRepoPath(repoId);
	const env = await buildGitEnv(credential);

	try {
		if (!existsSync(repoPath)) {
			return { hasUpdates: true, currentCommit: '无', latestCommit: '未知' };
		}

		// Get current commit
		const currentResult = await execGit(['rev-parse', 'HEAD'], repoPath, env);
		const currentCommit = currentResult.stdout.substring(0, 7);

		// Fetch latest without merging
		await execGit(['fetch', 'origin', repo.branch], repoPath, env);

		// Get remote commit
		const latestResult = await execGit(['rev-parse', `origin/${repo.branch}`], repoPath, env);
		const latestCommit = latestResult.stdout.substring(0, 7);

		cleanupSshKey(credential, env);

		return {
			hasUpdates: currentCommit !== latestCommit,
			currentCommit,
			latestCommit
		};
	} catch (error: any) {
		cleanupSshKey(credential, env);
		return { hasUpdates: false, error: error.message };
	}
}

export function deleteRepositoryFiles(repoId: number): void {
	const repoPath = getRepoPath(repoId);
	try {
		if (existsSync(repoPath)) {
			rmSync(repoPath, { recursive: true, force: true });
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[Git] 删除仓库文件失败：', errorMsg);
	}
}

// === Git Stack Functions ===

export async function getStackRepoPath(stackId: number, stackName?: string, environmentId?: number | null): Promise<string> {
	if (stackName && environmentId) {
		// Use old path if it already exists (backward compat), otherwise use name-based path
		const oldPath = join(GIT_REPOS_DIR, `stack-${stackId}`);
		if (existsSync(oldPath)) {
			return oldPath;
		}
		// Format: envName/stackName (e.g. production/webapp) - consistent with internal stacks
		const env = await getEnvironment(environmentId);
		const envDir = join(GIT_REPOS_DIR, env ? env.name : String(environmentId));
		if (!existsSync(envDir)) {
			mkdirSync(envDir, { recursive: true });
		}
		return join(envDir, stackName);
	}
	return join(GIT_REPOS_DIR, `stack-${stackId}`);
}

/**
 * Get the current commit hash from a repo path (if it exists).
 * Used to detect if repo was updated after re-clone.
 */
async function getPreviousCommit(repoPath: string, env: GitEnv): Promise<string | null> {
	if (!existsSync(repoPath)) {
		return null;
	}
	try {
		const result = await execGit(['rev-parse', 'HEAD'], repoPath, env);
		return result.code === 0 ? result.stdout.trim() : null;
	} catch {
		return null;
	}
}

/**
 * The effective branch a git stack deploys from is resolved by
 * resolveStackBranch() (src/lib/git-stack-branch.ts) — a per-stack branch
 * override (git_stacks.branch) wins; when it is unset, empty, or
 * whitespace-only, the repository's default branch is used.
 */

export async function syncGitStack(stackId: number): Promise<SyncResult> {
	const gitStack = await getGitStack(stackId);
	if (!gitStack) {
		return { success: false, error: 'Git 堆栈不存在' };
	}

	const logPrefix = `[堆栈:${gitStack.stackName}]`;
	console.log(`${logPrefix} ========================================`);
	console.log(`${logPrefix} 开始同步 Git 堆栈`);
	console.log(`${logPrefix} ========================================`);
	console.log(`${logPrefix} 堆栈 ID：`, stackId);
	console.log(`${logPrefix} 堆栈名称：`, gitStack.stackName);
	console.log(`${logPrefix} 仓库 ID：`, gitStack.repositoryId);
	console.log(`${logPrefix} Compose 路径：`, gitStack.composePath);
	console.log(`${logPrefix} 环境变量文件路径：`, gitStack.envFilePath || '(无)');
	console.log(`${logPrefix} 环境 ID：`, gitStack.environmentId);

	// Check if sync is already in progress
	if (gitStack.syncStatus === 'syncing') {
		console.log(`${logPrefix} 错误：同步已在进行中`);
		return { success: false, error: '同步已在进行中' };
	}

	const repo = await getGitRepository(gitStack.repositoryId);
	if (!repo) {
		console.log(`${logPrefix} 错误：仓库不存在`);
		return { success: false, error: '仓库不存在' };
	}

	// Per-stack branch override wins; unset means the repository default
	const effectiveBranch = resolveStackBranch(gitStack, repo);

	console.log(`${logPrefix} 仓库 URL:`, repo.url);
	console.log(`${logPrefix} 仓库分支:`, repo.branch);
	if (effectiveBranch !== repo.branch) {
		console.log(`${logPrefix} 堆栈分支覆盖配置:`, effectiveBranch);
	}

	const credential = repo.credentialId ? await getGitCredential(repo.credentialId) : null;
	const repoPath = await getStackRepoPath(stackId, gitStack.stackName, gitStack.environmentId);
	const env = await buildGitEnv(credential);

	console.log(`${logPrefix} 本地仓库路径：`, repoPath);
	console.log(`${logPrefix} 是否包含凭据：`, !!credential);

	try {
		// Update sync status
		await updateGitStack(stackId, { syncStatus: 'syncing', syncError: null });

		let updated = false;
		let currentCommit = '';

		// Always re-clone to ensure clean state (handles branch/URL/credential changes, force pushes, etc.)
		// Blobless clones fetch all commits (for git diff) but download blobs on-demand
		// Fall back to DB lastCommit when repo dir was deleted by a previous failed sync (#693)
		const previousCommit = await getPreviousCommit(repoPath, env) ?? gitStack.lastCommit ?? null;
		if (existsSync(repoPath)) {
			console.log(`${logPrefix} 正在删除现有克隆以进行全新同步...`);
			rmSync(repoPath, { recursive: true, force: true });
		}

		console.log(`${logPrefix} 正在克隆仓库...`);
		assertSafeGitRef(effectiveBranch);
		const repoUrl = buildRepoUrl(repo.url, credential);

		const result = await execGit(
			['clone', '--filter=blob:none', '--branch', effectiveBranch, repoUrl, repoPath],
			process.cwd(),
			env
		);
		console.log(`${logPrefix} 克隆退出码：`, result.code);
		if (result.stdout) console.log(`${logPrefix} 克隆标准输出：`, result.stdout);
		if (result.stderr) console.log(`${logPrefix} 克隆标准错误：`, result.stderr);

		if (result.code !== 0) {
			// Clean up partial clone directory on failure
			if (existsSync(repoPath)) {
				rmSync(repoPath, { recursive: true, force: true });
			}
			throw new Error(`Git 克隆失败：${result.stderr}`);
		}

		// Check if commit changed
		const newCommitResult = await execGit(['rev-parse', 'HEAD'], repoPath, env);
		const newCommit = newCommitResult.stdout.trim();
		// Normalize to 7-char short hash for comparison (DB stores 7-char, git returns 40-char)
		const commitChanged = previousCommit?.substring(0, 7) !== newCommit.substring(0, 7);
		console.log(`${logPrefix} 上一次提交：${previousCommit || '(无)'}，新提交：${newCommit.substring(0, 7)}，提交已变更：${commitChanged}`);

		// Check if any files in the compose file's directory have changed
		// This catches changes to the compose file, env files, and any other referenced files
		// (e.g., config files, scripts, additional env files)
		let changedFiles: string[] = [];
		if (commitChanged) {
			// Use contextDir if set, otherwise fall back to compose file's directory
			const diffDirRelative = gitStack.contextDir || dirname(gitStack.composePath);
			console.log(`${logPrefix} 正在检查目录中的变更: ${diffDirRelative || '(root)'}`);

			const diffResult = await getChangedFilesInDir(
				repoPath,
				previousCommit,
				newCommit,
				diffDirRelative || '.',
				env
			);

			updated = diffResult.changed;
			changedFiles = diffResult.files;

			if (diffResult.error) {
				console.log(`${logPrefix} 差异对比错误：${diffResult.error}`);
			}

			if (changedFiles.length > 0) {
				console.log(`${logPrefix} 已变更文件 (${changedFiles.length} 个):`);
				for (const file of changedFiles) {
					console.log(`${logPrefix}   - ${file}`);
				}
			} else {
				console.log(`${logPrefix} 堆栈目录中无文件变更`);
			}
		} else {
			updated = false;
			console.log(`${logPrefix} 提交无变化，跳过文件差异对比`);
		}

		// Get current commit hash
		const commitResult = await execGit(['rev-parse', 'HEAD'], repoPath, env);
		currentCommit = commitResult.stdout.substring(0, 7);
		console.log(`${logPrefix} 当前提交：`, currentCommit);

		// Read the compose file
		const composePath = repoFilePath(repoPath, gitStack.composePath, "Compose path");
		console.log(`${logPrefix} 正在读取 Compose 文件:`, composePath);
		if (!existsSync(composePath)) {
			console.log(`${logPrefix} 错误：未找到 Compose 文件：`, composePath);
			throw new Error(`未找到 Compose 文件：${gitStack.composePath}`);
		}

		const composeContent = readFileSync(composePath, 'utf-8');
		console.log(`${logPrefix} Compose 内容长度：`, composeContent.length, '字符');
		console.log(`${logPrefix} Compose 内容：`);
		console.log(composeContent);

		// Determine the source directory and compose filename
		// If contextDir is set, use it as the source directory (relative to repo root)
		// and compute composeFileName as relative path from contextDir to compose file
		let composeDir: string;
		let composeFileName: string;
		if (gitStack.contextDir) {
			const contextDirAbsolute = resolve(repoPath, gitStack.contextDir);
			// Validate: context dir must be within repo
			if (!contextDirAbsolute.startsWith(repoPath)) {
				throw new Error('上下文目录必须位于仓库内');
			}
			// Validate: compose file must be within context directory
			const relCompose = relative(contextDirAbsolute, composePath);
			if (relCompose.startsWith('..')) {
				throw new Error('Compose 文件必须位于上下文目录内');
			}
			composeDir = contextDirAbsolute;
			composeFileName = relCompose; // e.g., "apps/myapp/compose.yaml"
		} else {
			composeDir = dirname(composePath);
			composeFileName = basename(gitStack.composePath); // e.g., "docker-compose.yaml"
		}
		console.log(`${logPrefix} 源目录 (composeDir):`, composeDir);
		console.log(`${logPrefix} Compose 文件名:`, composeFileName);

		// Read env file if configured (optional - don't fail if missing)
		let envFileVars: Record<string, string> | undefined;
		let envFileContent: string | undefined;
		let envFileName: string | undefined;
		if (gitStack.envFilePath) {
			const envFilePath = repoFilePath(repoPath, gitStack.envFilePath, "Env file path");
			console.log(`${logPrefix} 正在查找环境变量文件:`, envFilePath);
			if (existsSync(envFilePath)) {
				try {
					console.log(`${logPrefix} 正在读取环境变量文件...`);
					envFileContent = readFileSync(envFilePath, 'utf-8');
					envFileVars = parseEnvFileContent(envFileContent, gitStack.stackName);
					console.log(`${logPrefix} 环境变量文件解析完成，变量数量：`, Object.keys(envFileVars).length);

					// Compute env file path relative to compose directory
					// This is needed for --env-file flag after files are copied to stack directory
					envFileName = relative(composeDir, envFilePath);
					console.log(`${logPrefix} 相对于 Compose 目录的环境变量文件名：`, envFileName);
				} catch (err) {
					// Log but don't fail - env file is optional
					console.warn(`${logPrefix} 读取环境变量文件 ${gitStack.envFilePath} 失败：`, err);
				}
			} else {
				console.warn(`${logPrefix} 未找到配置的环境变量文件：`, gitStack.envFilePath);
			}
		} else {
			console.log(`${logPrefix} 未配置环境变量文件路径`);
		}

		// Deletion sync (#966): manifest-vs-clone deletion plan
		const deletionData = await computeSyncDeletionPlan({
			logPrefix,
			composeDir,
			composeFileName,
			rawManifest: gitStack.syncedFiles
		});

		// Update git stack status
		await updateGitStack(stackId, {
			syncStatus: 'synced',
			lastSync: new Date().toISOString(),
			lastCommit: currentCommit,
			syncError: null
		});

		cleanupSshKey(credential, env);

		console.log(`${logPrefix} ----------------------------------------`);
		console.log(`${logPrefix} Git 堆栈同步完成`);
		console.log(`${logPrefix} ----------------------------------------`);
		console.log(`${logPrefix} 成功：true`);
		console.log(`${logPrefix} 已更新：`, updated);
		console.log(`${logPrefix} 已变更文件：`, changedFiles.length > 0 ? changedFiles.join(', ') : '(无)');
		console.log(`${logPrefix} 提交：`, currentCommit);
		console.log(`${logPrefix} 环境变量文件变量数：`, envFileVars ? Object.keys(envFileVars).length : 0);

		return {
			success: true,
			commit: currentCommit,
			composeContent,
			composeDir,
			composeFileName,
			envFileVars,
			envFileName,
			updated,
			changedFiles,
			deletionPlan: deletionData.plan,
			newFiles: deletionData.newFiles,
			newCommitFull: newCommit,
			previousManifest: deletionData.previousManifest
		};
	} catch (error: any) {
		cleanupSshKey(credential, env);
		await updateGitStack(stackId, {
			syncStatus: 'error',
			syncError: error.message
		});
		console.log(`${logPrefix} 同步错误：`, error.message);
		return { success: false, error: error.message };
	}
}

/**
 * Fire the git_sync_success / git_sync_failed / git_sync_skipped notification for a
 * git-stack deploy. Called from deployGitStack so EVERY caller notifies — webhook,
 * manual API deploy, create/update, and the scheduler alike. Previously the dispatch
 * lived only in the git-stack-sync scheduler task, so webhook/manual deploys were
 * silent (#1295). Best-effort: never changes the deploy outcome.
 */
async function notifyGitSync(stackName: string, envId: number | null | undefined, result: { success: boolean; error?: string; skipped?: boolean }): Promise<void> {
	try {
		if (result.success && result.skipped) {
			await sendEventNotification('git_sync_skipped', {
				title: 'Git 同步已跳过',
				message: `堆栈 "${stackName}" 同步已跳过：未检测到变更`,
				type: 'info'
			}, envId ?? undefined);
		} else if (result.success) {
			await sendEventNotification('git_sync_success', {
				title: 'Git 堆栈已部署',
				message: `堆栈 "${stackName}" 同步并部署成功`,
				type: 'success'
			}, envId ?? undefined);
		} else {
			await sendEventNotification('git_sync_failed', {
				title: 'Git 同步失败',
				message: `堆栈 "${stackName}" 同步失败：${result.error || '未知错误'}`,
				type: 'error'
			}, envId ?? undefined);
		}
	} catch { /* never changes the deploy outcome */ }
}

export async function deployGitStack(stackId: number, options?: { force?: boolean }): Promise<{ success: boolean; output?: string; error?: string; skipped?: boolean }> {
	const force = options?.force ?? true; // Default to force for backward compatibility

	const gitStack = await getGitStack(stackId);
	if (!gitStack) {
		return { success: false, error: 'Git 堆栈不存在' };
	}

	const logPrefix = `[堆栈:${gitStack.stackName}]`;
	console.log(`${logPrefix} ========================================`);
	console.log(`${logPrefix} 开始部署 Git 堆栈`);
	console.log(`${logPrefix} ========================================`);
	console.log(`${logPrefix} 堆栈 ID：`, stackId);
	console.log(`${logPrefix} 强制部署：`, force);

	// Sync first
	console.log(`${logPrefix} 正在同步 Git 仓库...`);
	const syncResult = await syncGitStack(stackId);
	if (!syncResult.success) {
		console.log(`${logPrefix} 同步失败:`, syncResult.error);
		const failResult = { success: false, error: syncResult.error };
		await notifyGitSync(gitStack.stackName, gitStack.environmentId, failResult);
		return failResult;
	}

	console.log(`${logPrefix} 同步成功`);
	console.log(`${logPrefix} 同步结果 - 已更新：`, syncResult.updated);
	console.log(`${logPrefix} 同步结果 - 提交：`, syncResult.commit);
	console.log(`${logPrefix} 同步结果 - 环境变量文件变量：`, syncResult.envFileVars ? Object.keys(syncResult.envFileVars).length : 0);
	if (syncResult.envFileVars && Object.keys(syncResult.envFileVars).length > 0) {
		console.log(`${logPrefix} 环境文件变量键:`, Object.keys(syncResult.envFileVars).join(', '));
		console.log(`${logPrefix} 环境文件变量 (已脱敏):`, JSON.stringify(redactEnvVarsForLog(syncResult.envFileVars), null, 2));
	}

	// Check if there are changes - skip redeploy if no changes and not forced
	// Note: For new stacks (first deploy), syncResult.updated will be true
	// forceRedeploy setting overrides the skip logic for webhooks/scheduled syncs
	const shouldDeploy = force || gitStack.forceRedeploy || syncResult.updated;
	if (!shouldDeploy) {
		console.log(`${logPrefix} 未检测到变更，且 force=false、forceRedeploy=false，跳过重新部署`);
		const skippedResult = {
			success: true,
			output: '未检测到变更，跳过重新部署',
			skipped: true
		};
		await notifyGitSync(gitStack.stackName, gitStack.environmentId, skippedResult);
		return skippedResult;
	}

	const forceRecreate = syncResult.updated;
	console.log(`${logPrefix} 将强制重新创建：`, forceRecreate, `(updated=${syncResult.updated})`);
	console.log(`${logPrefix} 部署时构建：`, gitStack.buildOnDeploy);
	console.log(`${logPrefix} 重新拉取镜像：`, gitStack.repullImages);
	console.log(`${logPrefix} 强制重新部署设置：`, gitStack.forceRedeploy);

	// Deploy using unified function - handles both new and existing stacks
	// Uses `docker compose up -d --remove-orphans` which only recreates changed services
	// Force recreate whenever git detected changes to ensure containers pick up
	// new env var values even if compose file itself didn't change
	console.log(`${logPrefix} 正在调用 deployStack...`);
	console.log(`${logPrefix} 源目录 (composeDir):`, syncResult.composeDir);
	console.log(`${logPrefix} Compose 文件名：`, syncResult.composeFileName);
	console.log(`${logPrefix} 环境变量文件名：`, syncResult.envFileName ?? '(无)');

	const result = await deployStack({
		name: gitStack.stackName,
		compose: syncResult.composeContent!,
		envId: gitStack.environmentId,
		sourceDir: syncResult.composeDir, // Copy entire directory from git repo
		composeFileName: syncResult.composeFileName, // Use original compose filename from repo
		envFileName: syncResult.envFileName, // Env file relative to compose dir (for --env-file flag, optional)
		forceRecreate,
		build: gitStack.buildOnDeploy,
		noBuildCache: gitStack.noBuildCache,
		pullPolicy: gitStack.repullImages ? 'always' : undefined,
		filesToDelete: syncResult.deletionPlan?.toDelete,
		isGitDeploy: true // suppress stack_* notification; we emit git_sync_* below
	});

	console.log(`${logPrefix} ----------------------------------------`);
	console.log(`${logPrefix} Git 堆栈部署结果`);
	console.log(`${logPrefix} ----------------------------------------`);
	console.log(`${logPrefix} 成功：`, result.success);
	if (result.output) console.log(`${logPrefix} 输出：`, result.output);
	if (result.error) console.log(`${logPrefix} 错误：`, result.error);

	if (result.success) {
		// Deletion sync: persist manifest + log per-file change summary
		if (syncResult.previousManifest && syncResult.newFiles && syncResult.newCommitFull && syncResult.deletionPlan) {
			await finalizeDeletionSync({
				stackId,
				logPrefix,
				previousManifest: syncResult.previousManifest,
				newCommitFull: syncResult.newCommitFull,
				newFiles: syncResult.newFiles,
				plan: syncResult.deletionPlan,
				applyResult: result.deletion
			});
		}

		// Record the stack source with resolved compose path for consistency
		const stackDir = await getStackDir(gitStack.stackName, gitStack.environmentId);
		const resolvedComposePath = syncResult.composeFileName
			? join(stackDir, syncResult.composeFileName)
			: undefined;

		console.log(`${logPrefix} 堆栈源解析后的 Compose 路径：`, resolvedComposePath);

		await upsertStackSource({
			stackName: gitStack.stackName,
			environmentId: gitStack.environmentId,
			sourceType: 'git',
			gitRepositoryId: gitStack.repositoryId,
			gitStackId: stackId,
			composePath: resolvedComposePath
		});
	}

	// git_sync_success / git_sync_failed for the actual deploy result. deployStack
	// suppressed its stack_* notification (isGitDeploy), so this is the single one.
	await notifyGitSync(gitStack.stackName, gitStack.environmentId, result);
	return result;
}

export async function testGitStack(stackId: number): Promise<TestResult> {
	const gitStack = await getGitStack(stackId);
	if (!gitStack) {
		return { success: false, error: 'Git 堆栈不存在' };
	}

	const repo = await getGitRepository(gitStack.repositoryId);
	if (!repo) {
		return { success: false, error: '仓库不存在' };
	}

	// Per-stack branch override wins; unset means the repository default
	const effectiveBranch = resolveStackBranch(gitStack, repo);

	const credential = repo.credentialId ? await getGitCredential(repo.credentialId) : null;
	const env = await buildGitEnv(credential);
	assertSafeGitRef(effectiveBranch);
	const repoUrl = buildRepoUrl(repo.url, credential);

	try {
		// Use git ls-remote to test connection and get branch info
		const result = await execGit(
			['ls-remote', '--heads', '--refs', repoUrl, effectiveBranch],
			process.cwd(),
			env
		);

		cleanupSshKey(credential, env);

		if (result.code !== 0) {
			return { success: false, error: result.stderr || '连接仓库失败' };
		}

		// Parse the output to get commit hash
		const lines = result.stdout.split('\n').filter(l => l.trim());
		if (lines.length === 0) {
			return { success: false, error: `仓库中未找到分支 '${effectiveBranch}'` };
		}

		const match = lines[0].match(/^([a-f0-9]+)\s+refs\/heads\/(.+)$/);
		const lastCommit = match ? match[1].substring(0, 7) : undefined;
		const branch = match ? match[2] : effectiveBranch;

		cleanupSshKey(credential, env);

		return {
			success: true,
			branch,
			lastCommit
		};
	} catch (error: any) {
		cleanupSshKey(credential, env);
		return { success: false, error: error.message };
	}
}

export async function deleteGitStackFiles(stackId: number, stackName?: string, environmentId?: number | null): Promise<void> {
	const repoPath = await getStackRepoPath(stackId, stackName, environmentId);
	try {
		if (existsSync(repoPath)) {
			rmSync(repoPath, { recursive: true, force: true });
		}
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error('[Git]  删除 Git 堆栈文件失败：', errorMsg);
	}
}

// Progress callback type
type ProgressCallback = (data: {
	status: 'connecting' | 'cloning' | 'fetching' | 'reading' | 'deploying' | 'complete' | 'error';
	message?: string;
	step?: number;
	totalSteps?: number;
	error?: string;
}) => void;

export async function deployGitStackWithProgress(
	stackId: number,
	onProgress: ProgressCallback
): Promise<{ success: boolean; output?: string; error?: string }> {
	const gitStack = await getGitStack(stackId);
	if (!gitStack) {
		onProgress({ status: 'error', error: 'Git 堆栈不存在' });
		return { success: false, error: 'Git 堆栈不存在' };
	}

	// Check if sync is already in progress
	if (gitStack.syncStatus === 'syncing') {
		onProgress({ status: 'error', error: '同步已在进行中' });
		return { success: false, error: '同步已在进行中' };
	}

	const repo = await getGitRepository(gitStack.repositoryId);
	if (!repo) {
		onProgress({ status: 'error', error: '仓库不存在' });
		return { success: false, error: '仓库不存在' };
	}

	// Per-stack branch override wins; unset means the repository default
	const effectiveBranch = resolveStackBranch(gitStack, repo);

	const credential = repo.credentialId ? await getGitCredential(repo.credentialId) : null;
	const repoPath = await getStackRepoPath(stackId, gitStack.stackName, gitStack.environmentId);
	const env = await buildGitEnv(credential);

	const totalSteps = 5;

	try {
		// Step 1: Connecting
		onProgress({ status: 'connecting', message: '正在连接仓库...', step: 1, totalSteps });
		await updateGitStack(stackId, { syncStatus: 'syncing', syncError: null });

		let updated = false;
		let currentCommit = '';

		// Always re-clone to ensure clean state (handles branch/URL/credential changes, force pushes, etc.)
		// Shallow clones are fast so this is acceptable
		// Fall back to DB lastCommit when repo dir was deleted by a previous failed sync (#693)
		const previousCommit = await getPreviousCommit(repoPath, env) ?? gitStack.lastCommit ?? null;

		// Step 2: Cloning
		onProgress({ status: 'cloning', message: '正在克隆仓库...', step: 2, totalSteps });

		if (existsSync(repoPath)) {
			rmSync(repoPath, { recursive: true, force: true });
		}

		assertSafeGitRef(effectiveBranch);
		const repoUrl = buildRepoUrl(repo.url, credential);

		// Step 3: Fetching (blobless clone - fetches all commits but blobs on-demand)
		onProgress({ status: 'fetching', message: `正在获取分支 ${effectiveBranch}...`, step: 3, totalSteps });
		const cloneResult = await execGit(
			['clone', '--filter=blob:none', '--branch', effectiveBranch, repoUrl, repoPath],
			process.cwd(),
			env
		);
		if (cloneResult.code !== 0) {
			// Clean up partial clone directory on failure
			if (existsSync(repoPath)) {
				rmSync(repoPath, { recursive: true, force: true });
			}
			throw new Error(`Git 克隆失败：${cloneResult.stderr}`);
		}

		// Check if commit changed
		const newCommitResult = await execGit(['rev-parse', 'HEAD'], repoPath, env);
		const newCommit = newCommitResult.stdout.trim();
		// Normalize to 7-char short hash for comparison (DB stores 7-char, git returns 40-char)
		const commitChanged = previousCommit?.substring(0, 7) !== newCommit.substring(0, 7);

		// Check if any files in the context/compose directory have changed
		// (for consistency with syncGitStack, though this function always deploys)
		if (commitChanged) {
			const diffDir = gitStack.contextDir || dirname(gitStack.composePath);
			const diffResult = await getChangedFilesInDir(
				repoPath,
				previousCommit,
				newCommit,
				diffDir || '.',
				env
			);
			updated = diffResult.changed;
		} else {
			updated = false;
		}

		// Get current commit hash
		const commitResult = await execGit(['rev-parse', 'HEAD'], repoPath, env);
		currentCommit = commitResult.stdout.substring(0, 7);

		// Step 4: Reading compose file
		onProgress({ status: 'reading', message: `正在读取 ${gitStack.composePath}...`, step: 4, totalSteps });
		const composePath = repoFilePath(repoPath, gitStack.composePath, "Compose path");
		if (!existsSync(composePath)) {
			throw new Error(`未找到 Compose 文件：${gitStack.composePath}`);
		}

		const composeContent = readFileSync(composePath, 'utf-8');

		// Determine the source directory and compose filename
		let composeDir: string;
		let progressComposeFileName: string;
		if (gitStack.contextDir) {
			const contextDirAbsolute = resolve(repoPath, gitStack.contextDir);
			if (!contextDirAbsolute.startsWith(repoPath)) {
				throw new Error('上下文目录必须位于仓库内');
			}
			const relCompose = relative(contextDirAbsolute, composePath);
			if (relCompose.startsWith('..')) {
				throw new Error('编排文件必须位于上下文目录内');
			}
			composeDir = contextDirAbsolute;
			progressComposeFileName = relCompose;
		} else {
			composeDir = dirname(composePath);
			progressComposeFileName = basename(gitStack.composePath);
		}

		// Read env file if configured (optional - don't fail if missing)
		let envFileVars: Record<string, string> | undefined;
		if (gitStack.envFilePath) {
			const envFilePath = repoFilePath(repoPath, gitStack.envFilePath, "Env file path");
			if (existsSync(envFilePath)) {
				try {
					const envContent = readFileSync(envFilePath, 'utf-8');
					envFileVars = parseEnvFileContent(envContent, gitStack.stackName);
				} catch (err) {
					// Log but don't fail - env file is optional
					console.warn(`读取环境变量文件 ${gitStack.envFilePath} 失败：`, err);
				}
			} else {
				console.warn(`未找到配置的环境变量文件：${gitStack.envFilePath}`);
			}
		}

		// Deletion sync (#966): manifest-vs-clone deletion plan
		const logPrefix = `[Stack:${gitStack.stackName}]`;
		const deletionData = await computeSyncDeletionPlan({
			logPrefix,
			composeDir,
			composeFileName: progressComposeFileName,
			rawManifest: gitStack.syncedFiles
		});

		// Update git stack status
		await updateGitStack(stackId, {
			syncStatus: 'synced',
			lastSync: new Date().toISOString(),
			lastCommit: currentCommit,
			syncError: null
		});

		cleanupSshKey(credential, env);

		// Show the git file changes BEFORE the deploy starts, so the user sees
		// what changed while the deploy runs and the deploy start/result lines
		// stay together (#1260). Removals reflect the deletion plan here;
		// apply-stage divergences (rare) are reported after the deploy.
		const changeTable = formatChangeTable(
			buildSyncChangeSummary(
				deletionData.previousManifest.files,
				deletionData.newFiles,
				{ deleted: deletionData.plan.toDelete.map((f) => f.path), skipped: [] },
				deletionData.plan.skipped
			)
		);
		onProgress({ status: 'deploying', message: `File changes: ${changeTable[0]}`, step: 5, totalSteps });
		for (const line of changeTable.slice(1)) {
			onProgress({ status: 'deploying', message: line, step: 5, totalSteps });
		}

		// Step 5: Deploying stack
		// Uses `docker compose up -d --remove-orphans` which only recreates changed services
		onProgress({ status: 'deploying', message: `正在部署 ${gitStack.stackName}...`, step: 5, totalSteps });
		if (deletionData.plan.toDelete.length > 0) {
			onProgress({
				status: 'deploying',
				message: `正在移除仓库中已删除的 ${deletionData.plan.toDelete.length} 个文件...`,
				step: 5,
				totalSteps
			});
		}

		// Determine env filename relative to compose dir (same logic as syncGitStack)
		let envFileName: string | undefined;
		if (gitStack.envFilePath) {
			const envFilePath = repoFilePath(repoPath, gitStack.envFilePath, "Env file path");
			if (existsSync(envFilePath)) {
				envFileName = relative(composeDir, envFilePath);
			}
		}

		const result = await deployStack({
			name: gitStack.stackName,
			compose: composeContent,
			envId: gitStack.environmentId,
			sourceDir: composeDir, // Copy entire directory from git repo
			composeFileName: progressComposeFileName, // Compose filename relative to source dir
			envFileName, // Env file relative to compose dir (for --env-file flag, optional)
			build: gitStack.buildOnDeploy,
			noBuildCache: gitStack.noBuildCache,
			pullPolicy: gitStack.repullImages ? 'always' : undefined,
			filesToDelete: deletionData.plan.toDelete
		});

		if (result.success) {
			// Deletion sync: persist manifest + log per-file change summary.
			// The change table was already shown before the deploy (#1260);
			// report only apply-stage divergences from the plan here.
			await finalizeDeletionSync({
				stackId,
				logPrefix,
				previousManifest: deletionData.previousManifest,
				newCommitFull: newCommit,
				newFiles: deletionData.newFiles,
				plan: deletionData.plan,
				applyResult: result.deletion
			});

			const applySkips = (result.deletion?.skipped ?? []).filter((s) => s.reason !== 'already-absent');
			for (const skip of applySkips) {
				onProgress({
					status: 'deploying',
					message: `Kept "${skip.path}" — ${skipReasonMessage(skip.reason)}`,
					step: 5,
					totalSteps
				});
			}

			// Record the stack source with resolved compose path for consistency
			const stackDir = await getStackDir(gitStack.stackName, gitStack.environmentId);
			const resolvedComposePath = join(stackDir, progressComposeFileName);

			await upsertStackSource({
				stackName: gitStack.stackName,
				environmentId: gitStack.environmentId,
				sourceType: 'git',
				gitRepositoryId: gitStack.repositoryId,
				gitStackId: stackId,
				composePath: resolvedComposePath
			});

			onProgress({ status: 'complete', message: `成功部署 ${gitStack.stackName}` });
		} else {
			throw new Error(result.error || '部署堆栈失败');
		}

		return result;
	} catch (error: any) {
		cleanupSshKey(credential, env);
		await updateGitStack(stackId, {
			syncStatus: 'error',
			syncError: error.message
		});
		onProgress({ status: 'error', error: error.message });
		return { success: false, error: error.message };
	}
}

// =============================================================================
// ENV FILE OPERATIONS
// =============================================================================

/**
 * List all .env* files in a git stack's repository.
 * Returns relative paths from the repository root.
 */
export async function listGitStackEnvFiles(stackId: number): Promise<{ files: string[]; error?: string }> {
	const gitStack = await getGitStack(stackId);
	if (!gitStack) {
		return { files: [], error: 'Git 堆栈不存在' };
	}

	const repoPath = await getStackRepoPath(stackId, gitStack.stackName, gitStack.environmentId);
	if (!existsSync(repoPath)) {
		return { files: [], error: '仓库未同步 - 请先部署堆栈' };
	}

	try {
		// Find all .env* files recursively (but not too deep)
		const maxDepth = 3;

		// Use find to locate all .env* files
		const proc = nodeSpawn('find', [repoPath, '-maxdepth', String(maxDepth), '-type', 'f', '-name', '.env*'], {
			stdio: ['pipe', 'pipe', 'pipe']
		});
		const findResult = await collectProcess(proc);
		const output = findResult.stdout;

		const files = output.trim().split('\n').filter(f => f);
		const envFiles: string[] = [];

		for (const file of files) {
			// Convert absolute path to relative from repo root
			const relativePath = file.replace(repoPath + '/', '');
			// Skip files in node_modules or .git directories
			if (!relativePath.includes('node_modules/') && !relativePath.includes('.git/')) {
				envFiles.push(relativePath);
			}
		}

		return { files: envFiles.sort() };
	} catch (error: any) {
		return { files: [], error: error.message };
	}
}

/**
 * Parse a .env file content into key-value pairs.
 * Handles comments, empty lines, and quoted values.
 */
export function parseEnvFileContent(content: string, stackName?: string): Record<string, string> {
	const logPrefix = stackName ? `[堆栈:${stackName}]` : '[Git]';
	const result: Record<string, string> = {};
	const skippedLines: string[] = [];
	const invalidKeys: string[] = [];

	console.log(`${logPrefix} ----------------------------------------`);
	console.log(`${logPrefix} 解析环境变量文件内容`);
	console.log(`${logPrefix} ----------------------------------------`);
	console.log(`${logPrefix} 原始内容长度：`, content.length, '字符');
	console.log(`${logPrefix} 原始内容：`);
	console.log(content);

	const lines = content.split('\n');
	console.log(`${logPrefix} 总行数：`, lines.length);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		// Skip empty lines and comments
		if (!trimmed || trimmed.startsWith('#')) {
			if (trimmed) skippedLines.push(`第 ${i + 1} 行：${trimmed.substring(0, 50)}...`);
			continue;
		}

		// Find the first = sign
		const eqIndex = trimmed.indexOf('=');
		if (eqIndex === -1) {
			skippedLines.push(`第 ${i + 1} 行 (无 =): ${trimmed.substring(0, 50)}`);
			continue;
		}

		const key = trimmed.substring(0, eqIndex).trim();
		const value = trimmed.substring(eqIndex + 1).trim();

		// Only add if key is valid env var name
		if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
			result[key] = value;
		} else {
			invalidKeys.push(`第 ${i + 1} 行："${key}" (键名格式无效)`);
		}
	}

	console.log(`${logPrefix} 已解析环境变量数量:`, Object.keys(result).length);
	console.log(`${logPrefix} 已解析环境变量键:`, Object.keys(result).join(', '));
	console.log(`${logPrefix} 已解析环境变量 (已脱敏):`, JSON.stringify(redactEnvVarsForLog(result), null, 2));
	if (skippedLines.length > 0) {
		console.log(`${logPrefix} 已跳过行 (${skippedLines.length} 行)：`, skippedLines.slice(0, 10).join('; '));
	}
	if (invalidKeys.length > 0) {
		console.log(`${logPrefix} 无效键名 (${invalidKeys.length} 个)：`, invalidKeys.join('; '));
	}

	return result;
}

/**
 * Read and parse a .env file from a git stack's repository.
 */
export async function readGitStackEnvFile(
	stackId: number,
	envFilePath: string
): Promise<{ vars: Record<string, string>; error?: string }> {
	const gitStack = await getGitStack(stackId);
	if (!gitStack) {
		return { vars: {}, error: 'Git 堆栈不存在' };
	}

	const repoPath = await getStackRepoPath(stackId, gitStack.stackName, gitStack.environmentId);
	if (!existsSync(repoPath)) {
		return { vars: {}, error: '仓库未同步 - 请先部署堆栈' };
	}

	// Security check: ensure the path doesn't escape the repo
	const normalizedPath = envFilePath.replace(/\.\./g, '').replace(/^\//, '');
	const fullPath = join(repoPath, normalizedPath);

	if (!fullPath.startsWith(repoPath)) {
		return { vars: {}, error: '文件路径无效' };
	}

	if (!existsSync(fullPath)) {
		return { vars: {}, error: `未找到文件：${envFilePath}` };
	}

	try {
		const content = readFileSync(fullPath, 'utf-8');
		const vars = parseEnvFileContent(content);
		return { vars };
	} catch (error: any) {
		return { vars: {}, error: error.message };
	}
}

interface PreviewEnvOptions {
	repoUrl: string;
	branch: string;
	credential: {
		id: number;
		authType: string;
		sshPrivateKey?: string | null;
		username?: string | null;
		password?: string | null;
	} | null;
	composePath: string;
	envFilePath: string | null;
}

interface PreviewEnvResult {
	vars: Record<string, string>;
	sources: Record<string, '.env' | 'envFile'>;
	error?: string;
}

/**
 * Clone a repository to a temp directory and read env files for preview.
 * Used to populate env editor when creating a new git stack.
 * Cleans up temp directory after reading.
 */
export async function previewRepoEnvFiles(options: PreviewEnvOptions): Promise<PreviewEnvResult> {
	const { repoUrl, branch, credential, composePath, envFilePath } = options;
	const logPrefix = '[Git:预览]';

	// Create a unique temp directory
	const tempId = `preview-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
	const tempDir = join(GIT_REPOS_DIR, tempId);

	console.log(`${logPrefix} 开始预览 ${repoUrl}`);
	console.log(`${logPrefix} 临时目录：${tempDir}`);

	// Declared outside the try so the finally can pass it to cleanupSshKey (#1413):
	// a block-scoped `const env` inside the try is out of scope in finally, which
	// throws "env is not defined" before the real result/error is returned.
	let env: GitEnv | undefined;

	try {
		// Ensure temp directory exists
		mkdirSync(tempDir, { recursive: true });

		// Build git environment with credentials
		// Cast credential to GitCredential type (only uses id, authType, sshPrivateKey)
		env = await buildGitEnv(credential as GitCredential | null);

		// Security: the preview endpoint clones a
		// USER-SUPPLIED URL and reads env files from it — the same SSRF / RCE /
		// path-traversal surface as the branches endpoint. Apply the shared guards
		// BEFORE any git subprocess or file read:
		//  1. assertSafeRepoTarget — blocks loopback/link-local/metadata/reserved
		//     hosts (SSRF) and the ext::/file:: transport denylist (RCE). Ordinary
		//     private-LAN addresses are intentionally allowed (self-hosted Git).
		//  2. repoFilePath — keeps composePath/envFilePath INSIDE the temp dir
		//     (path traversal). Without this, `envFilePath: '../../secrets/x'`
		//     reads a file outside the clone.
		assertSafeRepoTarget(repoUrl);
		const safeComposePath = repoFilePath(tempDir, composePath, 'Compose path');
		const safeEnvFilePath = envFilePath ? repoFilePath(tempDir, envFilePath, 'Env file path') : null;
		assertSafeGitRef(branch);
		const authenticatedUrl = buildRepoUrl(repoUrl, credential as GitCredential | null);

		// Clone with depth 1 (shallow clone for speed)
		const cloneProc = nodeSpawn(
			'git',
			['clone', '--depth', '1', '--branch', branch, '--single-branch', authenticatedUrl, tempDir],
			{
				stdio: ['pipe', 'pipe', 'pipe'],
				env
			}
		);

		const cloneResult = await collectProcess(cloneProc);
		const cloneStderr = cloneResult.stderr;
		const cloneExitCode = cloneResult.exitCode;

		if (cloneExitCode !== 0) {
			console.error(`${logPrefix} 克隆失败：`, cloneStderr);
			return { vars: {}, sources: {}, error: `克隆仓库失败：${cloneStderr.trim()}` };
		}

		console.log(`${logPrefix} 克隆成功`);

		// Determine the compose directory (where .env file should be) — uses the
		// VALIDATED path (already checked to be inside the temp dir).
		const composeDir = dirname(safeComposePath);
		const baseEnvPath = join(tempDir, composeDir, '.env');

		const vars: Record<string, string> = {};
		const sources: Record<string, '.env' | 'envFile'> = {};

		// Read base .env file if it exists
		if (existsSync(baseEnvPath)) {
			console.log(`${logPrefix} 正在从 ${baseEnvPath} 读取 .env`);
			const content = readFileSync(baseEnvPath, 'utf-8');
			const baseVars = parseEnvFileContent(content, 'preview');
			for (const [key, value] of Object.entries(baseVars)) {
				vars[key] = value;
				sources[key] = '.env';
			}
			console.log(`${logPrefix} 在 .env 中找到 ${Object.keys(baseVars).length} 个变量`);
		} else {
			console.log(`${logPrefix} ${baseEnvPath} 无 .env 文件`);
		}

		// Read additional env file if specified — uses the VALIDATED path
		// (already checked to be inside the temp dir).
		if (safeEnvFilePath) {
			const additionalEnvPath = safeEnvFilePath;
			if (existsSync(additionalEnvPath)) {
				console.log(`${logPrefix} 正在读取额外环境变量文件：${additionalEnvPath}`);
				const content = readFileSync(additionalEnvPath, 'utf-8');
				const additionalVars = parseEnvFileContent(content, 'preview');
				for (const [key, value] of Object.entries(additionalVars)) {
					vars[key] = value;
					sources[key] = 'envFile';
				}
				console.log(`${logPrefix} 在 ${envFilePath} 中找到 ${Object.keys(additionalVars).length} 个变量`);
			} else {
				console.log(`${logPrefix} 未找到额外环境变量文件：${additionalEnvPath}`);
			}
		}

		console.log(`${logPrefix} 总变量数：${Object.keys(vars).length}`);

		return { vars, sources };
	} catch (error: any) {
		console.error(`${logPrefix} 错误：`, error);
		return { vars: {}, sources: {}, error: error.message };
	} finally {
		// Always clean up temp directory
		cleanupSshKey(credential as GitCredential | null, env);
		try {
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true, force: true });
				console.log(`${logPrefix} 已清理临时目录`);
			}
		} catch (cleanupError) {
			console.error(`${logPrefix} 清理临时目录失败：`, cleanupError);
		}
	}
}
