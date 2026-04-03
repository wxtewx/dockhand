/**
 * Delete schedule
 * DELETE /api/schedules/:type/:id
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getAutoUpdateSettingById,
	deleteAutoUpdateSchedule,
	updateGitStack,
	deleteEnvUpdateCheckSettings,
	deleteImagePruneSettings
} from '$lib/server/db';
import { unregisterSchedule } from '$lib/server/scheduler';

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		const { type, id } = params;
		const scheduleId = parseInt(id, 10);

		if (isNaN(scheduleId)) {
			return json({ error: '无效的定时任务 ID' }, { status: 400 });
		}

		if (type === 'container_update') {
			// Hard delete container schedule
			const schedule = await getAutoUpdateSettingById(scheduleId);
			if (schedule) {
				await deleteAutoUpdateSchedule(schedule.containerName, schedule.environmentId ?? undefined);
				// Unregister from croner
				unregisterSchedule(scheduleId, 'container_update');
			}
			return json({ success: true });

		} else if (type === 'git_stack_sync') {
			// Disable auto-update for git stack (don't delete the stack itself)
			await updateGitStack(scheduleId, {
				autoUpdate: false,
				autoUpdateSchedule: null,
				autoUpdateCron: null
			});
			// Unregister from croner
			unregisterSchedule(scheduleId, 'git_stack_sync');
			return json({ success: true });

		} else if (type === 'env_update_check') {
			// Delete env update check settings (scheduleId is environmentId)
			await deleteEnvUpdateCheckSettings(scheduleId);
			unregisterSchedule(scheduleId, 'env_update_check');
			return json({ success: true });

		} else if (type === 'image_prune') {
			// Delete image prune settings (scheduleId is environmentId)
			await deleteImagePruneSettings(scheduleId);
			unregisterSchedule(scheduleId, 'image_prune');
			return json({ success: true });

		} else if (type === 'system_cleanup') {
			return json({ error: '系统定时任务无法删除' }, { status: 400 });

		} else {
			return json({ error: '无效的定时任务类型' }, { status: 400 });
		}
	} catch (error) {
		console.error('删除定时任务失败:', error);
		return json({ error: '删除定时任务失败' }, { status: 500 });
	}
};
