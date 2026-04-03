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
		// Note: orgPath is not used here because imageName already contains the full repo path

		const headers: HeadersInit = {
			'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
		};

		if (authHeader) {
			headers['Authorization'] = authHeader;
		}

		// Step 1: Get the manifest digest
		const manifestUrl = `${baseUrl}/v2/${imageName}/manifests/${tag}`;
		const headResponse = await fetch(manifestUrl, {
			method: 'HEAD',
			headers
		});

		if (!headResponse.ok) {
			if (headResponse.status === 401) {
				return json({ error: '认证失败' }, { status: 401 });
			}
			if (headResponse.status === 404) {
				return json({ error: '未找到镜像或标签' }, { status: 404 });
			}
			return json({ error: `获取清单失败：${headResponse.status}` }, { status: headResponse.status });
		}

		const digest = headResponse.headers.get('Docker-Content-Digest');
		if (!digest) {
			return json({ error: '无法获取镜像摘要，镜像仓库可能不支持删除操作' }, { status: 400 });
		}

		// Step 2: Delete the manifest by digest
		const deleteUrl = `${baseUrl}/v2/${imageName}/manifests/${digest}`;
		const deleteResponse = await fetch(deleteUrl, {
			method: 'DELETE',
			headers
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
