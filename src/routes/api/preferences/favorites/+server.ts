import { json, type RequestHandler } from '@sveltejs/kit';
import { getUserPreference, setUserPreference } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

const LOGS_FAVORITES_KEY = 'logs_favorites';

// Favorites are stored as an array of container names (strings)
// Per environment, so environmentId is required

/**
 * @openapi
 * summary: Get the saved log favorites (container names) for an environment
 * query: env:integer! Environment ID (from GET /api/environments)
 * resp-200: {favorites:array<string>}
 * resp-200-example: {"favorites":["web-1","db-1"]}
 * resp-400: Environment ID is required, or invalid (not a number)
 * resp-500: Failed to get favorites
 */
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

		const favorites = await getUserPreference<string[]>({
			userId,
			environmentId,
			key: LOGS_FAVORITES_KEY
		});

		return json({ favorites: favorites ?? [] });
	} catch (error) {
		console.error('获取收藏失败:', error);
		return json({ error: '获取收藏失败' }, { status: 500 });
	}
};

/**
 * @openapi
 * summary: Add, remove or reorder log favorites (container names) for an environment
 * description: environmentId from GET /api/environments.
 * body: {environmentId:integer!, action:string!, containerName:string, favorites:array<string>}
 * body-example: {"environmentId":1,"action":"add","containerName":"web-1"}
 * resp-200: {favorites:array<string>}
 * resp-400: Invalid environmentId, unknown action, missing favorites array for reorder, or missing containerName for add/remove
 * resp-500: Failed to update favorites
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);

	try {
		const body = await request.json();
		const { containerName, environmentId, action, favorites: newOrder } = body;

		if (!environmentId || typeof environmentId !== 'number') {
			return json({ error: '环境 ID 为必填项' }, { status: 400 });
		}

		if (!action || (action !== 'add' && action !== 'remove' && action !== 'reorder')) {
			return json({ error: '操作必须为 "add"、"remove" 或 "reorder"' }, { status: 400 });
		}

		// userId is null for free edition (shared prefs), set for enterprise
		const userId = auth.user?.id ?? null;

		let newFavorites: string[];

		if (action === 'reorder') {
			// Reorder action: replace entire favorites array
			if (!Array.isArray(newOrder)) {
				return json({ error: '重排序操作需要 favorites 数组' }, { status: 400 });
			}
			newFavorites = newOrder;
		} else {
			// Add/remove actions require containerName
			if (!containerName || typeof containerName !== 'string') {
				return json({ error: '容器名称为必填项' }, { status: 400 });
			}

			// Get current favorites
			const currentFavorites = await getUserPreference<string[]>({
				userId,
				environmentId,
				key: LOGS_FAVORITES_KEY
			}) ?? [];

			if (action === 'add') {
				// Add to favorites if not already present
				if (!currentFavorites.includes(containerName)) {
					newFavorites = [...currentFavorites, containerName];
				} else {
					newFavorites = currentFavorites;
				}
			} else {
				// Remove from favorites
				newFavorites = currentFavorites.filter(name => name !== containerName);
			}
		}

		// Save updated favorites
		await setUserPreference(
			{ userId, environmentId, key: LOGS_FAVORITES_KEY },
			newFavorites
		);

		return json({ favorites: newFavorites });
	} catch (error) {
		console.error('更新收藏失败:', error);
		return json({ error: '更新收藏失败' }, { status: 500 });
	}
};
