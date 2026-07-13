import { json, type RequestHandler } from '@sveltejs/kit';
import { scanImage, scanResultToDbFormat, type ScanProgress } from '$lib/server/scanner';
import { saveVulnerabilityScan, getLatestScanForImage } from '$lib/server/db';
import { inspectImage } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { createJobResponse } from '$lib/server/sse';

// POST - Start a scan (returns { jobId } for progress polling, or synchronous JSON for Accept: application/json)
export const POST: RequestHandler = async ({ request, url, cookies }) => {
	const auth = await authorize(cookies);

	const envIdParam = url.searchParams.get('env');
	const envId = envIdParam ? parseInt(envIdParam) : undefined;

	// Permission check with environment context (Scanning is an inspect operation)
	if (auth.authEnabled && !await auth.can('images', 'inspect', envId)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	const body = await request.json();
	const { imageName, scanner: forceScannerType } = body;

	if (!imageName) {
		return json({ error: '镜像名称为必填项' }, { status: 400 });
	}

	return createJobResponse(async (send) => {
		const sendProgress = (progress: ScanProgress) => {
			send('progress', progress);
		};

		try {
			const results = await scanImage(imageName, envId, sendProgress, forceScannerType);

			// Save results to database
			for (const result of results) {
				await saveVulnerabilityScan(scanResultToDbFormat(result, envId));
			}

			// Send final complete message with all results
			const completeProgress: ScanProgress = {
				stage: 'complete',
				message: `扫描完成 - 发现 ${results.reduce((sum, r) => sum + r.vulnerabilities.length, 0)} 个漏洞`,
				progress: 100,
				result: results[0],
				results: results // Include all scanner results
			};
			send('result', completeProgress);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			const errorProgress: ScanProgress = {
				stage: 'error',
				message: `扫描失败: ${errorMsg}`,
				error: errorMsg
			};
			send('result', errorProgress);
			throw error;
		}
	}, request);
};

// GET - Get cached scan results for an image
export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	const imageName = url.searchParams.get('image');
	const envIdParam = url.searchParams.get('env');
	const envId = envIdParam ? parseInt(envIdParam) : undefined;
	const scanner = url.searchParams.get('scanner') as 'grype' | 'trivy' | undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('images', 'view', envId)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	if (!imageName) {
		return json({ error: '镜像名称为必填项' }, { status: 400 });
	}

	try {
		// Resolve tag to SHA256 ID for reliable cache lookup
		let imageId = imageName;
		try {
			const info = await inspectImage(imageName, envId) as any;
			if (info.Id) imageId = info.Id;
		} catch {
			// Fall back to name if inspect fails
		}

		const result = await getLatestScanForImage(imageId, scanner, envId);
		if (!result) {
			return json({ found: false });
		}

		return json({
			found: true,
			result
		});
	} catch (error) {
		console.error('获取扫描结果失败:', error);
		return json({ error: '获取扫描结果失败' }, { status: 500 });
	}
};
