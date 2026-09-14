import { json, type RequestHandler } from '@sveltejs/kit';
import {
	setScheduleCleanupEnabled,
	setEventCleanupEnabled,
	setScannerCleanupEnabled,
	getScheduleCleanupEnabled,
	getEventCleanupEnabled,
	getScannerCleanupEnabled
} from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import { refreshSystemJobs } from '$lib/server/scheduler';

const SYSTEM_SCHEDULE_CLEANUP_ID = 1;
const SYSTEM_EVENT_CLEANUP_ID = 2;
const SYSTEM_SCANNER_CLEANUP_ID = 4;

/**
 * @openapi
 * summary: Toggle one of the three built-in system cleanup jobs (schedule/event/scanner cleanup) on or off
 * path: id:integer! System schedule id (1=schedule cleanup, 2=event cleanup, 4=scanner cleanup) (from GET /api/schedules)
 * resp-200: {success:boolean!, enabled:boolean!}
 * resp-400: Invalid or unknown system schedule id
 * resp-403: Permission denied (RBAC 'settings:edit' missing)
 * resp-500: Unexpected error while toggling the job
 */
export const POST: RequestHandler = async ({ params, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('settings', 'edit')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const { id } = params;
		const systemId = parseInt(id, 10);

		if (isNaN(systemId)) {
			return json({ error: '无效的系统定时任务 ID' }, { status: 400 });
		}

		if (systemId === SYSTEM_SCHEDULE_CLEANUP_ID) {
			const currentEnabled = await getScheduleCleanupEnabled();
			await setScheduleCleanupEnabled(!currentEnabled);
			return json({ success: true, enabled: !currentEnabled });
		} else if (systemId === SYSTEM_EVENT_CLEANUP_ID) {
			const currentEnabled = await getEventCleanupEnabled();
			await setEventCleanupEnabled(!currentEnabled);
			return json({ success: true, enabled: !currentEnabled });
		} else if (systemId === SYSTEM_SCANNER_CLEANUP_ID) {
			const currentEnabled = await getScannerCleanupEnabled();
			await setScannerCleanupEnabled(!currentEnabled);
			await refreshSystemJobs();
			return json({ success: true, enabled: !currentEnabled });
		} else {
			return json({ error: '未知的系统定时任务' }, { status: 400 });
		}
	} catch (error: any) {
		console.error('切换系统定时任务状态失败:', error);
		return json({ error: '切换系统定时任务状态失败' }, { status: 500 });
	}
};
