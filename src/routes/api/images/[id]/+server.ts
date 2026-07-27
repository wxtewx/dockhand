import { json } from '@sveltejs/kit';
import { removeImage, inspectImage } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { auditImage } from '$lib/server/audit';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async (event) => {
	const { params, url, cookies } = event;
	const invalid = validateDockerIdParam(params.id, 'image');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const force = url.searchParams.get('force') === 'true';
	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context
	if (auth.authEnabled && !await auth.can('images', 'remove', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	// Environment access check (enterprise only)
	if (envIdNum && auth.isEnterprise && !await auth.canAccessEnvironment(envIdNum)) {
		return json({ error: '无权访问此环境' }, { status: 403 });
	}

	try {
		console.log('删除镜像请求 - params.id:', params.id, '强制删除:', force, '环境 ID:', envIdNum);

		// Get image name for audit before deleting
		let imageName = params.id;
		try {
			const imageInfo = await inspectImage(params.id, envIdNum);
			imageName = imageInfo.RepoTags?.[0] || params.id;
		} catch (e) {
			console.log('无法检查镜像:', e);
			// Use ID if can't get name
		}

		await removeImage(params.id, force, envIdNum);

		// Audit log
		await auditImage(event, 'delete', params.id, imageName, envIdNum, { force });

		return json({ success: true });
	} catch (error: any) {
		console.error('删除镜像失败:', error.message, '状态码:', error.statusCode, '错误信息:', error.json);

		// Handle specific Docker errors
		if (error.statusCode === 409) {
			const message = error.json?.message || error.message || '';
			if (message.includes('being used by running container')) {
				return json({ error: '无法删除镜像：正在被运行中的容器使用。请先停止容器。' }, { status: 409 });
			}
			if (message.includes('has dependent child images')) {
				return json({ error: '无法删除镜像：存在依赖的子镜像。请先删除子镜像或使用强制删除。' }, { status: 409 });
			}
			return json({ error: message || '镜像正在使用中，无法删除' }, { status: 409 });
		}

		return json({ error: '删除镜像失败' }, { status: 500 });
	}
};
