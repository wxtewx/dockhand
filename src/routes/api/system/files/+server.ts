import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, isAbsolute } from 'node:path';
import { authorize } from '$lib/server/authorize';

export interface FileEntry {
	name: string;
	path: string;
	type: 'file' | 'directory' | 'symlink';
	size: number;
	mtime: string;
	mode: string;
}

/**
 * POST /api/system/files
 * Create a directory
 *
 * Body: { path: string }
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);

	if (auth.authEnabled && !await auth.can('stacks', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const body = await request.json();
		const path = body.path;

		if (!path || typeof path !== 'string') {
			return json({ error: '路径为必填项' }, { status: 400 });
		}

		if (!isAbsolute(path)) {
			return json({ error: '路径必须为绝对路径' }, { status: 400 });
		}

		if (path.includes('..')) {
			return json({ error: '路径不能包含 ..' }, { status: 400 });
		}

		if (existsSync(path)) {
			return json({ error: '路径已存在' }, { status: 409 });
		}

		mkdirSync(path, { recursive: true });

		return json({ success: true, path });
	} catch (error) {
		console.error('创建目录时出错：', error);
		const message = error instanceof Error ? error.message : '未知错误';
		return json({ error: `创建目录失败：${message}` }, { status: 500 });
	}
};

/**
 * GET /api/system/files
 * Browse Dockhand's local filesystem (for mount browsing)
 *
 * Query params:
 * - path: Directory path to list
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	if (auth.authEnabled && !await auth.can('stacks', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	const path = url.searchParams.get('path') || '/';

	try {
		if (!existsSync(path)) {
			return json({ error: `路径不存在：${path}` }, { status: 404 });
		}

		const stat = statSync(path);
		if (!stat.isDirectory()) {
			return json({ error: `不是目录：${path}` }, { status: 400 });
		}

		const entries: FileEntry[] = [];
		const dirEntries = readdirSync(path, { withFileTypes: true });

		for (const entry of dirEntries) {
			try {
				const fullPath = join(path, entry.name);
				const entryStat = statSync(fullPath);

				entries.push({
					name: entry.name,
					path: fullPath,
					type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
					size: entryStat.size,
					mtime: entryStat.mtime.toISOString(),
					mode: (entryStat.mode & 0o777).toString(8).padStart(3, '0')
				});
			} catch {
				// Skip entries we can't stat (permission issues, etc.)
			}
		}

		// Sort: directories first, then alphabetically
		entries.sort((a, b) => {
			if (a.type === 'directory' && b.type !== 'directory') return -1;
			if (a.type !== 'directory' && b.type === 'directory') return 1;
			return a.name.localeCompare(b.name);
		});

		return json({
			path,
			parent: path === '/' ? null : join(path, '..'),
			entries
		});
	} catch (error) {
		console.error('列出目录时出错：', error);
		const message = error instanceof Error ? error.message : '未知错误';
		return json({ error: `列出目录失败：${message}` }, { status: 500 });
	}
};
