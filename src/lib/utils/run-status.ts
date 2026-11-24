/**
 * Formats the status line shown under a compose action's live output window.
 *
 * Pure and import-free on purpose (see run-status.test.ts / bun test tests/ —
 * modules pulled in from src/lib/server or SvelteKit-generated code don't load
 * under Bun's test runner). Keep it that way: no imports here.
 */
export interface RunStatus {
	running: boolean;
	ok?: boolean;
	ms?: number;
	exitCode?: number;
}

export function formatRunStatus(status: RunStatus): string {
	if (status.running) return '运行中…';

	const seconds = typeof status.ms === 'number' ? `${(status.ms / 1000).toFixed(1)}s` : undefined;

	if (status.ok) {
		return seconds ? `已成功 · ${seconds}` : '已成功';
	}

	const exitPart = typeof status.exitCode === 'number' ? `退出码 ${status.exitCode}` : undefined;
	const parts = ['失败', exitPart, seconds].filter((p): p is string => p !== undefined);
	return parts.join(' · ');
}
