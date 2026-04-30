/**
 * Drizzle Database Connection Module
 *
 * Provides a unified database connection using Drizzle ORM.
 * Supports both SQLite (default) and PostgreSQL (via DATABASE_URL).
 *
 * Features:
 * - Pre-flight connection test
 * - Migration state introspection
 * - Progress logging during startup
 * - Fail-fast on migration errors (configurable)
 * - Clear success/failure indicators
 *
 * Environment Variables:
 * - DATABASE_URL: PostgreSQL connection string (omit for SQLite)
 * - DATA_DIR: Data directory for SQLite database (default: ./data)
 * - DB_FAIL_ON_MIGRATION_ERROR: Exit on migration failure (default: true)
 * - DB_VERBOSE_LOGGING: Enable verbose logging (default: false)
 * - SKIP_MIGRATIONS: Skip migrations entirely (default: false)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Environment variable configuration for database behavior.
 */
const getConfig = () => ({
	databaseUrl: process.env.DATABASE_URL,
	dataDir: process.env.DATA_DIR || './data',
	// Migration behavior
	failOnMigrationError: process.env.DB_FAIL_ON_MIGRATION_ERROR !== 'false',
	verboseLogging: process.env.DB_VERBOSE_LOGGING === 'true',
	skipMigrations: process.env.SKIP_MIGRATIONS === 'true'
});

// Database type detection
const getDatabaseType = () => {
	const url = process.env.DATABASE_URL;
	return !!(url && (url.startsWith('postgres://') || url.startsWith('postgresql://')));
};

// Export flags for external use
export const isPostgres = getDatabaseType();
export const isSqlite = !isPostgres;

// =============================================================================
// LOGGING UTILITIES
// =============================================================================

const SEPARATOR = '='.repeat(60);
const WARNING_SEPARATOR = '!'.repeat(60);

function logHeader(title: string): void {
	console.log('\n' + SEPARATOR);
	console.log(title);
	console.log(SEPARATOR);
}

function logSuccess(message: string): void {
	console.log(`[成功] ${message}`);
}

function logInfo(message: string): void {
	console.log(`     ${message}`);
}

function logWarning(message: string): void {
	console.log(`[警告] ${message}`);
}

function logStep(step: string): void {
	console.log(`  -> ${step}`);
}

function maskPassword(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.password) {
			parsed.password = '***';
		}
		return parsed.toString();
	} catch {
		return url.replace(/:[^:@]+@/, ':***@');
	}
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate PostgreSQL connection URL format.
 */
function validatePostgresUrl(url: string): void {
	try {
		const parsed = new URL(url);

		if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
			exitWithError(`无效协议 "${parsed.protocol}"，期望为 "postgres:" 或 "postgresql:"`, url);
		}

		if (!parsed.hostname) {
			exitWithError('DATABASE_URL 中缺少主机名', url);
		}

		if (!parsed.pathname || parsed.pathname === '/') {
			exitWithError('DATABASE_URL 中缺少数据库名称', url);
		}
	} catch {
		exitWithError('无效的 URL 格式', url);
	}
}

/**
 * Print connection error and exit.
 */
function exitWithError(error: string, url?: string): never {
	console.error('\n' + SEPARATOR);
	console.error('数据库连接错误');
	console.error(SEPARATOR);
	console.error(`\n错误：${error}`);

	if (url) {
		console.error(`\n提供的 URL：${maskPassword(url)}`);
	}

	console.error('\n' + '-'.repeat(60));
	console.error('DATABASE_URL 格式：');
	console.error('-'.repeat(60));
	console.error('\n  postgres://用户名:密码@主机:端口/数据库名');
	console.error('\n示例：');
	console.error('  postgres://dockhand:secret@localhost:5432/dockhand');
	console.error('  postgres://admin:p4ssw0rd@192.168.1.100:5432/dockhand');
	console.error('  postgresql://user:pass@db.example.com/mydb?sslmode=require');
	console.error('\n' + '-'.repeat(60));
	console.error('如需使用 SQLite，请删除 DATABASE_URL 环境变量。');
	console.error(SEPARATOR + '\n');

	process.exit(1);
}

