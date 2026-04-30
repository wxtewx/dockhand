import { json, type RequestHandler } from '@sveltejs/kit';
import { getUserPreference, setUserPreference } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

const LOGS_FAVORITE_GROUPS_KEY = 'logs_favorite_groups';

// Favorite groups are stored as an array of { name: string, containers: string[] }
// Per environment, so environmentId is required

export interface FavoriteGroup {
	name: string;
	containers: string[]; // Container names (not IDs, since IDs change on recreate)
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const envId = url.searchParams.get('env');
		if (!envId) {
			return json({ error: '环境 ID 为必填项' }, { status: 400 });
		}

		const environmentId = parseInt(envId);
		if (isNaN(environmentId)) {
			return json({ error: '无效的环境 ID' }, { status: 400 });
		}

		// userId is null for free edition (shared prefs), set for enterprise
		const userId = auth.user?.id ?? null;

		const groups = await getUserPreference<FavoriteGroup[]>({
			userId,
			environmentId,
			key: LOGS_FAVORITE_GROUPS_KEY
		});

		return json({ groups: groups ?? [] });
	} catch (error) {
		console.error('获取收藏分组失败:', error);
		return json({ error: '获取收藏分组失败' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const body = await request.json();
		const { environmentId, action, name, containers, newName } = body;

		if (!environmentId || typeof environmentId !== 'number') {
			return json({ error: '环境 ID 为必填项' }, { status: 400 });
		}

		if (!action || !['add', 'remove', 'update', 'reorder'].includes(action)) {
			return json({ error: '操作必须为 "add"、"remove"、"update" 或 "reorder"' }, { status: 400 });
		}

		// userId is null for free edition (shared prefs), set for enterprise
		const userId = auth.user?.id ?? null;

		// Get current groups
		const currentGroups = await getUserPreference<FavoriteGroup[]>({
			userId,
			environmentId,
			key: LOGS_FAVORITE_GROUPS_KEY
		}) ?? [];

		let newGroups: FavoriteGroup[];

		if (action === 'add') {
			// Add a new group
			if (!name || typeof name !== 'string') {
				return json({ error: '分组名称为必填项' }, { status: 400 });
			}
			if (!Array.isArray(containers) || containers.length === 0) {
				return json({ error: '容器数组为必填项且不能为空' }, { status: 400 });
			}

			// Check for duplicate name
			if (currentGroups.some(g => g.name === name)) {
				return json({ error: '同名分组已存在' }, { status: 400 });
			}

			newGroups = [...currentGroups, { name, containers }];
		} else if (action === 'remove') {
			// Remove a group by name
			if (!name || typeof name !== 'string') {
				return json({ error: '分组名称为必填项' }, { status: 400 });
			}

			newGroups = currentGroups.filter(g => g.name !== name);
		} else if (action === 'update') {
			// Update a group (rename or change containers)
			if (!name || typeof name !== 'string') {
				return json({ error: '分组名称为必填项' }, { status: 400 });
			}

			const groupIndex = currentGroups.findIndex(g => g.name === name);
			if (groupIndex === -1) {
				return json({ error: '未找到分组' }, { status: 404 });
			}

			// Check for duplicate name if renaming
			if (newName && newName !== name && currentGroups.some(g => g.name === newName)) {
				return json({ error: '同名分组已存在' }, { status: 400 });
			}

			newGroups = [...currentGroups];
			newGroups[groupIndex] = {
				name: newName || name,
				containers: Array.isArray(containers) ? containers : currentGroups[groupIndex].containers
			};
		} else {
			// Reorder: replace entire array
			if (!Array.isArray(body.groups)) {
				return json({ error: '重排序操作需要 groups 数组' }, { status: 400 });
			}
			newGroups = body.groups;
		}

		// Save updated groups
		await setUserPreference(
			{ userId, environmentId, key: LOGS_FAVORITE_GROUPS_KEY },
			newGroups
		);

		return json({ groups: newGroups });
	} catch (error) {
		console.error('更新收藏分组失败:', error);
		return json({ error: '更新收藏分组失败' }, { status: 500 });
	}
};
