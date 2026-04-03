import { gzipSync } from 'node:zlib';
import { getContainerArchive, statContainerPath } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const invalid = validateDockerIdParam(params.id, 'container');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const path = url.searchParams.get('path');
	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('containers', 'view', envIdNum)) {
		return new Response(JSON.stringify({ error: '权限不足' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	if (!path) {
		return new Response(JSON.stringify({ error: '路径为必填项' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		// Get format from query parameter (defaults to tar)
		const format = url.searchParams.get('format') || 'tar';

		// Get stat info to determine filename
		let filename: string;
		try {
			const stat = await statContainerPath(params.id, path, envIdNum);
			filename = stat.name || path.split('/').pop() || 'download';
		} catch {
			filename = path.split('/').pop() || 'download';
		}

		// Get the archive from Docker
		const response = await getContainerArchive(
			params.id,
			path,
			envIdNum
		);

		// Prepare response based on format
		let body: ReadableStream<Uint8Array> | Uint8Array = response.body!;
		let contentType = 'application/x-tar';
		let extension = '.tar';

		if (format === 'tar.gz') {
			// Compress with gzip
			const tarData = new Uint8Array(await response.arrayBuffer());
			body = gzipSync(tarData);
			contentType = 'application/gzip';
			extension = '.tar.gz';
		}

		const headers: Record<string, string> = {
			'Content-Type': contentType,
			'Content-Disposition': `attachment; filename="${filename}${extension}"`
		};

		// Set content length for compressed data
		if (body instanceof Uint8Array) {
			headers['Content-Length'] = body.length.toString();
		} else {
			// Pass through content length for streaming tar
			const contentLength = response.headers.get('Content-Length');
			if (contentLength) {
				headers['Content-Length'] = contentLength;
			}
		}

		return new Response(body, { headers });
	} catch (error: any) {
		console.error('下载容器文件错误:', error?.message || error);

		if (error.message?.includes('No such file or directory')) {
			return new Response(JSON.stringify({ error: '文件未找到' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' }
			});
		}
		if (error.message?.includes('Permission denied')) {
			return new Response(JSON.stringify({ error: '访问此路径权限不足' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		return new Response(JSON.stringify({ error: '下载文件失败' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
