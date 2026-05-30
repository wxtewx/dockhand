/**
 * Database Health Check Endpoint
 *
 * Returns detailed information about the database schema state,
 * including migration status, table existence, and connection info.
 *
 * GET /api/health/database
 *
 * Response:
 * {
 *   healthy: boolean,
 *   database: 'sqlite' | 'postgresql',
 *   connection: string,
 *   migrationsTable: boolean,
 *   appliedMigrations: number,
 *   pendingMigrations: number,
 *   schemaVersion: string | null,
 *   tables: {
 *     expected: number,
 *     found: number,
 *     missing: string[]
 *   },
 *   timestamp: string
 * }
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkSchemaHealth } from '$lib/server/db/drizzle';

export const GET: RequestHandler = async () => {
	try {
		const health = await checkSchemaHealth();

		return json(health, {
			status: health.healthy ? 200 : 503,
			headers: {
				'Cache-Control': 'no-cache, no-store, must-revalidate'
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : '未知错误';

		return json(
			{
				healthy: false,
				error: message,
				timestamp: new Date().toISOString()
			},
			{
				status: 500,
				headers: {
					'Cache-Control': 'no-cache, no-store, must-revalidate'
				}
			}
		);
	}
};
