import { json } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { authorize } from '$lib/server/authorize';
import { getOwnContainerId, getOwnDockerHost, getAutoDetectedDockerHost } from '$lib/server/host-path';
import { getRegistryManifestDigest, unixSocketRequest, dockerFetch } from '$lib/server/docker';
import { getEnvironments } from '$lib/server/db';
import { compareVersions } from '$lib/utils/version';
import type { RequestHandler } from './$types';

/**
 * When there is no local socket and no DOCKER_HOST (e.g. a socket-proxy setup
 * that mounts no docker.sock, #1203), find the environment whose daemon actually
 * runs the Dockhand container by inspecting our own container ID on each
 * candidate. This is deterministic even with several `direct` envs, one of which
 * is a genuinely remote host - the remote daemon returns 404 for our ID, so we
 * never pick it. Memoized: the answer is stable for the process lifetime.
 * Returns the env id, or null if none host us.
 */
let ownEnvIdMemo: number | null | undefined;
async function resolveOwnEnvId(containerId: string): Promise<number | null> {
	if (ownEnvIdMemo !== undefined) return ownEnvIdMemo;

	const envs = await getEnvironments();
	// Socket/local envs first (cheapest, almost always us), then direct.
	const candidates = [
		...envs.filter((e) => e.connectionType === 'socket' || !e.connectionType),
		...envs.filter((e) => e.connectionType === 'direct')
	];
	for (const env of candidates) {
		try {
			const res = await dockerFetch(`/containers/${containerId}/json`, {}, env.id);
			if (res.ok) {
				console.log(`[自动更新] Dockhand 运行在环境 "${env.name}" (id ${env.id}, ${env.connectionType || 'socket'}); 将使用该环境执行更新检测`);
				ownEnvIdMemo = env.id;
				return env.id;
			}
		} catch {
			// Env unreachable or does not host us; try the next candidate.
		}
	}
	console.log('[自动更新] 已配置的环境中没有承载 Dockhand 容器的环境；无法连接 Docker 进行更新检测');
	ownEnvIdMemo = null;
	return null;
}

/**
 * Fetch from the Docker daemon running Dockhand itself (not via env routing,
 * which fails on private-registry images - see the private-registry fix).
 *
 * Order: explicit DOCKER_HOST tcp -> local socket if present -> the environment
 * that actually hosts our own container. The last path covers socket-proxy
 * setups with no docker.sock mount and no DOCKER_HOST (#1203), so the user does
 * not have to set DOCKER_HOST (which breaks scanner networking, #1204).
 */
async function localDockerFetch(path: string, options: RequestInit = {}): Promise<Response> {
	const dockerHost = process.env.DOCKER_HOST || getOwnDockerHost() || getAutoDetectedDockerHost();

	if (dockerHost?.startsWith('tcp://')) {
		// TCP connection (socat proxy, socket-proxy, remote Docker)
		const url = dockerHost.replace('tcp://', 'http://') + path;
		return fetch(url, options);
	}

	const socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
	if (existsSync(socketPath)) {
		return unixSocketRequest(socketPath, path, options);
	}

	const containerId = getOwnContainerId();
	if (containerId) {
		const ownEnvId = await resolveOwnEnvId(containerId);
		if (ownEnvId !== null) {
			return dockerFetch(path, options, ownEnvId);
		}
	}

	// Nothing usable: fall through to the socket path so the caller gets the
	// original ENOENT rather than a silent success.
	return unixSocketRequest(socketPath, path, options);
}

/**
 * Check if a Dockhand update is available.
 * Admin-only. Auto-checked when Settings > About is opened.
 *
 * Uses localDockerFetch exclusively to avoid environment routing issues
 * when the image comes from a private registry.
 */
