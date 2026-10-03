import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function resolveStackDirForLayout(
	defaultRoot: string,
	localRoot: string,
	stackName: string,
	environmentName: string | undefined,
	flatLocal: boolean
): string {
	return join(flatLocal ? localRoot : defaultRoot, ...(!flatLocal && environmentName ? [environmentName] : []), stackName);
}

export function findStackNameCollision<T extends { stackName: string; environmentId: number | null }>(
	sources: T[],
	stackName: string,
	environmentId?: number | null
): T | undefined {
	return sources.find(
		(source) => source.stackName === stackName && source.environmentId !== environmentId && source.environmentId != null
	);
}

/** Move a file atomically when possible, with a copy+delete fallback across filesystems. */
export function moveStackFilePathCrossDevice(
	sourcePath: string,
	destPath: string,
	label: string,
	rename: typeof renameSync = renameSync
): void {
	try {
		rename(sourcePath, destPath);
		console.log(`[堆栈] 已移动 ${label}: ${sourcePath} -> ${destPath}`);
	} catch (renameError: any) {
		if (renameError.code !== 'EXDEV') {
			console.warn(`[堆栈] 移动 ${label} 失败: ${renameError.message}`);
			return;
		}

		try {
			writeFileSync(destPath, readFileSync(sourcePath));
			unlinkSync(sourcePath);
			console.log(`[堆栈] 已复制 ${label} (跨文件系统): ${sourcePath} -> ${destPath}`);
		} catch (error: any) {
			console.warn(`[堆栈] 复制 ${label} 失败: ${error.message}`);
		}
	}
}