// =============================================================================
// MIGRATION STATE
// =============================================================================

interface MigrationEntry {
	idx: number;
	version: string;
	when: number;
	tag: string;
	breakpoints: boolean;
}

interface MigrationJournal {
	version: string;
	dialect: string;
	entries: MigrationEntry[];
}

interface AppliedMigration {
	hash: string;
	createdAt?: number;
}

interface MigrationState {
	journalExists: boolean;
	allMigrations: string[];
	appliedMigrations: string[];
	pendingMigrations: string[];
	tableExists: boolean;
}

/**
 * Read the migration journal to get list of all migrations.
 */
function readMigrationJournal(migrationsFolder: string): MigrationJournal | null {
	try {
		const journalPath = join(migrationsFolder, 'meta', '_journal.json');
		if (!existsSync(journalPath)) {
			return null;
		}
		const content = readFileSync(journalPath, 'utf-8');
		return JSON.parse(content);
	} catch (error) {
		const config = getConfig();
		if (config.verboseLogging) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error('[DB] 读取迁移日志失败：', errorMsg);
		}
		return null;
	}
}

/**
 * Get applied migrations from the database.
 * Note: Drizzle uses 'drizzle' schema for PostgreSQL.
 */
async function getAppliedMigrations(client: any, postgres: boolean): Promise<AppliedMigration[]> {
	try {
		if (postgres) {
			// PostgreSQL using postgres-js - note the 'drizzle' schema
			const result = await client`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
			return result.map((r: any) => ({ hash: r.hash, createdAt: r.created_at }));
		} else {
			// SQLite using better-sqlite3
			const stmt = client.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY id');
			return stmt.all().map((r: any) => ({ hash: r.hash, createdAt: r.created_at }));
		}
	} catch {
		// Table doesn't exist - fresh database
		return [];
	}
}

/**
 * Check if the migrations table exists.
 * Note: Drizzle creates the migrations table in the 'drizzle' schema for PostgreSQL.
 */
async function checkMigrationsTableExists(client: any, postgres: boolean): Promise<boolean> {
	try {
		if (postgres) {
			// Drizzle uses 'drizzle' schema for PostgreSQL
			const result = await client`
				SELECT EXISTS (
					SELECT FROM information_schema.tables
					WHERE table_schema = 'drizzle'
					AND table_name = '__drizzle_migrations'
				) as exists
			`;
			return result[0]?.exists === true;
		} else {
			const stmt = client.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'"
			);
			const result = stmt.all();
			return result.length > 0;
		}
	} catch {
		return false;
	}
}

/**
 * Compute SHA-256 hash of a file (matching Drizzle's migration tracking).
 */
function computeFileHash(filePath: string): string {
	const content = readFileSync(filePath);
	return createHash('sha256').update(content).digest('hex');
}

/**
 * Get migration files with their hashes.
 */
function getMigrationFiles(migrationsFolder: string): { tag: string; hash: string }[] {
	const journal = readMigrationJournal(migrationsFolder);
	if (!journal) return [];

	return journal.entries.map(entry => {
		const sqlFile = join(migrationsFolder, `${entry.tag}.sql`);
		if (!existsSync(sqlFile)) {
			return { tag: entry.tag, hash: '' };
		}
		const hash = computeFileHash(sqlFile);
		return { tag: entry.tag, hash };
	});
}

/**
 * Get full migration state including pending migrations.
 */
async function getMigrationState(
	client: any,
	postgres: boolean,
	migrationsFolder: string
): Promise<MigrationState> {
	const journal = readMigrationJournal(migrationsFolder);
	const migrations = getMigrationFiles(migrationsFolder);
	const allMigrations = migrations.map(m => m.tag);

	const tableExists = await checkMigrationsTableExists(client, postgres);
	const applied = await getAppliedMigrations(client, postgres);
	const appliedHashes = new Set(applied.map(a => a.hash));

	// Compare file hashes to determine pending migrations
	const pendingMigrations = migrations
		.filter(m => !appliedHashes.has(m.hash))
		.map(m => m.tag);

	return {
		journalExists: journal !== null,
		allMigrations,
		appliedMigrations: applied.map(a => a.hash),
		pendingMigrations,
		tableExists
	};
}

// =============================================================================
// SCHEMA HEALTH CHECK
// =============================================================================

const REQUIRED_TABLES = [
	'environments',
	'hawser_tokens',
	'registries',
	'settings',
	'stack_events',
	'host_metrics',
	'config_sets',
	'auto_update_settings',
	'notification_settings',
	'environment_notifications',
	'auth_settings',
	'users',
	'sessions',
	'ldap_config',
	'oidc_config',
	'roles',
	'user_roles',
	'git_credentials',
	'git_repositories',
	'git_stacks',
	'stack_sources',
	'vulnerability_scans',
	'audit_logs',
	'container_events',
	'schedule_executions',
	'user_preferences',
	'api_tokens'
];

/**
 * Check if a table exists in the database.
 */
async function tableExists(client: any, postgres: boolean, tableName: string): Promise<boolean> {
	try {
		if (postgres) {
			const result = await client`
				SELECT EXISTS (
					SELECT FROM information_schema.tables
					WHERE table_schema = 'public'
					AND table_name = ${tableName}
				) as exists
			`;
			return result[0]?.exists === true;
		} else {
			const stmt = client.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name=?"
			);
			const result = stmt.all(tableName);
			return result.length > 0;
		}
	} catch {
		return false;
	}
}

export interface SchemaHealthResult {
	healthy: boolean;
	database: 'sqlite' | 'postgresql';
	connection: string;
	migrationsTable: boolean;
	appliedMigrations: number;
	pendingMigrations: number;
	schemaVersion: string | null;
	tables: {
		expected: number;
		found: number;
		missing: string[];
	};
	timestamp: string;
}

/**
 * Check the health of the database schema.
 * Exported for use by the health endpoint.
 */
export async function checkSchemaHealth(): Promise<SchemaHealthResult> {
	const config = getConfig();
	const migrationsFolder = isPostgres ? './drizzle-pg' : './drizzle';

	// Get connection string for display
	let connectionDisplay: string;
	if (isPostgres) {
		connectionDisplay = maskPassword(config.databaseUrl || '');
	} else {
		connectionDisplay = join(config.dataDir, 'db', 'dockhand.db');
	}

	// Check migration state
	const migrationState = await getMigrationState(rawClient, isPostgres, migrationsFolder);

	// Check table existence
	const missingTables: string[] = [];
	for (const table of REQUIRED_TABLES) {
		const exists = await tableExists(rawClient, isPostgres, table);
		if (!exists) {
			missingTables.push(table);
		}
	}

	// Get schema version from journal
	const journal = readMigrationJournal(migrationsFolder);
	const lastMigration = journal?.entries[journal.entries.length - 1];
	const schemaVersion = lastMigration?.tag ?? null;

	return {
		healthy: missingTables.length === 0 && migrationState.pendingMigrations.length === 0,
		database: isPostgres ? 'postgresql' : 'sqlite',
		connection: connectionDisplay,
		migrationsTable: migrationState.tableExists,
		appliedMigrations: migrationState.appliedMigrations.length,
		pendingMigrations: migrationState.pendingMigrations.length,
		schemaVersion,
		tables: {
			expected: REQUIRED_TABLES.length,
			found: REQUIRED_TABLES.length - missingTables.length,
			missing: missingTables
		},
		timestamp: new Date().toISOString()
	};
}

// =============================================================================
// MIGRATION RUNNER
// =============================================================================

interface MigrationResult {
	success: boolean;
	error?: string;
	applied: number;
	skipped: boolean;
}

/**
 * Run database migrations with comprehensive logging and error handling.
 */
async function runMigrations(
	database: any,
	client: any,
	postgres: boolean,
	migrationsFolder: string
): Promise<MigrationResult> {
	const config = getConfig();

	if (config.skipMigrations) {
		logInfo('已跳过迁移（SKIP_MIGRATIONS=true）');
		return { success: true, applied: 0, skipped: true };
	}

	// Get migration state
	const state = await getMigrationState(client, postgres, migrationsFolder);

	if (!state.journalExists) {
		logWarning('未找到迁移日志 - 这可能是开发环境');
		return { success: true, applied: 0, skipped: true };
	}

	logInfo(`总迁移数：${state.allMigrations.length}`);
	logInfo(`已应用：${state.appliedMigrations.length}`);
	logInfo(`待执行：${state.pendingMigrations.length}`);

	if (state.pendingMigrations.length === 0) {
		logSuccess('数据库结构已是最新版本');
		return { success: true, applied: 0, skipped: false };
	}

	// Log pending migrations
	console.log('\n待执行迁移：');
	for (const migration of state.pendingMigrations) {
		logStep(migration);
	}
	console.log('');

	// Run migrations
	try {
		if (postgres) {
			const { migrate } = await import('drizzle-orm/postgres-js/migrator');
			await migrate(database, { migrationsFolder });
		} else {
			const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
			await migrate(database, { migrationsFolder });
		}

		logSuccess(`已应用 ${state.pendingMigrations.length} 个迁移`);
		return { success: true, applied: state.pendingMigrations.length, skipped: false };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { success: false, error: message, applied: 0, skipped: false };
	}
}

/**
 * Handle migration failure with detailed error messages and recovery instructions.
 */
function handleMigrationFailure(error: string, postgres: boolean): never {
	const config = getConfig();

	console.error('\n' + WARNING_SEPARATOR);
	console.error('迁移失败');
	console.error(WARNING_SEPARATOR);
	console.error(`\n错误：${error}`);

	// Provide specific guidance based on error type
	if (error.includes('already exists')) {
		console.error('\n' + '-'.repeat(60));
		console.error('诊断：表或字段已存在');
		console.error('-'.repeat(60));
		console.error('\n通常由以下原因导致：');
		console.error('  1. 上一次迁移仅部分执行');
		console.error('  2. 数据库被手动修改');
		console.error('  3. 迁移重新生成但未重置数据库');
		console.error('\n恢复选项：');
		console.error('\n  选项 1：重置数据库（删除所有数据）');
		if (postgres) {
			console.error('    docker exec postgres psql -U <user> -d postgres -c "DROP DATABASE dockhand;"');
			console.error('    docker exec postgres psql -U <user> -d postgres -c "CREATE DATABASE dockhand;"');
		} else {
			console.error('    rm -f ./data/db/dockhand.db');
		}
		console.error('\n  选项 2：标记迁移为已应用（结构正确时）');
		if (postgres) {
			console.error('    INSERT INTO __drizzle_migrations (hash, created_at)');
			console.error("    VALUES ('<migration_tag>', NOW());");
		} else {
			console.error('    INSERT INTO __drizzle_migrations (hash, created_at)');
			console.error("    VALUES ('<migration_tag>', strftime('%s', 'now') * 1000);");
		}
		console.error('\n  选项 3：使用紧急脚本');
		console.error('    docker exec dockhand /app/scripts/emergency/reset-db.sh');
	} else if (error.includes('does not exist') || error.includes('no such table')) {
		console.error('\n' + '-'.repeat(60));
		console.error('诊断：表或字段不存在');
		console.error('-'.repeat(60));
		console.error('\n通常由以下原因导致：');
		console.error('  1. 数据库已创建但未执行迁移');
		console.error('  2. __drizzle_migrations 表不同步');
		console.error('\n恢复选项：');
		console.error('\n  选项 1：清空迁移历史并重试');
		if (postgres) {
			console.error('    TRUNCATE TABLE __drizzle_migrations;');
		} else {
			console.error('    DELETE FROM __drizzle_migrations;');
		}
		console.error('    然后重启应用。');
	} else if (error.includes('connection') || error.includes('ECONNREFUSED')) {
		console.error('\n' + '-'.repeat(60));
		console.error('诊断：数据库连接失败');
		console.error('-'.repeat(60));
		console.error('\n请检查：');
		console.error('  1. 数据库服务正在运行');
		console.error('  2. DATABASE_URL 配置正确');
		console.error('  3. 与数据库主机的网络连通性');
		console.error('  4. 数据库用户拥有必要权限');
	}

	console.error('\n' + '-'.repeat(60));
	console.error('覆盖选项');
	console.error('-'.repeat(60));
	console.error('\n  DB_FAIL_ON_MIGRATION_ERROR=false');
	console.error('    仍继续启动（危险 - 可能导致运行时错误）');
	console.error('\n  SKIP_MIGRATIONS=true');
	console.error('    完全跳过迁移（仅用于调试）');

	console.error('\n' + WARNING_SEPARATOR + '\n');

	if (config.failOnMigrationError) {
		process.exit(1);
	}

	// This line is never reached if failOnMigrationError is true
	throw new Error(`迁移失败：${error}`);
}

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================

// Database connection state (initialized lazily)
let db: any;
let rawClient: any;
let schema: any;
let initialized = false;

/**
 * Initialize the database connection at runtime.
 * This function is called on first access to ensure DATABASE_URL is read
 * from the actual runtime environment, not the build environment.
 */
async function initializeDatabase() {
	if (initialized) return;

	const config = getConfig();
	const verbose = config.verboseLogging;

	logHeader('数据库初始化');

	if (isPostgres) {
		// PostgreSQL via postgres-js
		validatePostgresUrl(config.databaseUrl!);

		logInfo(`数据库：PostgreSQL`);
		logInfo(`连接：${maskPassword(config.databaseUrl!)}`);

		const { drizzle } = await import('drizzle-orm/postgres-js');
		const postgres = (await import('postgres')).default;

		// Import PostgreSQL schema
		schema = await import('./schema/pg-schema.js');

		if (verbose) logStep('正在连接 PostgreSQL...');
		try {
			rawClient = postgres(config.databaseUrl!);
			db = drizzle({ client: rawClient, schema });
			logSuccess('PostgreSQL 连接已建立');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			exitWithError(`PostgreSQL 连接失败：${message}`, config.databaseUrl);
		}

		// Run migrations
		const migrationsFolder = './drizzle-pg';
		const result = await runMigrations(db, rawClient, true, migrationsFolder);
		if (!result.success && result.error) {
			handleMigrationFailure(result.error, true);
		}
	} else {
		// SQLite via better-sqlite3
		const dbDir = join(config.dataDir, 'db');
		if (!existsSync(dbDir)) {
			mkdirSync(dbDir, { recursive: true });
		}

		const dbPath = join(dbDir, 'dockhand.db');

		logInfo(`数据库：SQLite`);
		logInfo(`路径：${dbPath}`);

		const { drizzle } = await import('drizzle-orm/better-sqlite3');
		const Database = (await import('better-sqlite3')).default;

		// Import SQLite schema
		schema = await import('./schema/index.js');

		if (verbose) logStep('正在打开 SQLite 数据库...');
		rawClient = new Database(dbPath);

		// Enable WAL mode for better performance and concurrency
		rawClient.pragma('journal_mode = WAL');
		// Synchronous NORMAL is a good balance between safety and speed
		rawClient.pragma('synchronous = NORMAL');
		// Increase busy timeout to handle concurrent access (5 seconds)
		rawClient.pragma('busy_timeout = 5000');

		db = drizzle({ client: rawClient, schema });
		logSuccess('SQLite 数据库已打开');

		// Run migrations
		const migrationsFolder = './drizzle';
		const result = await runMigrations(db, rawClient, false, migrationsFolder);
		if (!result.success && result.error) {
			handleMigrationFailure(result.error, false);
		}
	}

	initialized = true;
}

// =============================================================================
// DATABASE SEEDING
// =============================================================================

/**
 * Seed the database with initial data.
 * This is idempotent - safe to call on every startup.
 */
async function seedDatabase(): Promise<void> {
	await initializeDatabase();

	const config = getConfig();
	const verbose = config.verboseLogging;

	if (verbose) console.log('\n正在初始化数据库数据...');

	// Create Docker Hub registry if no registries exist
	const existingRegistries = await db.select().from(schema.registries);
	if (existingRegistries.length === 0) {
		await db.insert(schema.registries).values({
			name: 'Docker Hub',
			url: 'https://registry.hub.docker.com',
			isDefault: true
		});
		logStep('已创建 Docker Hub 镜像仓库');
	}

	// Create default auth settings if none exist
	const existingAuth = await db.select().from(schema.authSettings);
	if (existingAuth.length === 0) {
		await db.insert(schema.authSettings).values({
			authEnabled: false,
			defaultProvider: 'local',
			sessionTimeout: 86400
		});
		logStep('已创建默认认证设置');
	}

	// Create default cron settings for system schedules if not exist
	const scheduleCleanupCron = await db.select().from(schema.settings).where(eq(schema.settings.key, 'schedule_cleanup_cron'));
	if (scheduleCleanupCron.length === 0) {
		await db.insert(schema.settings).values({
			key: 'schedule_cleanup_cron',
			value: '0 3 * * *' // Daily at 3 AM
		});
		if (verbose) logStep('已创建默认计划清理定时任务');
	}

	const eventCleanupCron = await db.select().from(schema.settings).where(eq(schema.settings.key, 'event_cleanup_cron'));
	if (eventCleanupCron.length === 0) {
		await db.insert(schema.settings).values({
			key: 'event_cleanup_cron',
			value: '30 3 * * *' // Daily at 3:30 AM
		});
		if (verbose) logStep('已创建默认事件清理定时任务');
	}

	// Create default enabled flags for cleanup jobs
	const scheduleCleanupEnabled = await db.select().from(schema.settings).where(eq(schema.settings.key, 'schedule_cleanup_enabled'));
	if (scheduleCleanupEnabled.length === 0) {
		await db.insert(schema.settings).values({
			key: 'schedule_cleanup_enabled',
			value: 'true'
		});
		if (verbose) logStep('已创建默认计划清理启用设置');
	}

	const eventCleanupEnabled = await db.select().from(schema.settings).where(eq(schema.settings.key, 'event_cleanup_enabled'));
	if (eventCleanupEnabled.length === 0) {
		await db.insert(schema.settings).values({
			key: 'event_cleanup_enabled',
			value: 'true'
		});
		if (verbose) logStep('已创建默认事件清理启用设置');
	}

	// Create system roles if not exist
	const adminPermissions = JSON.stringify({
		containers: ['view', 'create', 'start', 'stop', 'restart', 'remove', 'exec', 'logs', 'inspect'],
		images: ['view', 'pull', 'push', 'remove', 'build', 'inspect'],
		volumes: ['view', 'create', 'remove', 'inspect'],
		networks: ['view', 'create', 'remove', 'inspect', 'connect', 'disconnect'],
		stacks: ['view', 'create', 'start', 'stop', 'remove', 'edit'],
		environments: ['view', 'create', 'edit', 'delete'],
		registries: ['view', 'create', 'edit', 'delete'],
		notifications: ['view', 'create', 'edit', 'delete', 'test'],
		configsets: ['view', 'create', 'edit', 'delete'],
		settings: ['view', 'edit'],
		users: ['view', 'create', 'edit', 'delete'],
		git: ['view', 'create', 'edit', 'delete'],
		license: ['manage'],
		audit_logs: ['view'],
		activity: ['view'],
		schedules: ['view', 'edit', 'run']
	});

	const operatorPermissions = JSON.stringify({
		containers: ['view', 'start', 'stop', 'restart', 'logs', 'exec'],
		images: ['view', 'pull'],
		volumes: ['view', 'inspect'],
		networks: ['view', 'inspect'],
		stacks: ['view', 'start', 'stop'],
		environments: ['view'],
		registries: ['view'],
		notifications: ['view'],
		configsets: ['view'],
		settings: ['view'],
		users: [],
		git: ['view', 'create', 'edit'],
		license: [],
		audit_logs: [],
		activity: ['view'],
		schedules: ['view', 'edit', 'run']
	});

	const viewerPermissions = JSON.stringify({
		containers: ['view', 'logs', 'inspect'],
		images: ['view', 'inspect'],
		volumes: ['view', 'inspect'],
		networks: ['view', 'inspect'],
		stacks: ['view'],
		environments: ['view'],
		registries: ['view'],
		notifications: ['view'],
		configsets: ['view'],
		settings: [],
		users: [],
		git: ['view'],
		license: [],
		audit_logs: [],
		activity: ['view'],
		schedules: ['view']
	});

	const existingRoles = await db.select().from(schema.roles);
	if (existingRoles.length === 0) {
		await db.insert(schema.roles).values([
			{ name: 'Admin', description: '拥有所有资源的完全访问权限', isSystem: true, permissions: adminPermissions },
			{ name: 'Operator', description: '可管理容器并查看资源', isSystem: true, permissions: operatorPermissions },
			{ name: 'Viewer', description: '所有资源的只读权限', isSystem: true, permissions: viewerPermissions }
		]);
		logStep('已创建系统角色');
	} else {
		// Update system roles permissions
		const now = new Date().toISOString();
		await db.update(schema.roles)
			.set({ permissions: adminPermissions, updatedAt: now })
			.where(eq(schema.roles.name, 'Admin'));
		await db.update(schema.roles)
			.set({ permissions: operatorPermissions, updatedAt: now })
			.where(eq(schema.roles.name, 'Operator'));
		await db.update(schema.roles)
			.set({ permissions: viewerPermissions, updatedAt: now })
			.where(eq(schema.roles.name, 'Viewer'));
	}

	logSuccess(`数据库初始化完成（${isPostgres ? 'PostgreSQL' : 'SQLite'}）`);
	console.log(SEPARATOR + '\n');
}

// =============================================================================
// STARTUP
// =============================================================================

// Seed the database on startup
await seedDatabase();

// =============================================================================
// EXPORTS
// =============================================================================

// Create proxy to ensure database is initialized before access
const dbProxy = new Proxy({} as any, {
	get(_target, prop) {
		if (!initialized) {
			throw new Error('数据库未初始化，此错误不应发生。');
		}
		return db[prop];
	}
});

// Export the database instance
export { dbProxy as db, rawClient };

// Create lazy schema exports
const schemaProxy = new Proxy({} as any, {
	get(_target, prop) {
		if (!initialized || !schema) {
			throw new Error('数据库未初始化，此错误不应发生。');
		}
		return schema[prop];
	}
});

// Export schema tables via proxy
export const environments = schemaProxy.environments;
export const hawserTokens = schemaProxy.hawserTokens;
export const registries = schemaProxy.registries;
export const settings = schemaProxy.settings;
export const stackEvents = schemaProxy.stackEvents;
export const hostMetrics = schemaProxy.hostMetrics;
export const configSets = schemaProxy.configSets;
export const autoUpdateSettings = schemaProxy.autoUpdateSettings;
export const notificationSettings = schemaProxy.notificationSettings;
export const environmentNotifications = schemaProxy.environmentNotifications;
export const authSettings = schemaProxy.authSettings;
export const users = schemaProxy.users;
export const sessions = schemaProxy.sessions;
export const ldapConfig = schemaProxy.ldapConfig;
export const oidcConfig = schemaProxy.oidcConfig;
export const roles = schemaProxy.roles;
export const userRoles = schemaProxy.userRoles;
export const gitCredentials = schemaProxy.gitCredentials;
export const gitRepositories = schemaProxy.gitRepositories;
export const gitStacks = schemaProxy.gitStacks;
export const stackSources = schemaProxy.stackSources;
export const vulnerabilityScans = schemaProxy.vulnerabilityScans;
export const auditLogs = schemaProxy.auditLogs;
export const containerEvents = schemaProxy.containerEvents;
export const userPreferences = schemaProxy.userPreferences;
export const scheduleExecutions = schemaProxy.scheduleExecutions;
export const stackEnvironmentVariables = schemaProxy.stackEnvironmentVariables;
export const pendingContainerUpdates = schemaProxy.pendingContainerUpdates;
export const apiTokens = schemaProxy.apiTokens;

// Re-export types from SQLite schema (they're compatible with PostgreSQL)
export type {
	Environment,
	NewEnvironment,
	Registry,
	NewRegistry,
	HawserToken,
	NewHawserToken,
	Setting,
	NewSetting,
	User,
	NewUser,
	Session,
	NewSession,
	Role,
	NewRole,
	UserRole,
	NewUserRole,
	OidcConfig,
	NewOidcConfig,
	LdapConfig,
	NewLdapConfig,
	AuthSetting,
	NewAuthSetting,
	ConfigSet,
	NewConfigSet,
	NotificationSetting,
	NewNotificationSetting,
	EnvironmentNotification,
	NewEnvironmentNotification,
	GitCredential,
	NewGitCredential,
	GitRepository,
	NewGitRepository,
	GitStack,
	NewGitStack,
	StackSource,
	NewStackSource,
	VulnerabilityScan,
	NewVulnerabilityScan,
	AuditLog,
	NewAuditLog,
	ContainerEvent,
	NewContainerEvent,
	HostMetric,
	NewHostMetric,
	StackEvent,
	NewStackEvent,
	AutoUpdateSetting,
	NewAutoUpdateSetting,
	UserPreference,
	NewUserPreference,
	ScheduleExecution,
	NewScheduleExecution,
	StackEnvironmentVariable,
	NewStackEnvironmentVariable,
	PendingContainerUpdate,
	NewPendingContainerUpdate,
	ApiToken,
	NewApiToken
} from './schema/index.js';

export { eq, and, or, desc, asc, like, sql, inArray, isNull, isNotNull } from 'drizzle-orm';

interface SchemaInfo {
	version: string | null;
	date: string | null;
}

/**
 * Get the current database schema version from migration journal.
 * Returns the tag and date of the latest migration.
 */
export async function getDatabaseSchemaVersion(): Promise<SchemaInfo> {
	try {
		const journalPath = isPostgres ? './drizzle-pg/meta/_journal.json' : './drizzle/meta/_journal.json';
		const journalContent = readFileSync(journalPath, 'utf-8');
		const journal = JSON.parse(journalContent);

		if (journal.entries && journal.entries.length > 0) {
			// Get the last entry (most recent migration)
			const lastEntry = journal.entries[journal.entries.length - 1];
			const date = lastEntry.when ? new Date(lastEntry.when).toISOString().split('T')[0] : null;
			return {
				version: lastEntry.tag ?? null,
				date
			};
		}
		return { version: null, date: null };
	} catch (e) {
		const errorMsg = e instanceof Error ? e.message : String(e);
		console.error('[DB] 获取结构版本失败：', errorMsg);
		return { version: null, date: null };
	}
}

/**
 * Get PostgreSQL connection info (host and port).
 * Returns null if not using PostgreSQL.
 */
export function getPostgresConnectionInfo(): { host: string; port: string } | null {
	if (!isPostgres) return null;

	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) return null;

	try {
		const url = new URL(databaseUrl);
		return {
			host: url.hostname,
			port: url.port || '5432'
		};
	} catch {
		return null;
	}
}