export const GET: RequestHandler = async ({ cookies }) => {
	const auth = await authorize(cookies);
	if (auth.authEnabled && !auth.isAdmin) {
		return json({ error: '需要管理员权限' }, { status: 403 });
	}

	const containerId = getOwnContainerId();
	if (!containerId) {
		console.log('[自动更新] 未在 Docker 中运行，跳过更新检查');
		return json({
			updateAvailable: false,
			error: '未在 Docker 中运行'
		});
	}

	try {
		// Inspect own container to get current image info
		const inspectResponse = await localDockerFetch(`/containers/${containerId}/json`);
		if (!inspectResponse.ok) {
			console.log(`[自动更新] 检查容器 ${containerId.substring(0, 12)} 失败: ${inspectResponse.status}`);
			return json({
				updateAvailable: false,
				error: '检查自身容器失败'
			});
		}

		const inspectData = await inspectResponse.json() as {
			Config?: { Image?: string; Labels?: Record<string, string> };
			Image?: string;
			Name?: string;
		};

		const currentImage = inspectData.Config?.Image || '';
		const currentImageId = inspectData.Image || '';
		const containerName = inspectData.Name?.replace(/^\//, '') || '';

		console.log(`[自动更新] 容器: ${containerId.substring(0, 12)}, 镜像: ${currentImage}, 标签: ${currentImage.split(':').pop() || 'latest'}`);

		if (!currentImage) {
			console.log('[自动更新] 无法从检查数据中确定当前镜像');
			return json({
				updateAvailable: false,
				error: '无法确定当前镜像'
			});
		}

		// Detect if managed by Docker Compose
		const isComposeManaged = !!inspectData.Config?.Labels?.['com.docker.compose.project'];

		// Digest-based images (e.g. image@sha256:...) can't be checked for updates
		if (currentImage.includes('@sha256:')) {
			console.log('[自动更新] 镜像已通过摘要固定，无法检查更新');
			return json({
				updateAvailable: false,
				currentImage,
				currentDigest: currentImage.split('@')[1],
				containerName,
				isComposeManaged
			});
		}

		// Extract tag from image name
		const colonIdx = currentImage.lastIndexOf(':');
		const tag = colonIdx > -1 ? currentImage.substring(colonIdx + 1) : 'latest';
		const imageWithoutTag = colonIdx > -1 ? currentImage.substring(0, colonIdx) : currentImage;

		// Check if this is a versioned tag (e.g., v1.0.18, 1.0.18, v1.0.18-baseline)
		const versionMatch = tag.match(/^(v?\d+\.\d+\.\d+)(-baseline)?$/);

		if (versionMatch) {
			// Version-based check: compare against latest released version from changelog
			const currentTagVersion = versionMatch[1];
			const suffix = versionMatch[2] || ''; // '-baseline' or ''
			console.log(`[自动更新] 基于版本检查: 当前=${currentTagVersion}${suffix}`);

			try {
				const changelogResponse = await fetch(
					'https://raw.githubusercontent.com/Finsys/dockhand/main/src/lib/data/changelog.json',
					{ signal: AbortSignal.timeout(5000) }
				);

				if (!changelogResponse.ok) {
					console.log(`[自动更新] 从 GitHub 获取更新日志失败: ${changelogResponse.status}`);
					return json({
						updateAvailable: false,
						currentImage,
						containerName,
						isComposeManaged,
						error: '无法从 GitHub 获取更新日志'
					});
				}

				const changelog = await changelogResponse.json() as Array<{
					version: string;
					comingSoon?: boolean;
					date?: string;
					changes?: Array<{ type: string; text: string }>;
				}>;

				// Find latest released version (first entry without comingSoon)
				const latestRelease = changelog.find(entry => !entry.comingSoon);

				if (!latestRelease) {
					console.log('[自动更新] 在更新日志中未找到已发布版本');
					return json({
						updateAvailable: false,
						currentImage,
						containerName,
						isComposeManaged,
						error: '在更新日志中未找到已发布版本'
					});
				}

				const latestVersion = latestRelease.version;
				const hasNewer = compareVersions(latestVersion, currentTagVersion) > 0;
				console.log(`[自动更新] 最新版本: ${latestVersion}, 当前版本: ${currentTagVersion}, 有更新: ${hasNewer}`);

				if (hasNewer) {
					// Build new image tag preserving registry prefix and suffix
					const newTag = `v${latestVersion.replace(/^v/, '')}${suffix}`;
					const newImage = `${imageWithoutTag}:${newTag}`;

					console.log(`[自动更新] 有可用更新: ${currentImage} → ${newImage}`);
					return json({
						updateAvailable: true,
						currentImage,
						newImage,
						latestVersion: latestVersion.replace(/^v/, ''),
						containerName,
						isComposeManaged
					});
				}

				console.log(`[自动更新] 已是最新版本 (${currentTagVersion})`);
				return json({
					updateAvailable: false,
					currentImage,
					containerName,
					isComposeManaged
				});
			} catch (err) {
				console.log(`[自动更新] 版本检查失败: ${err}`);
				return json({
					updateAvailable: false,
					currentImage,
					containerName,
					isComposeManaged,
					error: '版本检查失败: ' + String(err)
				});
			}
		}

		// Digest-based check for mutable tags (:latest, :baseline, etc.)
		console.log(`[自动更新] 对可变标签进行摘要检查: ${tag}`);

		// Inspect image via local Docker socket to get RepoDigests
		const imageResponse = await localDockerFetch(`/images/${encodeURIComponent(currentImageId)}/json`);
		if (!imageResponse.ok) {
			console.log(`[自动更新] 检查镜像 ${currentImageId} 失败: ${imageResponse.status}`);
			return json({
				updateAvailable: false,
				currentImage,
				containerName,
				isComposeManaged,
				error: '无法检查当前镜像'
			});
		}

		const imageInfo = await imageResponse.json() as { RepoDigests?: string[] };
		const repoDigests = imageInfo.RepoDigests || [];

		// Extract local digests from RepoDigests entries (format: "registry/image@sha256:...")
		const localDigests = repoDigests
			.map((rd: string) => {
				const at = rd.lastIndexOf('@');
				return at > -1 ? rd.substring(at + 1) : null;
			})
			.filter(Boolean) as string[];

		if (localDigests.length === 0) {
			console.log('[自动更新] 未找到 RepoDigests — 本地/未标记镜像，无法检查仓库');
			return json({
				updateAvailable: false,
				currentImage,
				newImage: currentImage,
				containerName,
				isComposeManaged,
				isLocalImage: true
			});
		}

		console.log(`[自动更新] 本地摘要: ${localDigests.map(d => d.substring(0, 19)).join(', ')}`);

		// Query registry for latest digest
		const registryDigest = await getRegistryManifestDigest(currentImage);
		if (!registryDigest) {
			console.log(`[自动更新] 无法查询仓库 ${currentImage}`);
			return json({
				updateAvailable: false,
				currentImage,
				newImage: currentImage,
				containerName,
				isComposeManaged,
				error: '无法查询仓库'
			});
		}

		const hasUpdate = !localDigests.includes(registryDigest);
		console.log(`[自动更新] 仓库摘要: ${registryDigest.substring(0, 19)}, 匹配: ${!hasUpdate}, 有更新: ${hasUpdate}`);

		return json({
			updateAvailable: hasUpdate,
			currentImage,
			newImage: currentImage,
			currentDigest: localDigests[0],
			newDigest: registryDigest,
			containerName,
			isComposeManaged
		});
	} catch (err) {
		console.log(`[自动更新] 检查失败: ${err}`);
		return json({
			updateAvailable: false,
			error: '检查失败: ' + String(err)
		});
	}
};
