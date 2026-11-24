import { json, type RequestHandler } from '@sveltejs/kit';
import { authorize } from '$lib/server/authorize';
import { getMinimumReleaseAgeConfig, setMinimumReleaseAgeHours } from '$lib/server/minimum-release-age';
import { parseMinimumReleaseAgeHours } from '$lib/server/minimum-release-age-core';

/**
 * @openapi
 * summary: Get the minimum image age in hours (creation time, with first-observed fallback)
 * resp-200: {hours:number!, overridden:boolean!, inherited:boolean!}
 * resp-403: Permission denied (needs settings:view)
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}
	return json(await getMinimumReleaseAgeConfig());
};

/**
 * @openapi
 * summary: Set the minimum image age in hours (creation time, with first-observed fallback)
 * body: {hours:number!}
 * resp-200: {hours:number!, overridden:boolean!}
 * resp-400: Hours must be a whole number from 0 to 720
 * resp-403: Permission denied (needs settings:edit)
 * resp-409: MINIMUM_RELEASE_AGE_HOURS overrides this setting
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}
	const { hours: raw } = await request.json().catch(() => ({}));
	const hours = parseMinimumReleaseAgeHours(raw);
	if (hours === null) return json({ error: '小时数必须是 0 至 720 之间的整数' }, { status: 400 });
	const config = await getMinimumReleaseAgeConfig();
	if (config.overridden) return json({ error: 'MINIMUM_RELEASE_AGE_HOURS 环境变量会覆盖此配置项' }, { status: 409 });
	await setMinimumReleaseAgeHours(hours);
	return json({ hours, overridden: false });
};
