import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRegistry } from '$lib/server/db';
import { getRegistryAuth } from '$lib/server/docker';

const PAGE_SIZE = 100;

export const GET: RequestHandler = async ({ url }) => {
	try {
		const registryId = url.searchParams.get('registry');
		const lastParam = url.searchParams.get('last'); // For pagination

		if (!registryId) {
			return json({ error: '必须提供镜像仓库 ID' }, { status: 400 });
		}

		const registry = await getRegistry(parseInt(registryId));
		if (!registry) {
			return json({ error: '未找到该镜像仓库' }, { status: 404 });
		}

		// Docker Hub doesn't support catalog listing
		if (registry.url.includes('docker.io') || registry.url.includes('hub.docker.com') || registry.url.includes('registry.hub.docker.com')) {
			return json({ error: 'Docker Hub 不支持目录列表，请使用搜索功能' }, { status: 400 });
		}

		const { baseUrl, orgPath, authHeader } = await getRegistryAuth(registry, 'registry:catalog:*');

		// Build catalog URL with pagination
		let catalogUrl = `${baseUrl}/v2/_catalog?n=${PAGE_SIZE}`;
		if (lastParam) {
			catalogUrl += `&last=${encodeURIComponent(lastParam)}`;
		}

		const headers: HeadersInit = {
			'Accept': 'application/json'
		};

		if (authHeader) {
			headers['Authorization'] = authHeader;
		}

		const response = await fetch(catalogUrl, {
			method: 'GET',
			headers
		});

		if (!response.ok) {
			if (response.status === 401) {
				return json({ error: '认证失败，请检查你的凭据' }, { status: 401 });
			}
			if (response.status === 404) {
				return json({ error: '该镜像仓库不支持 V2 目录 API' }, { status: 404 });
			}
			return json({ error: `镜像仓库返回错误：${response.status}` }, { status: response.status });
		}

		const data = await response.json();

		// The V2 API returns { repositories: [...] }
		let repositories: string[] = data.repositories || [];

		// If the registry URL has an organization path, filter to only show repos under that path
		if (orgPath) {
			const orgPrefix = orgPath.replace(/^\//, ''); // Remove leading slash
			repositories = repositories.filter(repo => repo.startsWith(orgPrefix + '/') || repo === orgPrefix);
		}

		// Parse Link header for pagination
		// Format: </v2/_catalog?last=xxx&n=100>; rel="next"
		let nextLast: string | null = null;
		const linkHeader = response.headers.get('Link');
		if (linkHeader) {
			const nextMatch = linkHeader.match(/<[^>]*[?&]last=([^&>]+)[^>]*>;\s*rel="next"/);
			if (nextMatch) {
				nextLast = decodeURIComponent(nextMatch[1]);
			}
		}

		// For each repository, we could fetch tags, but that's expensive
		// Just return the repository names for now
		const results = repositories.map((name: string) => ({
			name,
			description: '',
			star_count: 0,
			is_official: false,
			is_automated: false
		}));

		return json({
			repositories: results,
			pagination: {
				pageSize: PAGE_SIZE,
				hasMore: !!nextLast,
				nextLast: nextLast
			}
		});
	} catch (error: any) {
		console.error('获取镜像仓库目录失败:', error);

		if (error.code === 'ECONNREFUSED') {
			return json({ error: '无法连接到镜像仓库' }, { status: 503 });
		}
		if (error.code === 'ENOTFOUND') {
			return json({ error: '未找到镜像仓库主机' }, { status: 503 });
		}
		if (error.cause?.code === 'ERR_SSL_PACKET_LENGTH_TOO_LONG') {
			return json({ error: 'SSL 错误：镜像仓库可能使用 HTTP 而非 HTTPS，请尝试将 URL 改为 http://' }, { status: 503 });
		}
		if (error.cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || error.cause?.code === 'CERT_HAS_EXPIRED') {
			return json({ error: 'SSL 证书错误，镜像仓库可能使用无效或自签名证书' }, { status: 503 });
		}

		return json({ error: '获取目录失败：' + (error.message || '未知错误') }, { status: 500 });
	}
};
