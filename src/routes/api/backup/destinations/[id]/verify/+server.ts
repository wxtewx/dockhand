import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authorize } from '$lib/server/authorize';
import { requireBackups } from '$lib/server/backups/route-guards';
import { auditBackupDestination } from '$lib/server/audit';
import { getBackupDestination } from '$lib/server/db';
import { verifyBackup } from '$lib/server/backups';
import { createJobResponse } from '$lib/server/sse';

export const POST: RequestHandler = async (event) => {
	const { params, request, cookies } = event;
	const auth = await authorize(cookies);
	const denied = await requireBackups(auth, 'manage');
	if (denied) return denied;

	const destinationId = parseInt(params.id);
	if (isNaN(destinationId)) return json({ error: '无效的存储目标 ID' }, { status: 400 });

	const body = await request.json().catch(() => ({}));
	const dataSubset = body.dataSubset || '5%';

	const dest = await getBackupDestination(destinationId);
	if (dest) {
		await auditBackupDestination(event, 'verify', destinationId, dest.name, { dataSubset });
	}

	return createJobResponse(async (send) => {
		send('progress', { message: `正在校验备份完整性 (读取 ${dataSubset} 的数据)...` });

		const result = await verifyBackup(destinationId, {
			dataSubset,
			onProgress: (message) => {
				send('progress', { message });
			}
		});

		send('result', result);

		if (!result.success) {
			throw new Error(result.error || '校验失败');
		}
	}, request);
};
