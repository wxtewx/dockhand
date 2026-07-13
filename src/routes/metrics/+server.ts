/**
 * Prometheus metrics endpoint (#339), served at /metrics (Prometheus convention).
 *
 * Gating:
 *  - Disabled unless EXPORT_METRICS=true → 404 (looks like the route doesn't exist).
 *  - When app auth is DISABLED, /metrics is public (mirrors /api/health), so a
 *    trusted-network scrape works out of the box.
 *  - When app auth is ENABLED, a valid session OR API bearer token is required
 *    (authorize() handles both) → 401 otherwise. Prometheus scrapes with a
 *    `authorization: { credentials: <token> }`.
 */
import { authorize } from '$lib/server/authorize';
import { METRICS_ENABLED, renderMetrics, metricsContentType } from '$lib/server/metrics';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	if (!METRICS_ENABLED) {
		return new Response('未找到该资源', { status: 404 });
	}

	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAuthenticated) {
		return new Response('未授权访问', {
			status: 401,
			headers: { 'WWW-Authenticate': 'Bearer' }
		});
	}

	try {
		const body = await renderMetrics();
		return new Response(body, {
			status: 200,
			headers: { 'Content-Type': metricsContentType }
		});
	} catch (error) {
		console.error('[指标采集] 渲染失败:', error);
		return new Response('# 指标采集失败\n', {
			status: 500,
			headers: { 'Content-Type': 'text/plain' }
		});
	}
};
