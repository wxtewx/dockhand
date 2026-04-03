/**
 * Container Auto-Update Task
 *
 * Handles automatic container updates with vulnerability scanning.
 * Uses direct Docker API recreation with full Config/HostConfig passthrough
 * from inspect data. No compose commands for
 * individual container updates, no manual field mapping, zero settings loss.
 */

import type { ScheduleTrigger, VulnerabilityCriteria } from '../../db';
import {
	getAutoUpdateSettingById,
	updateAutoUpdateLastChecked,
	updateAutoUpdateLastUpdated,
	createScheduleExecution,
	updateScheduleExecution,
	appendScheduleExecutionLog,
	saveVulnerabilityScan,
	getCombinedScanForImage
} from '../../db';
import {
	pullImage,
	listContainers,
	inspectContainer,
	stopContainer,
	startContainer,
	removeContainer,
	checkImageUpdateAvailable,
	getTempImageTag,
	isDigestBasedImage,
	getImageIdByTag,
	removeTempImage,
	tagImage,
	connectContainerToNetwork,
	disconnectContainerFromNetwork,
	recreateContainerFromInspect
} from '../../docker';
import { getScannerSettings, scanImage, type ScanResult, type VulnerabilitySeverity } from '../../scanner';
import { sendEventNotification } from '../../notifications';
import { parseImageNameAndTag, shouldBlockUpdate, combineScanSummaries, isSystemContainer } from './update-utils';

// =============================================================================
// TYPES
// =============================================================================

interface ScanContext {
	newImageId: string;
	currentImageId: string;
	envId: number | undefined;
	vulnerabilityCriteria: VulnerabilityCriteria;
	log: (msg: string) => void;
}

interface ScanOutcome {
	blocked: boolean;
	reason?: string;
	scanResults?: ScanResult[];
	scanSummary?: VulnerabilitySeverity;
}

