import { json, type RequestHandler } from '@sveltejs/kit';
import { getGridPreferences, setGridPreferences, deleteGridPreferences, resetAllGridPreferences } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';
import type { GridColumnPreferences } from '$lib/types';

// GET - retrieve all grid preferences
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);

	try {
		// userId for per-user storage when auth is enabled
		const userId = auth.authEnabled ? auth.user?.id : undefined;
		const preferences = await getGridPreferences(userId);

		return json({ preferences });
	} catch (error) {
		console.error('获取表格偏好设置失败:', error);
		return json({ error: '获取表格偏好设置失败' }, { status: 500 });
	}
};

// POST - update grid preferences for a specific grid
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const body = await request.json();
		const { gridId, columns } = body;

		if (!gridId || typeof gridId !== 'string') {
			return json({ error: 'gridId 为必填项' }, { status: 400 });
		}

		if (!columns || !Array.isArray(columns)) {
			return json({ error: 'columns 数组为必填项' }, { status: 400 });
		}

		// Validate column structure
		for (const col of columns) {
			if (typeof col.id !== 'string' || typeof col.visible !== 'boolean') {
				return json({ error: '每个列必须包含 id (字符串) 和 visible (布尔值)' }, { status: 400 });
			}
		}

		const prefs: GridColumnPreferences = { columns };

		// userId for per-user storage when auth is enabled
		const userId = auth.authEnabled ? auth.user?.id : undefined;
		await setGridPreferences(gridId, prefs, userId);

		// Return updated preferences
		const preferences = await getGridPreferences(userId);
		return json({ preferences });
	} catch (error) {
		console.error('保存表格偏好设置失败:', error);
		return json({ error: '保存表格偏好设置失败' }, { status: 500 });
	}
};

// DELETE - reset grid preferences (single grid or all)
export const DELETE: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const gridId = url.searchParams.get('gridId');
		const userId = auth.authEnabled ? auth.user?.id : undefined;

		if (gridId) {
			await deleteGridPreferences(gridId, userId);
		} else {
			// Reset all grids
			await resetAllGridPreferences(userId);
		}

		const preferences = await getGridPreferences(userId);
		return json({ preferences });
	} catch (error) {
		console.error('重置表格偏好设置失败:', error);
		return json({ error: '重置表格偏好设置失败' }, { status: 500 });
	}
};
