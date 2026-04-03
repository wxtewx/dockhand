/**
 * Schedule Settings API - Get/set schedule display preferences
 *
 * GET /api/schedules/settings - Get current display settings
 * PUT /api/schedules/settings - Update display settings
 *
 * Note: Data retention settings are now managed in /api/settings/general
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, setSetting } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

// Setting key for hide system jobs preference
const getHideSystemJobsKey = (userId?: number) =>
	userId ? `user_${userId}_schedules_hide_system_jobs` : 'schedules_hide_system_jobs';

export const GET: RequestHandler = async ({ cookies }) => {
	try {
		const auth = await authorize(cookies);
		const userId = auth.isAuthenticated ? auth.user?.id : undefined;

		// Get user-specific setting, fallback to global
		let hideSystemJobs = await getSetting(getHideSystemJobsKey(userId));
		if (hideSystemJobs === null && userId) {
			hideSystemJobs = await getSetting(getHideSystemJobsKey());
		}
		if (hideSystemJobs === null) {
			hideSystemJobs = false; // Default to visible
		}

		return json({ hideSystemJobs });
	} catch (error: any) {
		console.error('获取定时任务设置失败:', error);
		return json({ error: error.message }, { status: 500 });
	}
};

export const PUT: RequestHandler = async ({ request, cookies }) => {
	try {
		const auth = await authorize(cookies);
		const userId = auth.isAuthenticated ? auth.user?.id : undefined;

		const body = await request.json();
		const { hideSystemJobs } = body;

		if (hideSystemJobs !== undefined) {
			if (typeof hideSystemJobs !== 'boolean') {
				return json({ error: 'hideSystemJobs 无效 (必须为布尔值)' }, { status: 400 });
			}
			// Save user-specific preference
			await setSetting(getHideSystemJobsKey(userId), hideSystemJobs);
		}

		return json({ success: true, hideSystemJobs });
	} catch (error: any) {
		console.error('更新定时任务设置失败:', error);
		return json({ error: error.message }, { status: 500 });
	}
};
