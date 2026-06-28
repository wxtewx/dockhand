import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { authorize } from '$lib/server/authorize';

/**
 * GET /api/system/files/content
 * Read file content from Dockhand's local filesystem
 *
 * Query params:
 * - path: File path to read
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
