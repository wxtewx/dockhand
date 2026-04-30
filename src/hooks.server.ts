// v1.0.12
import '$lib/server/dns-dispatcher.js';
import { initDatabase, hasAdminUser } from '$lib/server/db';
import { startSubprocesses, stopSubprocesses } from '$lib/server/subprocess-manager';
import { startScheduler } from '$lib/server/scheduler';
import { isAuthEnabled, validateSession } from '$lib/server/auth';
import { validateApiToken } from '$lib/server/api-tokens';
import { requestContext } from '$lib/server/request-context';
import { setServerStartTime } from '$lib/server/uptime';
import { checkLicenseExpiry, getHostname } from '$lib/server/license';
import { initCryptoFallback } from '$lib/server/crypto-fallback';
import { detectHostDataDir } from '$lib/server/host-path';
import { listContainers, removeContainer } from '$lib/server/docker';
import { migrateCredentials } from '$lib/server/encryption';
import { gzipSync } from 'node:zlib';
import { rmSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { HandleServerError, Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { startRssTracker, stopRssTracker, rssBeforeOp, rssAfterOp } from '$lib/server/rss-tracker';

// Content types worth compressing
const COMPRESSIBLE_TYPES = [
	'application/json',
	'text/html',
	'text/plain',
	'text/css',
	'application/javascript',
	'text/javascript',
	'application/xml',
	'text/xml',
	'image/svg+xml'
];

// Minimum response size to bother compressing (1KB)
const MIN_COMPRESS_SIZE = 1024;

function shouldCompress(request: Request, response: Response): boolean {
	const acceptEncoding = request.headers.get('accept-encoding') || '';
	if (!acceptEncoding.includes('gzip')) return false;

	if (response.headers.has('content-encoding')) return false;

	const contentType = response.headers.get('content-type') || '';
	if (contentType.includes('text/event-stream')) return false;
	if (contentType.includes('octet-stream')) return false;
	if (contentType.startsWith('image/') && !contentType.includes('svg')) return false;

	const isCompressible = COMPRESSIBLE_TYPES.some(type => contentType.includes(type));
	if (!isCompressible) return false;

	const contentLength = response.headers.get('content-length');
	if (contentLength && parseInt(contentLength) < MIN_COMPRESS_SIZE) return false;

	return true;
}

async function compressResponse(request: Request, response: Response): Promise<Response> {
	if (!shouldCompress(request, response)) return response;

	const body = await response.arrayBuffer();
	if (body.byteLength < MIN_COMPRESS_SIZE) return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});

	const gzipBefore = rssBeforeOp();
	const compressed = gzipSync(new Uint8Array(body));
	rssAfterOp('gzip', gzipBefore);

	const headers = new Headers(response.headers);
	headers.set('content-encoding', 'gzip');
	headers.set('vary', 'Accept-Encoding');
	headers.delete('content-length');

	return new Response(compressed, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

// Cleanup orphaned scanner version containers from previous runs
async function cleanupOrphanedScannerContainers() {
	try {
		const containers = await listContainers(true);
		const orphaned = containers.filter(c =>
			c.name?.startsWith('dockhand-grype-version-') ||
			c.name?.startsWith('dockhand-trivy-version-')
		);
		for (const c of orphaned) {
			try {
				await removeContainer(c.id, true);
			} catch { /* ignore */ }
		}
		if (orphaned.length > 0) {
			console.log(`[启动] 已清理 ${orphaned.length} 个孤立的扫描器容器`);
		}
	} catch (error) {
		// Silently ignore - Docker may not be available yet or no containers to clean
	}
}

// License expiry check interval (24 hours)
const LICENSE_CHECK_INTERVAL = 86400000;

// HMR guard for license check interval
declare global {
	var __licenseCheckInterval: ReturnType<typeof setInterval> | undefined;
}

// Initialize database on server start (synchronous with SQLite)
let initialized = false;

if (!initialized) {
	try {
		// Initialize crypto fallback first (detects old kernels and logs status)
		initCryptoFallback();

		// Cleanup orphaned TLS temp directories from previous crashes
		const dataDir = process.env.DATA_DIR || './data';
		const tmpDir = join(dataDir, 'tmp');
		if (existsSync(tmpDir)) {
			try {
				const entries = readdirSync(tmpDir);
				for (const entry of entries) {
					if (entry.startsWith('tls-')) {
						const path = join(tmpDir, entry);
						try {
							rmSync(path, { recursive: true, force: true });
							console.log(`[启动] 已清理孤立的 TLS 临时目录: ${entry}`);
						} catch { /* ignore */ }
					}
				}
			} catch { /* ignore */ }
		}

		setServerStartTime(); // Track when server started
		initDatabase();

		// Migrate plain text credentials to encrypted storage
		// This also handles key rotation if ENCRYPTION_KEY env var differs from key file
		migrateCredentials().catch(err => {
			console.error('[启动] 凭据迁移失败:', err);
		});

		// Log hostname for license validation (set by entrypoint in Docker, or os.hostname() outside)
		console.log('用于许可证验证的主机名:', getHostname());

		// Detect host data directory for path translation
		// This allows Dockhand to translate container paths to host paths for compose volume mounts
		detectHostDataDir().then(hostPath => {
			if (hostPath) {
				console.log(`[启动] 已检测到主机数据目录: ${hostPath}`);
			} else {
				console.warn('[启动] 无法检测主机数据路径。');
				console.warn('[启动] 包含相对数据卷路径的 Git 堆栈可能无法正常工作。');
				console.warn('[启动] 建议设置 HOST_DATA_DIR 或使用匹配的挂载路径 (-v /app/data:/app/data)');
			}
		}).catch(err => {
			console.error('[启动] 检测主机数据目录失败:', err);
		});
		// Cleanup orphaned scanner containers from previous runs (non-blocking)
		cleanupOrphanedScannerContainers().catch(err => {
			console.error('清理孤立扫描器容器失败:', err);
		});
		// Start background subprocesses for metrics and event collection (worker thread)
		startSubprocesses().catch(err => {
			console.error('启动后台子进程失败:', err);
		});
		startScheduler(); // Start unified scheduler for auto-updates and git syncs (async)
		startRssTracker(); // Start RSS memory tracking (no-op unless MEMORY_MONITOR=true)

		// Check license expiry on startup and then daily (with HMR guard)
		checkLicenseExpiry().catch(err => {
			console.error('检查许可证过期失败:', err);
		});
		if (!globalThis.__licenseCheckInterval) {
			globalThis.__licenseCheckInterval = setInterval(() => {
				checkLicenseExpiry().catch(err => {
					console.error('检查许可证过期失败:', err);
				});
			}, LICENSE_CHECK_INTERVAL);
		}

		// Graceful shutdown handling
		const shutdown = async () => {
			console.log('[服务] 正在关闭...');
			stopRssTracker();
			await stopSubprocesses();
			process.exit(0);
		};
		process.on('SIGTERM', shutdown);
		process.on('SIGINT', shutdown);

		initialized = true;
	} catch (error) {
		console.error('数据库初始化失败:', error);
	}
}

// Routes that don't require authentication
const PUBLIC_PATHS = [
	'/login',
	'/api/auth/login',
	'/api/auth/logout',
	'/api/auth/session',
	'/api/auth/settings',
	'/api/auth/providers',
	'/api/auth/oidc',
	'/api/license',
	'/api/changelog',
	'/api/dependencies',
	'/api/health',
	'/api/settings/theme'
];

// Check if path is public
function isPublicPath(pathname: string): boolean {
	// Webhook endpoints have their own auth (signature/secret verification)
	if (pathname.match(/^\/api\/git\/stacks\/\d+\/webhook$/)) return true;
	if (pathname.match(/^\/api\/git\/webhook\/\d+$/)) return true;

	return PUBLIC_PATHS.some(path => pathname === path || pathname.startsWith(path + '/'));
}

// Check if path is a static asset
function isStaticAsset(pathname: string): boolean {
	return pathname.startsWith('/_app/') ||
		pathname.startsWith('/favicon') ||
		pathname.endsWith('.webp') ||
		pathname.endsWith('.png') ||
		pathname.endsWith('.jpg') ||
		pathname.endsWith('.svg') ||
		pathname.endsWith('.ico') ||
		pathname.endsWith('.css') ||
		pathname.endsWith('.js');
}

export const handle: Handle = async ({ event, resolve }) => {
	// Skip auth for static assets
	if (isStaticAsset(event.url.pathname)) {
		return resolve(event);
	}

	const httpBefore = rssBeforeOp();
	try {
		// Check if auth is enabled
		const authEnabled = await isAuthEnabled();

		// If auth is disabled, allow everything (app works as before)
		if (!authEnabled) {
			event.locals.user = null;
			event.locals.authEnabled = false;
			return compressResponse(event.request, await resolve(event));
		}

		// Auth is enabled - check session
		const user = await validateSession(event.cookies);
		event.locals.user = user;
		event.locals.authEnabled = true;

		// Public paths don't require authentication
		if (isPublicPath(event.url.pathname)) {
			return compressResponse(event.request, await resolve(event));
		}

		// If not authenticated
		if (!user) {
			// Special case: allow user creation when auth is enabled but no admin exists yet
			// This enables the first admin user to be created during initial setup
			const noAdminSetupMode = !(await hasAdminUser());
			if (noAdminSetupMode && event.url.pathname === '/api/users' && event.request.method === 'POST') {
				return compressResponse(event.request, await resolve(event));
			}

			// API routes return 401
			if (event.url.pathname.startsWith('/api/')) {
				return new Response(
					JSON.stringify({ error: '未授权', message: '需要身份验证' }),
					{
						status: 401,
						headers: { 'Content-Type': 'application/json' }
					}
				);
			}

			// UI routes redirect to login
			const redirectUrl = encodeURIComponent(event.url.pathname + event.url.search);
			redirect(307, `/login?redirect=${redirectUrl}`);
		}

		return compressResponse(event.request, await resolve(event));
	} finally {
		rssAfterOp('http', httpBefore);
	}
};

export const handleError: HandleServerError = ({ error, event }) => {
	// Skip logging 404 errors - they're expected for missing routes
	const status = (error as { status?: number })?.status;
	if (status === 404) {
		return {
			message: '页面未找到',
			code: 'NOT_FOUND'
		};
	}

	// Log only essential error info without code snippets
	const message = error instanceof Error ? error.message : '未知错误';
	console.error(`[错误] ${event.url.pathname}: ${message}`);

	return {
		message,
		code: 'INTERNAL_ERROR'
	};
};
