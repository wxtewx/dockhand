import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStackSources } from '$lib/server/db';
import { authorize } from '$lib/server/authorize';

/**
 * @openapi
 * summary: List stack source records (their stored compose/env paths and source type)
 * query: env:integer Filter to a single environment id
 * resp-403: Permission denied (needs stacks:view)
 * resp-500: Failed to list stack sources
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('stacks', 'view', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const sources = await getStackSources(envIdNum);

		// Convert to a map for easier lookup in the frontend
		const sourceMap: Record<
			string,
			{
				sourceType: string;
				composePath?: string | null;
				repository?: any;
				secretProviderId?: number | null;
				icon?: string | null;
			}
		> = {};
		for (const source of sources) {
			sourceMap[source.stackName] = {
				sourceType: source.sourceType,
				composePath: source.composePath,
				repository: source.repository,
				secretProviderId: source.secretProviderId,
				icon: source.icon ?? null,
			};
		}

		return json(sourceMap);
	} catch (error) {
		console.error('获取堆栈源信息失败：', error);
		return json({ error: '获取堆栈源信息失败' }, { status: 500 });
	}
};
