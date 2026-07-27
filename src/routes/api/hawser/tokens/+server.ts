/**
 * Hawser Token Management API
 *
 * Handles CRUD operations for Hawser agent tokens.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { db, hawserTokens, eq, desc } from '$lib/server/db/drizzle';
import { generateHawserToken, revokeHawserToken } from '$lib/server/hawser';

/**
 * GET /api/hawser/tokens
 * List all Hawser tokens (without revealing full token values)
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);

	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: '未授权' }, { status: 401 });
	}

	if (auth.authEnabled && !auth.isAdmin) {
		return json({ error: '需要管理员权限' }, { status: 403 });
	}

	try {
		const tokens = await db
			.select({
				id: hawserTokens.id,
				tokenPrefix: hawserTokens.tokenPrefix,
				name: hawserTokens.name,
				environmentId: hawserTokens.environmentId,
				isActive: hawserTokens.isActive,
				lastUsed: hawserTokens.lastUsed,
				createdAt: hawserTokens.createdAt,
				expiresAt: hawserTokens.expiresAt
			})
			.from(hawserTokens)
			.orderBy(desc(hawserTokens.createdAt));

		return json(tokens);
	} catch (error) {
		console.error('获取 Hawser 令牌失败:', error);
		return json({ error: '获取令牌失败' }, { status: 500 });
	}
};

/**
 * POST /api/hawser/tokens
 * Generate a new Hawser token
 *
 * Body: { name: string, environmentId: number, expiresAt?: string }
 * Returns: { token: string, tokenId: number } - token is only shown ONCE
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const auth = await authorize(cookies);

	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: '未授权' }, { status: 401 });
	}

	if (auth.authEnabled && !auth.isAdmin) {
		return json({ error: '需要管理员权限' }, { status: 403 });
	}

	try {
		const body = await request.json();
		const { name, environmentId, expiresAt, rawToken } = body;

		if (!name || typeof name !== 'string') {
			return json({ error: '令牌名称为必填项' }, { status: 400 });
		}

		if (!environmentId || typeof environmentId !== 'number') {
			return json({ error: '环境 ID 为必填项' }, { status: 400 });
		}

		const result = await generateHawserToken(name, environmentId, expiresAt, rawToken);

		return json({
			token: result.token,
			tokenId: result.tokenId,
			message: '令牌生成成功。请保存此令牌 —— 它将不会再次显示。'
		});
	} catch (error) {
		console.error('生成 Hawser 令牌失败:', error);
		return json({ error: '生成令牌失败' }, { status: 500 });
	}
};

/**
 * DELETE /api/hawser/tokens
 * Delete (revoke) a token by ID
 *
 * Query: ?id=<token_id>
 */
export const DELETE: RequestHandler = async ({ url, cookies }) => {
	const auth = await authorize(cookies);

	if (auth.authEnabled && !auth.isAuthenticated) {
		return json({ error: '未授权' }, { status: 401 });
	}

	if (auth.authEnabled && !auth.isAdmin) {
		return json({ error: '需要管理员权限' }, { status: 403 });
	}

	const tokenId = url.searchParams.get('id');
	if (!tokenId) {
		return json({ error: '令牌 ID 为必填项' }, { status: 400 });
	}

	try {
		await revokeHawserToken(parseInt(tokenId, 10));
		return json({ success: true, message: '令牌已吊销' });
	} catch (error) {
		console.error('吊销 Hawser 令牌失败:', error);
		return json({ error: '吊销令牌失败' }, { status: 500 });
	}
};
