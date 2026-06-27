import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import {
	getImagePruneSettings,
	setImagePruneSettings,
	getEnvironment
} from '$lib/server/db';
import { registerSchedule, unregisterSchedule, triggerImagePrune } from '$lib/server/scheduler';

/**
 * Get image prune settings for an environment.
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

		const settings = await getImagePruneSettings(id);

		return json({
			settings: settings || {
				enabled: false,
				cronExpression: '0 3 * * 0', // Default: 3 AM Sunday
				pruneMode: 'dangling'
			}
		});
	} catch (error) {
		console.error('获取镜像清理设置失败:', error);
		return json({ error: '获取镜像清理设置失败' }, { status: 500 });
	}
};

/**
 * Save image prune settings for an environment.
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

		// Get existing settings to preserve lastPruned and lastResult
		const existingSettings = await getImagePruneSettings(id);

		const settings = {
			enabled: data.enabled ?? false,
			cronExpression: data.cronExpression || '0 3 * * 0',
			pruneMode: data.pruneMode || 'dangling',
			lastPruned: existingSettings?.lastPruned,
			lastResult: existingSettings?.lastResult
		};

		// Save settings to database
		await setImagePruneSettings(id, settings);

		// Register or unregister schedule based on enabled state
		if (settings.enabled) {
			await registerSchedule(id, 'image_prune', id);
		} else {
			unregisterSchedule(id, 'image_prune');
		}

		return json({ success: true, settings });
	} catch (error) {
		console.error('保存镜像清理设置失败:', error);
		return json({ error: '保存镜像清理设置失败' }, { status: 500 });
	}
};

/**
 * Manually trigger image prune for an environment.
 */
export const PUT: RequestHandler = async ({ params, cookies }) => {
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

		const result = await triggerImagePrune(id);

		if (!result.success) {
			return json({ error: result.error }, { status: 400 });
		}

		return json({ success: true });
	} catch (error) {
		console.error('触发镜像清理失败:', error);
		return json({ error: '触发镜像清理失败' }, { status: 500 });
	}
};
