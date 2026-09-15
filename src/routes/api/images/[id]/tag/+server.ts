import { json } from '@sveltejs/kit';
import { tagImage } from '$lib/server/docker';
import { authorize } from '$lib/server/authorize';
import { validateDockerIdParam } from '$lib/server/docker-validation';
import type { RequestHandler } from './$types';

/**
 * POST /api/images/{id}/tag - Add a repository tag to an image
 *
 * @openapi
 * summary: Tag a Docker image into a repository (defaults the tag to "latest")
 * path: id:string! Image ID or name to tag (from GET /api/images)
 * query: env:integer ID of the environment the image belongs to (from GET /api/environments)
 * body: {repo:string!, tag:string}
 * body-example: {"repo":"registry.example.com/myapp","tag":"v1.2.3"}
 * resp-200: {success:boolean!}
 * resp-200-example: {"success":true}
 * resp-400: Repository name is missing or not a string
 * resp-403: Permission denied
 * resp-500: Failed to tag image
 */
export const POST: RequestHandler = async ({ params, request, url, cookies }) => {
	const invalid = validateDockerIdParam(params.id, 'image');
	if (invalid) return invalid;

	const auth = await authorize(cookies);

	const envId = url.searchParams.get('env');
	const envIdNum = envId ? parseInt(envId) : undefined;

	// Permission check with environment context (Tagging is similar to building/modifying)
	if (auth.authEnabled && !await auth.can('images', 'build', envIdNum)) {
		return json({ error: '权限不足' }, { status: 403 });
	}

	try {
		const { repo, tag } = await request.json();
		if (!repo || typeof repo !== 'string') {
			return json({ error: '仓库名称为必填项' }, { status: 400 });
		}
		await tagImage(params.id, repo, tag || 'latest', envIdNum);
		return json({ success: true });
	} catch (error) {
		console.error('标记镜像失败:', error);
		return json({ error: '标记镜像失败' }, { status: 500 });
	}
};
