import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRegistry } from '$lib/server/db';
import { getRegistryAuth } from '$lib/server/docker';

function isDockerHub(url: string): boolean {
	const lower = url.toLowerCase();
	return lower.includes('docker.io') ||
		   lower.includes('hub.docker.com') ||
		   lower.includes('registry.hub.docker.com');
}

// Manifest types in priority order: single-platform first, then multi-arch
const MANIFEST_TYPES = [
	'application/vnd.docker.distribution.manifest.v2+json',
	'application/vnd.oci.image.manifest.v1+json',
	'application/vnd.docker.distribution.manifest.list.v2+json',
	'application/vnd.oci.image.index.v1+json'
];

export const DELETE: RequestHandler = async ({ url }) => {
	try {
		const registryId = url.searchParams.get('registry');
		const imageName = url.searchParams.get('image');
		const tag = url.searchParams.get('tag');

		if (!registryId) {
			return json({ error: '必须提供镜像仓库 ID' }, { status: 400 });
		}

		if (!imageName) {
			return json({ error: '必须提供镜像名称' }, { status: 400 });
		}

		if (!tag) {
			return json({ error: '必须提供标签' }, { status: 400 });
		}

		const registry = await getRegistry(parseInt(registryId));
		if (!registry) {
			return json({ error: '未找到镜像仓库' }, { status: 404 });
		}

		// Docker Hub doesn't support deletion via API
		if (isDockerHub(registry.url)) {
			return json({ error: 'Docker Hub 不支持通过 API 删除镜像，请使用 Docker Hub 网页界面' }, { status: 400 });
		}

		const { baseUrl, authHeader } = await getRegistryAuth(registry, `repository:${imageName}:pull,push,delete`);

		// Step 1: Resolve manifest digest. Try each type individually because
		// the registry may only serve certain types, and DELETE requires the
		// Accept header to match the stored manifest type.
		const manifestUrl = `${baseUrl}/v2/${imageName}/manifests/${tag}`;
		let digest: string | null = null;
		let matchedType: string | null = null;

		for (const mediaType of MANIFEST_TYPES) {
			const headers: HeadersInit = { 'Accept': mediaType };
			if (authHeader) headers['Authorization'] = authHeader;

			const headResponse = await fetch(manifestUrl, { method: 'HEAD', headers });
			if (headResponse.ok) {
				digest = headResponse.headers.get('Docker-Content-Digest');
				matchedType = mediaType;
				break;
			}
			if (headResponse.status === 401) {
				return json({ error: '认证失败' }, { status: 401 });
			}
		}

		if (!digest || !matchedType) {
			return json({ error: '镜像或标签未找到' }, { status: 404 });
		}

		// Step 2: Delete the manifest by digest using the matched type
		const deleteHeaders: HeadersInit = { 'Accept': matchedType };
		if (authHeader) deleteHeaders['Authorization'] = authHeader;

		const deleteUrl = `${baseUrl}/v2/${imageName}/manifests/${digest}`;
		const deleteResponse = await fetch(deleteUrl, {
			method: 'DELETE',
			headers: deleteHeaders
		});

		if (!deleteResponse.ok) {
			if (deleteResponse.status === 401) {
				return json({ error: '认证失败' }, { status: 401 });
			}
			if (deleteResponse.status === 404) {
				return json({ error: '未找到清单' }, { status: 404 });
			}
			if (deleteResponse.status === 405) {
				return json({ error: '镜像仓库不允许删除，请在仓库上启用 REGISTRY_STORAGE_DELETE_ENABLED=true' }, { status: 405 });
			}
			return json({ error: `删除镜像失败：${deleteResponse.status}` }, { status: deleteResponse.status });
		}

		return json({ success: true, message: `已删除 ${imageName}:${tag}` });
	} catch (error: any) {
		console.error('删除镜像时出错:', error);

		if (error.code === 'ECONNREFUSED') {
			return json({ error: '无法连接到镜像仓库' }, { status: 503 });
		}
		if (error.code === 'ENOTFOUND') {
			return json({ error: '未找到镜像仓库主机' }, { status: 503 });
		}

		return json({ error: error.message || '删除镜像失败' }, { status: 500 });
	}
};
