import { json } from '@sveltejs/kit';
import { validateSnapshotId } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { getSnapshotMetadata } from '$lib/server/backups';
import { guardSnapshotEnvAccess } from '$lib/server/backups/route-guards';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !await auth.can('backups', 'view')) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	const snapshotId = params.id;
	const invalidSnap = validateSnapshotId(snapshotId);
	if (invalidSnap) return invalidSnap;

	const destIdParam = url.searchParams.get('destinationId');
	if (!destIdParam) return json({ error: '必须提供 destinationId' }, { status: 400 });

	const destinationId = parseInt(destIdParam);
	if (isNaN(destinationId)) return json({ error: '无效的 destinationId' }, { status: 400 });

	// (HIGH #8) Enforce per-environment access on the snapshot's owning env.
	const envDenied = await guardSnapshotEnvAccess(auth, destinationId, snapshotId);
	if (envDenied) return envDenied;

	try {
		const metadata = await getSnapshotMetadata(destinationId, snapshotId);
		if (!metadata) return json({ error: '暂无可用元数据' }, { status: 404 });
		// Never expose the stored secret VALUES (ciphertext) to the client — replace the
		// `secrets` array with `secretKeys` (names only) so the UI can list them.
		const { secrets, ...safe } = metadata as Record<string, unknown>;
		if (Array.isArray(secrets)) {
			(safe as Record<string, unknown>).secretKeys = secrets
				.map((s: any) => s?.key)
				.filter((k: unknown): k is string => typeof k === 'string');
		}
		return json(safe);
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		return json({ error: msg }, { status: 500 });
	}
};
