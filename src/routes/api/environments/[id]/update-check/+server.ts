import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import {
	getEnvUpdateCheckSettings,
	setEnvUpdateCheckSettings,
	getEnvironment
} from '$lib/server/db';
import { registerSchedule, unregisterSchedule } from '$lib/server/scheduler';

/**
 * Get update check settings for an environment.
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('environments', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);

		// Verify environment exists
		const env = await getEnvironment(id);
		if (!env) {
			return json({ error: '环境不存在' }, { status: 404 });
		}

		const settings = await getEnvUpdateCheckSettings(id);

		return json({
			settings: settings || {
				enabled: false,
				cron: '0 4 * * *',
				autoUpdate: false,
				vulnerabilityCriteria: 'never'
			}
		});
	} catch (error) {
		console.error('获取更新检查设置失败:', error);
		return json({ error: '获取更新检查设置失败' }, { status: 500 });
	}
};

/**
 * Save update check settings for an environment.
 */
export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('environments', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const id = parseInt(params.id);

		// Verify environment exists
		const env = await getEnvironment(id);
		if (!env) {
			return json({ error: '环境不存在' }, { status: 404 });
		}

		const data = await request.json();

		const settings = {
			enabled: data.enabled ?? false,
			cron: data.cron || '0 4 * * *',
			autoUpdate: data.autoUpdate ?? false,
			vulnerabilityCriteria: data.vulnerabilityCriteria || 'never'
		};

		// Save settings to database
		await setEnvUpdateCheckSettings(id, settings);

		// Register or unregister schedule based on enabled state
		if (settings.enabled) {
			await registerSchedule(id, 'env_update_check', id);
		} else {
			unregisterSchedule(id, 'env_update_check');
		}

		return json({ success: true, settings });
	} catch (error) {
		console.error('保存更新检查设置失败:', error);
		return json({ error: '保存更新检查设置失败' }, { status: 500 });
	}
};