interface ExecutionDetails {
	mode: string;
	newDigest?: string;
	vulnerabilityCriteria: VulnerabilityCriteria;
	reason?: string;
	blockReason?: string;
	summary: { checked: number; updated: number; blocked: number; failed: number };
	containers: Array<{
		name: string;
		status: string;
		blockReason?: string;
		scannerResults?: Array<{
			scanner: string;
			critical: number;
			high: number;
			medium: number;
			low: number;
			negligible: number;
			unknown: number;
		}>;
	}>;
	scanResult?: {
		summary: VulnerabilitySeverity;
		scanners: string[];
		scannedAt?: string;
		scannerResults: Array<{
			scanner: string;
			critical: number;
			high: number;
			medium: number;
			low: number;
			negligible: number;
			unknown: number;
		}>;
	};
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Scan an image and check if the update should be blocked based on vulnerability criteria.
 * Handles scanning, saving results, and comparing with current image for 'more_than_current'.
 */
async function scanAndCheckBlock(ctx: ScanContext): Promise<ScanOutcome> {
	const { newImageId, currentImageId, envId, vulnerabilityCriteria, log } = ctx;

	log(`正在扫描新镜像的漏洞...`);

	const scanResults = await scanImage(newImageId, envId, (progress) => {
		const scannerTag = progress.scanner ? `[${progress.scanner}]` : '[scan]';
		if (progress.message) {
			log(`${scannerTag} ${progress.message}`);
		}
		if (progress.output) {
			log(`${scannerTag} ${progress.output}`);
		}
	});

	if (scanResults.length === 0) {
		return { blocked: false, scanResults };
	}

	const scanSummary = combineScanSummaries(scanResults);
	log(`扫描结果：严重 ${scanSummary.critical} 个，高危 ${scanSummary.high} 个，中危 ${scanSummary.medium} 个，低危 ${scanSummary.low} 个`);

	// Save scan results
	for (const result of scanResults) {
		try {
			await saveVulnerabilityScan({
				environmentId: envId ?? null,
				imageId: newImageId,
				imageName: result.imageName,
				scanner: result.scanner,
				scannedAt: result.scannedAt,
				scanDuration: result.scanDuration,
				criticalCount: result.summary.critical,
				highCount: result.summary.high,
				mediumCount: result.summary.medium,
				lowCount: result.summary.low,
				negligibleCount: result.summary.negligible,
				unknownCount: result.summary.unknown,
				vulnerabilities: result.vulnerabilities,
				error: result.error ?? null
			});
		} catch (saveError: any) {
			log(`警告：无法保存扫描结果：${saveError.message}`);
		}
	}

	// Handle 'more_than_current' criteria - need to get/scan current image
	let currentScanSummary: VulnerabilitySeverity | undefined;
	if (vulnerabilityCriteria === 'more_than_current') {
		log(`正在查询当前镜像的缓存扫描记录...`);
		try {
			const cachedScan = await getCombinedScanForImage(currentImageId, envId ?? null);
			if (cachedScan) {
				currentScanSummary = cachedScan;
				log(`缓存扫描结果：严重 ${currentScanSummary.critical} 个，高危 ${currentScanSummary.high} 个`);
			} else {
				log(`未找到缓存扫描记录，正在扫描当前镜像...`);
				const currentScanResults = await scanImage(currentImageId, envId, (progress) => {
					const tag = progress.scanner ? `[${progress.scanner}]` : '[scan]';
					if (progress.message) log(`${tag} ${progress.message}`);
				});
				if (currentScanResults.length > 0) {
					currentScanSummary = combineScanSummaries(currentScanResults);
					log(`当前镜像：严重 ${currentScanSummary.critical} 个，高危 ${currentScanSummary.high} 个`);
					// Save for future use
					for (const result of currentScanResults) {
						try {
							await saveVulnerabilityScan({
								environmentId: envId ?? null,
								imageId: currentImageId,
								imageName: result.imageName,
								scanner: result.scanner,
								scannedAt: result.scannedAt,
								scanDuration: result.scanDuration,
								criticalCount: result.summary.critical,
								highCount: result.summary.high,
								mediumCount: result.summary.medium,
								lowCount: result.summary.low,
								negligibleCount: result.summary.negligible,
								unknownCount: result.summary.unknown,
								vulnerabilities: result.vulnerabilities,
								error: result.error ?? null
							});
						} catch { /* ignore */ }
					}
				}
			}
		} catch (cacheError: any) {
			log(`警告：无法获取当前镜像扫描结果：${cacheError.message}`);
		}
	}

	// Check if update should be blocked
	const { blocked, reason } = shouldBlockUpdate(vulnerabilityCriteria, scanSummary, currentScanSummary);

	if (blocked) {
		log(`已阻止更新：${reason}`);
		return { blocked: true, reason, scanResults, scanSummary };
	}

	log(`扫描通过漏洞检测规则`);
	return { blocked: false, scanResults, scanSummary };
}

/**
 * Build scanner results array from scan results for execution details.
 */
function buildScannerResults(scanResults: ScanResult[]) {
	return scanResults.map(r => ({
		scanner: r.scanner,
		critical: r.summary.critical,
		high: r.summary.high,
		medium: r.summary.medium,
		low: r.summary.low,
		negligible: r.summary.negligible,
		unknown: r.summary.unknown
	}));
}

/**
 * Build execution details for a blocked update.
 */
function buildBlockedDetails(
	containerName: string,
	vulnerabilityCriteria: VulnerabilityCriteria,
	reason: string,
	scanResults: ScanResult[],
	scanSummary: VulnerabilitySeverity
): ExecutionDetails {
	const scannerResults = buildScannerResults(scanResults);
	return {
		mode: 'auto_update',
		reason: 'vulnerabilities_found',
		blockReason: reason,
		vulnerabilityCriteria,
		summary: { checked: 1, updated: 0, blocked: 1, failed: 0 },
		containers: [{
			name: containerName,
			status: 'blocked',
			blockReason: reason,
			scannerResults
		}],
		scanResult: {
			summary: scanSummary,
			scanners: scanResults.map(r => r.scanner),
			scannedAt: scanResults[0]?.scannedAt,
			scannerResults
		}
	};
}

/**
 * Build execution details for a successful update.
 */
function buildSuccessDetails(
	containerName: string,
	newDigest: string | undefined,
	vulnerabilityCriteria: VulnerabilityCriteria,
	scanResults?: ScanResult[],
	scanSummary?: VulnerabilitySeverity
): ExecutionDetails {
	const scannerResults = scanResults ? buildScannerResults(scanResults) : undefined;
	return {
		mode: 'auto_update',
		newDigest,
		vulnerabilityCriteria,
		summary: { checked: 1, updated: 1, blocked: 0, failed: 0 },
		containers: [{
			name: containerName,
			status: 'updated',
			scannerResults
		}],
		scanResult: scanSummary ? {
			summary: scanSummary,
			scanners: scanResults?.map(r => r.scanner) || [],
			scannedAt: scanResults?.[0]?.scannedAt,
			scannerResults: scannerResults || []
		} : undefined
	};
}

// =============================================================================
// MAIN UPDATE FUNCTION
// =============================================================================

/**
 * Execute a container auto-update.
 */
export async function runContainerUpdate(
	settingId: number,
	containerName: string,
	environmentId: number | null | undefined,
	triggeredBy: ScheduleTrigger
): Promise<void> {
	const envId = environmentId ?? undefined;
	const startTime = Date.now();

	// Create execution record
	const execution = await createScheduleExecution({
		scheduleType: 'container_update',
		scheduleId: settingId,
		environmentId: environmentId ?? null,
		entityName: containerName,
		triggeredBy,
		status: 'running'
	});

	await updateScheduleExecution(execution.id, {
		startedAt: new Date().toISOString()
	});

	const log = (message: string) => {
		console.log(`[自动更新] ${message}`);
		appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${message}`);
	};

	try {
		log(`正在检查容器：${containerName}`);
		await updateAutoUpdateLastChecked(containerName, envId);

		// Find the container
		const containers = await listContainers(true, envId);
		const container = containers.find(c => c.name === containerName);

		if (!container) {
			log(`未找到容器：${containerName}`);
			await updateScheduleExecution(execution.id, {
				status: 'failed',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				errorMessage: '未找到容器'
			});
			return;
		}

		// Get the full container config to extract the image name (tag)
		const inspectData = await inspectContainer(container.id, envId) as any;
		const imageNameFromConfig = inspectData.Config?.Image;

		if (!imageNameFromConfig) {
			log(`无法从容器配置中获取镜像名称`);
			await updateScheduleExecution(execution.id, {
				status: 'failed',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				errorMessage: '无法确定镜像名称'
			});
			return;
		}

		// Prevent system containers (Dockhand/Hawser) from being updated
		const systemContainerType = isSystemContainer(imageNameFromConfig);
		if (systemContainerType) {
			const reason = systemContainerType === 'dockhand'
				? '无法自动更新 Dockhand 自身'
				: '无法自动更新 Hawser 代理';
			log(`跳过 ${systemContainerType} 容器 - ${reason}`);
			await updateScheduleExecution(execution.id, {
				status: 'skipped',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: { reason }
			});
			return;
		}

		// Skip digest-pinned images - they are explicitly locked to a specific version
		if (isDigestBasedImage(imageNameFromConfig)) {
			log(`跳过 ${containerName} - 镜像已固定到指定摘要`);
			await updateScheduleExecution(execution.id, {
				status: 'skipped',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: { reason: '镜像已固定到指定摘要' }
			});
			return;
		}

		// Get the actual image ID from inspect data
		const currentImageId = inspectData.Image;

		log(`容器使用的镜像：${imageNameFromConfig}`);
		log(`当前镜像 ID：${currentImageId?.substring(0, 19)}`);

		// Get scanner and schedule settings early to determine scan strategy
		const [scannerSettings, updateSetting] = await Promise.all([
			getScannerSettings(envId),
			getAutoUpdateSettingById(settingId)
		]);

		const vulnerabilityCriteria = (updateSetting?.vulnerabilityCriteria || 'never') as VulnerabilityCriteria;
		const shouldScan = scannerSettings.scanner !== 'none';

		// =============================================================================
		// CHECK FOR UPDATES
		// =============================================================================

		log(`正在检查镜像仓库更新：${imageNameFromConfig}`);
		const registryCheck = await checkImageUpdateAvailable(imageNameFromConfig, currentImageId, envId);

		if (registryCheck.isLocalImage) {
			log(`检测到本地镜像 - 已跳过 (自动更新需要镜像仓库)`);
			await updateScheduleExecution(execution.id, {
				status: 'skipped',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: { reason: '本地镜像 - 无可用镜像仓库' }
			});
			return;
		}

		if (registryCheck.error) {
			log(`镜像仓库检查错误：${registryCheck.error}`);
			await updateScheduleExecution(execution.id, {
				status: 'skipped',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: { reason: `镜像仓库检查失败：${registryCheck.error}` }
			});
			return;
		}

		if (!registryCheck.hasUpdate) {
			log(`已是最新版本：${containerName} 运行的是最新镜像`);
			await updateScheduleExecution(execution.id, {
				status: 'skipped',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: { reason: '已是最新版本' }
			});
			return;
		}

		log(`发现可用更新！仓库摘要：${registryCheck.registryDigest?.substring(0, 19) || '未知'}`);
		const newDigest = registryCheck.registryDigest;

		// =============================================================================
		// PULL & SCAN: Temp-tag protection flow
		// =============================================================================
		// 1. Pull new image (overwrites tag)
		// 2. Restore original tag to OLD image (safety)
		// 3. Tag new image with temp suffix
		// 4. Scan temp image, block if needed
		// 5. Re-tag to original, recreate container
		// =============================================================================

		let newImageId: string | null = null;
		let scanOutcome: ScanOutcome = { blocked: false };

		if (shouldScan && !isDigestBasedImage(imageNameFromConfig)) {
			const tempTag = getTempImageTag(imageNameFromConfig);
			log(`使用临时标签安全拉取：${tempTag}`);

			try {
				// Pull new image
				log(`正在拉取新镜像：${imageNameFromConfig}`);
				await pullImage(imageNameFromConfig, undefined, envId);

				// Get new image ID
				newImageId = await getImageIdByTag(imageNameFromConfig, envId);
				if (!newImageId) {
					throw new Error('拉取后无法获取新镜像 ID');
				}
				log(`新镜像已拉取：${newImageId.substring(0, 19)}`);

				// Restore original tag to OLD image for safety
				log(`正在将原始标签恢复到安全镜像...`);
				const [oldRepo, oldTag] = parseImageNameAndTag(imageNameFromConfig);
				await tagImage(currentImageId, oldRepo, oldTag, envId);

				// Tag new image with temp suffix
				const [tempRepo, tempTagName] = parseImageNameAndTag(tempTag);
				await tagImage(newImageId, tempRepo, tempTagName, envId);
				log(`新镜像已标记为：${tempTag}`);

				// Scan new image (by ID, not temp tag - for proper cache storage)
				try {
					scanOutcome = await scanAndCheckBlock({
						newImageId,
						currentImageId,
						envId,
						vulnerabilityCriteria,
						log
					});

					if (scanOutcome.blocked) {
						log(`正在移除被阻止的镜像：${tempTag}`);
						await removeTempImage(newImageId, envId);

						await updateScheduleExecution(execution.id, {
							status: 'skipped',
							completedAt: new Date().toISOString(),
							duration: Date.now() - startTime,
							details: buildBlockedDetails(
								containerName,
								vulnerabilityCriteria,
								scanOutcome.reason!,
								scanOutcome.scanResults!,
								scanOutcome.scanSummary!
							)
						});

						await sendEventNotification('auto_update_blocked', {
							title: '已阻止自动更新',
							message: `容器 "${containerName}" 更新已被阻止：${scanOutcome.reason}`,
							type: 'warning'
						}, envId);

						return;
					}
				} catch (scanError: any) {
					log(`扫描失败：${scanError.message}`);
					log(`正在移除临时镜像...`);
					await removeTempImage(newImageId, envId);

					await updateScheduleExecution(execution.id, {
						status: 'failed',
						completedAt: new Date().toISOString(),
						duration: Date.now() - startTime,
						errorMessage: `漏洞扫描失败：${scanError.message}`
					});
					return;
				}

				// Re-tag approved image to original
				log(`正在将通过检测的镜像重新标记为：${imageNameFromConfig}`);
				await tagImage(newImageId, oldRepo, oldTag, envId);

				// Clean up temp tag
				try {
					await removeTempImage(tempTag, envId);
				} catch { /* ignore */ }

			} catch (pullError: any) {
				log(`拉取失败：${pullError.message}`);
				await updateScheduleExecution(execution.id, {
					status: 'failed',
					completedAt: new Date().toISOString(),
					duration: Date.now() - startTime,
					errorMessage: `镜像拉取失败：${pullError.message}`
				});
				return;
			}
		} else {
			// No scanning - simple pull
			log(`正在拉取更新 (不进行漏洞扫描)...`);
			try {
				await pullImage(imageNameFromConfig, undefined, envId);
				log(`镜像拉取成功`);
			} catch (pullError: any) {
				log(`拉取失败：${pullError.message}`);
				await updateScheduleExecution(execution.id, {
					status: 'failed',
					completedAt: new Date().toISOString(),
					duration: Date.now() - startTime,
					errorMessage: `镜像拉取失败：${pullError.message}`
				});
				return;
			}
		}

		// =============================================================================
		// RECREATE CONTAINER (full config passthrough from inspect data)
		// =============================================================================

		log(`正在使用完整配置重新创建容器...`);
		const result = await recreateContainer(containerName, envId, log, imageNameFromConfig);

		if (result.success) {
			await updateAutoUpdateLastUpdated(containerName, envId);
			log(`容器更新成功：${containerName}`);

			await updateScheduleExecution(execution.id, {
				status: 'success',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: buildSuccessDetails(
					containerName,
					newDigest,
					vulnerabilityCriteria,
					scanOutcome.scanResults,
					scanOutcome.scanSummary
				)
			});

			await sendEventNotification('auto_update_success', {
				title: '容器已自动更新',
				message: `容器 "${containerName}" 已更新到新版本镜像`,
				type: 'success'
			}, envId);
		} else {
			throw new Error(result.error || '重新创建容器失败');
		}

	} catch (error: any) {
		log(`错误：${error.message}`);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: error.message
		});

		await sendEventNotification('auto_update_failed', {
			title: '自动更新失败',
			message: `容器 "${containerName}" 自动更新失败：${error.message}`,
			type: 'error'
		}, envId);
	}
}

// =============================================================================
// EXPORTED HELPER FUNCTIONS
// =============================================================================

/**
 * Recreate a container using full Config/HostConfig passthrough from inspect data.
 * Passes inspect data directly to Docker API create, only changing the image.
 * No manual field mapping — zero settings loss.
 */
export async function recreateContainer(
	containerName: string,
	envId?: number,
	log?: (msg: string) => void,
	imageNameOverride?: string
): Promise<{ success: boolean; error?: string }> {
	try {
		const containers = await listContainers(true, envId);
		const container = containers.find(c => c.name === containerName);

		if (!container) {
			log?.(`未找到容器：${containerName}`);
			return { success: false, error: `未找到容器：${containerName}` };
		}

		const inspectData = await inspectContainer(container.id, envId) as any;
		const imageName = imageNameOverride || inspectData.Config?.Image;

		log?.(`正在重新创建容器：${containerName} (镜像：${imageName})`);

		await recreateContainerFromInspect(inspectData, imageName, envId, log);
		return { success: true };
	} catch (error: any) {
		log?.(`F重新创建容器失败：${error.message}`);
		return { success: false, error: error.message };
	}
}

