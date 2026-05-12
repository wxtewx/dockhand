import { json } from '@sveltejs/kit';
import { authorize } from '$lib/server/authorize';
import { getOwnContainerId, getOwnDockerHost } from '$lib/server/host-path';
import { getRegistryManifestDigest, unixSocketRequest } from '$lib/server/docker';
import { compareVersions } from '$lib/utils/version';
import type { RequestHandler } from './$types';

/** Fetch from the local Docker directly (not through environment routing) */
function localDockerFetch(path: string, options: RequestInit = {}): Promise<Response> {
	const dockerHost = process.env.DOCKER_HOST || getOwnDockerHost();

	if (dockerHost?.startsWith('tcp://')) {
		// TCP connection (socat proxy, socket-proxy, remote Docker)
		const url = dockerHost.replace('tcp://', 'http://') + path;
		return fetch(url, options);
	}

	// Unix socket (default)
	const socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
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
