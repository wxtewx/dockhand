/**
 * Environment Update Check Task
 *
 * Checks all containers in an environment for available image updates.
 * Can optionally auto-update containers when updates are found.
 */

import type { ScheduleTrigger, VulnerabilityCriteria } from '../../db';
import {
	getEnvUpdateCheckSettings,
	getEnvironment,
	createScheduleExecution,
	updateScheduleExecution,
	appendScheduleExecutionLog,
	saveVulnerabilityScan,
	clearPendingContainerUpdates,
	addPendingContainerUpdate,
	removePendingContainerUpdate
} from '../../db';
import {
	listContainers,
	inspectContainer,
	checkImageUpdateAvailable,
	pullImage,
	getTempImageTag,
	isDigestBasedImage,
	getImageIdByTag,
	removeTempImage,
	tagImage,
} from '../../docker';
import { sendEventNotification } from '../../notifications';
import { getScannerSettings, scanImage, type VulnerabilitySeverity } from '../../scanner';
import { parseImageNameAndTag, shouldBlockUpdate, combineScanSummaries, isSystemContainer } from './update-utils';
import { recreateContainer } from './container-update';

interface UpdateInfo {
	containerId: string;
	containerName: string;
	imageName: string;
	currentImageId: string;
	currentDigest?: string;
	newDigest?: string;
}

// Track running update checks to prevent concurrent execution
const runningUpdateChecks = new Set<number>();

/**
 * Execute environment update check job.
 * @param environmentId - The environment ID to check
 * @param triggeredBy - What triggered this execution
 */
