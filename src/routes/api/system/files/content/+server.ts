import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { authorize } from '$lib/server/authorize';
import { isProtectedPath } from '$lib/server/fs-guard';

/**
 * GET /api/system/files/content
 * Read file content from Dockhand's local filesystem
 *
 * @openapi
 * summary: Read a text file from Dockhand's local filesystem (max 10MB, protected paths denied)
 * query: path:string! Absolute path of the file to read
 * resp-200: {path:string!, content:string!, size:integer!, mtime:string!}
 * resp-200-example: {"path":"/docker/stacks/myapp/compose.yaml","content":"services:\n  app:\n    image: nginx","size":42,"mtime":"2026-07-01T10:00:00.000Z"}
 * resp-400: Path is missing, points to a directory, or the file exceeds 10MB
 * resp-403: Permission denied, or the path is protected
 * resp-404: File not found
 * resp-500: Failed to read file
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	if (auth.authEnabled && !await auth.can('stacks', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	const path = url.searchParams.get('path');

	if (!path) {
		return json({ error: '路径为必填项' }, { status: 400 });
	}

	if (isProtectedPath(path)) {
		return json({ error: 'Access denied' }, { status: 403 });
	}

	try {
		if (!existsSync(path)) {
			return json({ error: `文件不存在：${path}` }, { status: 404 });
		}

		const stat = statSync(path);
		if (stat.isDirectory()) {
			return json({ error: `无法将目录作为文件读取：${path}` }, { status: 400 });
		}

		// Limit file size to 10MB
		const maxSize = 10 * 1024 * 1024;
		if (stat.size > maxSize) {
			return json({ error: `文件过大（最大 ${maxSize / 1024 / 1024}MB）` }, { status: 400 });
		}

		const content = readFileSync(path, 'utf-8');

		return json({
			path,
			content,
			size: stat.size,
			mtime: stat.mtime.toISOString()
		});
	} catch (error) {
		console.error('读取文件时出错：', error);
		const message = error instanceof Error ? error.message : '未知错误';
		return json({ error: `读取文件失败：${message}` }, { status: 500 });
	}
};
