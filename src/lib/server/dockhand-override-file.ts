/**
 * Build the `.env.dockhand` override-file contents for a git stack.
 *
 * A git stack's compose commonly references `env_file: [.env.dockhand]` (the
 * documented way to consume Dockhand-managed non-secret vars). The file must exist
 * for `docker compose up` to parse - even when there are ZERO panel vars, in which
 * case it is just the header line (#1336). Pure: no FS, no DB, so both the local
 * (writeFileSync) and Hawser (in-memory stackFiles) deploy paths share one source of
 * truth and are unit-testable.
 */

const HEADER = '# 由 Dockhand 自动生成。请勿手动编辑 - 下次部署时改动将被覆盖。\n';

export function buildDockhandOverrideFile(envVars: Record<string, string>): string {
	const lines = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);
	return HEADER + lines.join('\n') + (lines.length ? '\n' : '');
}