export async function runEnvUpdateCheckJob(
	environmentId: number,
	triggeredBy: ScheduleTrigger = 'cron'
): Promise<void> {
	// Prevent concurrent execution for the same environment
	if (runningUpdateChecks.has(environmentId)) {
		console.log(`[环境更新检查] 环境 ${environmentId} 的更新检查正在运行，已跳过`);
		return;
	}

	runningUpdateChecks.add(environmentId);
	const startTime = Date.now();

	try {
	// Get environment info
	const env = await getEnvironment(environmentId);
	if (!env) {
		console.error(`[环境更新检查] 未找到环境 ${environmentId}`);
		return;
	}

	// Get settings
	const config = await getEnvUpdateCheckSettings(environmentId);
	if (!config) {
		console.error(`[环境更新检查] 未找到环境 ${environmentId} 的配置`);
		return;
	}

	// Create execution record
	const execution = await createScheduleExecution({
		scheduleType: 'env_update_check',
		scheduleId: environmentId,
		environmentId,
		entityName: `更新检查： ${env.name}`,
		triggeredBy,
		status: 'running'
	});

	await updateScheduleExecution(execution.id, {
		startedAt: new Date().toISOString()
	});

	const log = async (message: string) => {
		console.log(`[环境更新检查] ${message}`);
		await appendScheduleExecutionLog(execution.id, `[${new Date().toISOString()}] ${message}`);
	};

	try {
		await log(`开始检查环境更新：${env.name}`);
		await log(`自动更新模式：${config.autoUpdate ? '开启' : '关闭'}`);

		// Clear pending updates at the start - we'll re-add as we discover updates
		await clearPendingContainerUpdates(environmentId);

		// Get all containers in this environment
		const containers = await listContainers(true, environmentId);
		await log(`找到 ${containers.length} 个容器`);

		const updatesAvailable: UpdateInfo[] = [];
		let checkedCount = 0;
		let errorCount = 0;

		// Check each container for updates
		for (const container of containers) {
			try {
				const inspectData = await inspectContainer(container.id, environmentId) as any;
				const imageName = inspectData.Config?.Image;
				const currentImageId = inspectData.Image;

				if (!imageName) {
					await log(`  [${container.name}] 已跳过 - 未找到镜像名称`);
					continue;
				}

				if (isSystemContainer(imageName)) {
					await log(`  [${container.name}] 已跳过 - 系统容器`);
					continue;
				}

				checkedCount++;
				await log(`  正在检查：${container.name} (${imageName})`);

				const result = await checkImageUpdateAvailable(imageName, currentImageId, environmentId);

				if (result.isLocalImage) {
					await log(`    本地镜像 - 跳过更新检查`);
					continue;
				}

				if (result.error) {
					await log(`    错误：${result.error}`);
					errorCount++;
					continue;
				}

				if (result.hasUpdate) {
					updatesAvailable.push({
						containerId: container.id,
						containerName: container.name,
						imageName,
						currentImageId,
						currentDigest: result.currentDigest,
						newDigest: result.registryDigest
					});
					// Add to pending table immediately - will be removed on successful update
					await addPendingContainerUpdate(environmentId, container.id, container.name, imageName);
					await log(`    发现可用更新`);
					await log(`      当前版本：${result.currentDigest?.substring(0, 24) || '未知'}...`);
					await log(`      最新版本：${result.registryDigest?.substring(0, 24) || '未知'}...`);
				} else {
					await log(`    已是最新版本`);
				}
			} catch (err: any) {
				await log(`  [${container.name}] 错误：${err.message}`);
				errorCount++;
			}
		}

		// Summary
		await log('');
		await log('=== 检查汇总 ===');
		await log(`总容器数：${containers.length}`);
		await log(`已检查：${checkedCount}`);
		await log(`可更新：${updatesAvailable.length}`);
		await log(`错误数：${errorCount}`);

		if (updatesAvailable.length === 0) {
			await log('所有容器均为最新版本');
			// Pending updates already cleared at start, nothing to add
			await updateScheduleExecution(execution.id, {
				status: 'success',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: {
					updatesFound: 0,
					containersChecked: checkedCount,
					errors: errorCount
				}
			});
			return;
		}

		// Build notification message with details
		const updateList = updatesAvailable
			.map(u => {
				const currentShort = u.currentDigest?.substring(0, 12) || '未知';
				const newShort = u.newDigest?.substring(0, 12) || '未知';
				return `- ${u.containerName} (${u.imageName})\n  ${currentShort}... -> ${newShort}...`;
			})
			.join('\n');

		if (config.autoUpdate) {
			// Auto-update mode: actually update the containers with safe-pull flow
			await log('');
			await log('=== 自动更新模式 ===');

			// Get scanner settings and vulnerability criteria
			const scannerSettings = await getScannerSettings(environmentId);
			const vulnerabilityCriteria = (config.vulnerabilityCriteria || 'never') as VulnerabilityCriteria;
			// Scan if scanning is enabled (scanner !== 'none')
			// The vulnerabilityCriteria only controls whether to BLOCK updates, not whether to SCAN
			const shouldScan = scannerSettings.scanner !== 'none';

			await log(`漏洞检测规则：${vulnerabilityCriteria}`);
			if (shouldScan) {
				await log(`扫描器：${scannerSettings.scanner} (已启用扫描)`);
			}
			await log(`正在更新 ${updatesAvailable.length} 个容器...`);

			let successCount = 0;
			let failCount = 0;
			let blockedCount = 0;
			const updatedContainers: string[] = [];
			const failedContainers: string[] = [];
			const blockedContainers: { name: string; reason: string; scannerResults?: { scanner: string; critical: number; high: number; medium: number; low: number }[] }[] = [];

			for (const update of updatesAvailable) {
				try {
					await log(`\n正在更新：${update.containerName}`);

					// SAFE-PULL FLOW
					if (shouldScan && !isDigestBasedImage(update.imageName)) {
						const tempTag = getTempImageTag(update.imageName);
						await log(`  使用临时标签安全拉取：${tempTag}`);

						// Step 1: Pull new image
						await log(`  正在拉取 ${update.imageName}...`);
						await pullImage(update.imageName, () => {}, environmentId);

						// Step 2: Get new image ID
						const newImageId = await getImageIdByTag(update.imageName, environmentId);
						if (!newImageId) {
							throw new Error('拉取后无法获取新镜像 ID');
						}
						await log(`  新镜像：${newImageId.substring(0, 19)}`);

						// Step 3: SAFETY - Restore original tag to old image
						const [oldRepo, oldTag] = parseImageNameAndTag(update.imageName);
						await tagImage(update.currentImageId, oldRepo, oldTag, environmentId);
						await log(`  已将原始标签恢复到安全镜像`);

						// Step 4: Tag new image with temp suffix
						const [tempRepo, tempTagName] = parseImageNameAndTag(tempTag);
						await tagImage(newImageId, tempRepo, tempTagName, environmentId);

						// Step 5: Scan temp image
						await log(`  正在扫描漏洞...`);
						let scanBlocked = false;
						let blockReason = '';
						let currentScannerResults: { scanner: string; critical: number; high: number; medium: number; low: number }[] = [];

						// Collect scan logs to log after scan completes
						const scanLogs: string[] = [];

						try {
							const scanResults = await scanImage(tempTag, environmentId, (progress) => {
								if (progress.message) {
									scanLogs.push(`  [${progress.scanner || 'scan'}] ${progress.message}`);
								}
							});

							// Log collected scan messages
							for (const scanLog of scanLogs) {
								await log(scanLog);
							}

							if (scanResults.length > 0) {
								const scanSummary = combineScanSummaries(scanResults);
								await log(`  扫描结果：严重 ${scanSummary.critical} 个，高危 ${scanSummary.high} 个，中危 ${scanSummary.medium} 个，低危 ${scanSummary.low}`);

								// Capture per-scanner results for blocking info
								currentScannerResults = scanResults.map(r => ({
									scanner: r.scanner,
									critical: r.summary.critical,
									high: r.summary.high,
									medium: r.summary.medium,
									low: r.summary.low
								}));

								// Save scan results
								for (const result of scanResults) {
									try {
										await saveVulnerabilityScan({
											environmentId,
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
									} catch { /* ignore save errors */ }
								}

								// Check if blocked
								const { blocked, reason } = shouldBlockUpdate(vulnerabilityCriteria, scanSummary, undefined);
								if (blocked) {
									scanBlocked = true;
									blockReason = reason;
								}
							}
						} catch (scanErr: any) {
							await log(`  扫描失败：${scanErr.message}`);
							scanBlocked = true;
							blockReason = `扫描失败：${scanErr.message}`;
						}

						if (scanBlocked) {
							// BLOCKED - Remove temp image
							await log(`  已阻止更新：${blockReason}`);
							await removeTempImage(newImageId, environmentId);
							await log(`  已移除风险镜像 - 容器保持安全`);
							blockedCount++;
							blockedContainers.push({
								name: update.containerName,
								reason: blockReason,
								scannerResults: currentScannerResults.length > 0 ? currentScannerResults : undefined
							});
							continue;
						}

						// APPROVED - Re-tag to original
						await log(`  扫描通过，重新标记镜像...`);
						await tagImage(newImageId, oldRepo, oldTag, environmentId);
						try {
							await removeTempImage(tempTag, environmentId);
						} catch { /* ignore cleanup errors */ }
					} else {
						// Simple pull (no scanning or digest-based image)
						await log(`  正在拉取 ${update.imageName}...`);
						await pullImage(update.imageName, () => {}, environmentId);
					}

					// Recreate container with full config passthrough
					await log(`  正在重新创建容器...`);
					const result = await recreateContainer(update.containerName, environmentId,
						(msg) => { log(`  ${msg}`); });
					if (!result.success) throw new Error(result.error || '容器重建失败');

					await log(`  更新成功`);
					successCount++;
					updatedContainers.push(update.containerName);
					// Remove from pending table - successfully updated
					await removePendingContainerUpdate(environmentId, update.containerId);
				} catch (err: any) {
					await log(`  失败：${err.message}`);
					failCount++;
					failedContainers.push(update.containerName);
				}
			}

			await log('');
			await log(`=== 更新完成 ===`);
			await log(`更新成功：${successCount}`);
			await log(`已阻止：${blockedCount}`);
			await log(`更新失败：${failCount}`);

			// Send notifications
			if (blockedCount > 0) {
				await sendEventNotification('auto_update_blocked', {
					title: `${env.name} 中有 ${blockedCount} 个更新已被阻止`,
					message: blockedContainers.map(c => `- ${c.name}: ${c.reason}`).join('\n'),
					type: 'warning'
				}, environmentId);
			}

			const notificationMessage = successCount > 0
				? `已更新 ${successCount} 个容器 (环境：${env.name})：\n${updatedContainers.map(c => `- ${c}`).join('\n')}${blockedCount > 0 ? `\n\n已阻止 (${blockedCount} 个):\n${blockedContainers.map(c => `- ${c.name}`).join('\n')}` : ''}${failCount > 0 ? `\n\n失败 (${failCount} 个):\n${failedContainers.map(c => `- ${c}`).join('\n')}` : ''}`
				: blockedCount > 0 ? `${env.name} 中所有更新均已被阻止` : `${env.name} 中所有容器更新均失败`;

			await sendEventNotification('batch_update_success', {
				title: successCount > 0 ? `${env.name} 容器已更新` : blockedCount > 0 ? `${env.name} 更新已阻止` : `${env.name} 容器更新失败`,
				message: notificationMessage,
				type: successCount > 0 && failCount === 0 && blockedCount === 0 ? 'success' : successCount > 0 ? 'warning' : 'error'
			}, environmentId);

			// Blocked/failed containers stay in pending table (successfully updated ones were removed)

			await updateScheduleExecution(execution.id, {
				status: failCount > 0 && successCount === 0 && blockedCount === 0 ? 'failed' : 'success',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: {
					mode: 'auto_update',
					updatesFound: updatesAvailable.length,
					containersChecked: checkedCount,
					errors: errorCount,
					autoUpdate: true,
					vulnerabilityCriteria,
					summary: { checked: checkedCount, updated: successCount, blocked: blockedCount, failed: failCount },
					containers: [
						...updatedContainers.map(name => ({ name, status: 'updated' as const })),
						...blockedContainers.map(c => ({ name: c.name, status: 'blocked' as const, blockReason: c.reason, scannerResults: c.scannerResults })),
						...failedContainers.map(name => ({ name, status: 'failed' as const }))
					],
					updated: successCount,
					blocked: blockedCount,
					failed: failCount,
					blockedContainers
				}
			});
		} else {
			// Check-only mode: just send notification
			await log('');
			await log('仅检查模式 - 正在发送可用更新通知');
			// Pending updates already added as we discovered them

			await sendEventNotification('updates_detected', {
				title: `${env.name} 中发现容器更新`,
				message: `发现 ${updatesAvailable.length} 个可用更新：\n${updateList}`,
				type: 'info'
			}, environmentId);

			await updateScheduleExecution(execution.id, {
				status: 'success',
				completedAt: new Date().toISOString(),
				duration: Date.now() - startTime,
				details: {
					mode: 'notify_only',
					updatesFound: updatesAvailable.length,
					containersChecked: checkedCount,
					errors: errorCount,
					autoUpdate: false,
					summary: { checked: checkedCount, updated: 0, blocked: 0, failed: 0 },
					containers: updatesAvailable.map(u => ({
						name: u.containerName,
						status: 'checked' as const,
						imageName: u.imageName,
						currentDigest: u.currentDigest,
						newDigest: u.newDigest
					}))
				}
			});
		}
	} catch (error: any) {
		await log(`错误：${error.message}`);
		await updateScheduleExecution(execution.id, {
			status: 'failed',
			completedAt: new Date().toISOString(),
			duration: Date.now() - startTime,
			errorMessage: error.message
		});
	}
	} finally {
		runningUpdateChecks.delete(environmentId);
	}
}
