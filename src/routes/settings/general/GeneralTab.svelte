<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { TogglePill, ToggleSwitch } from '$lib/components/ui/toggle-pill';
	import CronEditor from '$lib/components/cron-editor.svelte';
	import TimezoneSelector from '$lib/components/TimezoneSelector.svelte';
	import { Eye, Bell, Database, Calendar, ShieldCheck, FileText, AlertTriangle, HelpCircle, Globe, Activity, Clock, Info } from 'lucide-svelte';
	import { appSettings, type DateFormat, type DownloadFormat, type EventCollectionMode } from '$lib/stores/settings';
	import { canAccess, authStore } from '$lib/stores/auth';
	import { toast } from 'svelte-sonner';
	import ThemeSelector from '$lib/components/ThemeSelector.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	// General settings state - these derive from the store
	let confirmDestructive = $derived($appSettings.confirmDestructive);
	let showStoppedContainers = $derived($appSettings.showStoppedContainers);
	let highlightUpdates = $derived($appSettings.highlightUpdates);
	let compactPorts = $derived($appSettings.compactPorts);
	let timeFormat = $derived($appSettings.timeFormat);
	let dateFormat = $derived($appSettings.dateFormat);
	let downloadFormat = $derived($appSettings.downloadFormat);
	let defaultGrypeArgs = $derived($appSettings.defaultGrypeArgs);
	let defaultTrivyArgs = $derived($appSettings.defaultTrivyArgs);
	let defaultGrypeImage = $derived($appSettings.defaultGrypeImage);
	let defaultTrivyImage = $derived($appSettings.defaultTrivyImage);
	let scheduleRetentionDays = $derived($appSettings.scheduleRetentionDays);
	let eventRetentionDays = $derived($appSettings.eventRetentionDays);
	let scheduleCleanupCron = $derived($appSettings.scheduleCleanupCron);
	let eventCleanupCron = $derived($appSettings.eventCleanupCron);
	let scheduleCleanupEnabled = $derived($appSettings.scheduleCleanupEnabled);
	let eventCleanupEnabled = $derived($appSettings.eventCleanupEnabled);
	let logBufferSizeKb = $derived($appSettings.logBufferSizeKb);
	let formatLogTimestamps = $derived($appSettings.formatLogTimestamps);
	let defaultTimezone = $derived($appSettings.defaultTimezone);
	let eventCollectionMode = $derived($appSettings.eventCollectionMode);
	let eventPollInterval = $derived($appSettings.eventPollInterval);
	let metricsCollectionInterval = $derived($appSettings.metricsCollectionInterval);

	let clearingCache = $state(false);

	async function clearScannerCache() {
		clearingCache = true;
		try {
			const res = await fetch('/api/settings/scanner/cache', { method: 'DELETE' });
			const data = await res.json();
			if (res.ok && data.success) {
				const total = (data.removedVolumes?.length || 0) + (data.removedDirs?.length || 0);
				if (total > 0) {
					toast.success(`Scanner cache cleared (${total} items removed)`);
				} else {
					toast.info('Scanner cache was already empty');
				}
			} else {
				toast.error(data.error || 'Failed to clear scanner cache');
			}
		} catch {
			toast.error('Failed to clear scanner cache');
		} finally {
			clearingCache = false;
		}
	}

	const dateFormatOptions: { value: DateFormat; label: string; example: string }[] = [
		{ value: 'DD.MM.YYYY', label: 'DD.MM.YYYY', example: '31.12.2024' },
		{ value: 'DD/MM/YYYY', label: 'DD/MM/YYYY', example: '31/12/2024' },
		{ value: 'MM/DD/YYYY', label: 'MM/DD/YYYY', example: '12/31/2024' },
		{ value: 'YYYY-MM-DD', label: 'YYYY-MM-DD', example: '2024-12-31' }
	];

	function handleScheduleRetentionChange(e: Event) {
		const value = Math.max(1, Math.min(365, parseInt((e.target as HTMLInputElement).value) || 30));
		appSettings.setScheduleRetentionDays(value);
		toast.success('计划保留时间已更新');
	}

	function handleEventRetentionChange(e: Event) {
		const value = Math.max(1, Math.min(365, parseInt((e.target as HTMLInputElement).value) || 30));
		appSettings.setEventRetentionDays(value);
		toast.success('事件保留时间已更新');
	}

	function handleScheduleCleanupCronChange(cron: string) {
		appSettings.setScheduleCleanupCron(cron);
		toast.success('计划清理定时任务已更新');
	}

	function handleEventCleanupCronChange(cron: string) {
		appSettings.setEventCleanupCron(cron);
		toast.success('事件清理定时任务已更新');
	}

	function handleScheduleCleanupEnabledChange() {
		appSettings.setScheduleCleanupEnabled(!scheduleCleanupEnabled);
		toast.success(scheduleCleanupEnabled ? '计划清理已启用' : '计划清理已禁用');
	}

	function handleEventCleanupEnabledChange() {
		appSettings.setEventCleanupEnabled(!eventCleanupEnabled);
		toast.success(eventCleanupEnabled ? '事件清理已启用' : '事件清理已禁用');
	}

	function handleGrypeImageBlur(e: Event) {
		const value = (e.target as HTMLInputElement).value.trim();
		if (value && value !== defaultGrypeImage) {
			appSettings.setDefaultGrypeImage(value);
			toast.success('Grype 镜像已更新');
		}
	}

	function handleTrivyImageBlur(e: Event) {
		const value = (e.target as HTMLInputElement).value.trim();
		if (value && value !== defaultTrivyImage) {
			appSettings.setDefaultTrivyImage(value);
			toast.success('Trivy 镜像已更新');
		}
	}

	function handleGrypeArgsBlur(e: Event) {
		const value = (e.target as HTMLInputElement).value.trim();
		if (value !== defaultGrypeArgs) {
			appSettings.setDefaultGrypeArgs(value);
			toast.success('Grype 默认参数已更新');
		}
	}

	function handleTrivyArgsBlur(e: Event) {
		const value = (e.target as HTMLInputElement).value.trim();
		if (value !== defaultTrivyArgs) {
			appSettings.setDefaultTrivyArgs(value);
			toast.success('Trivy 默认参数已更新');
		}
	}

	function handleLogBufferSizeChange(e: Event) {
		const value = Math.max(100, Math.min(5000, parseInt((e.target as HTMLInputElement).value) || 500));
		appSettings.setLogBufferSizeKb(value);
		toast.success('日志缓冲区大小已更新');
	}

	function handleEventCollectionModeChange(value: string | undefined) {
		if (value === 'stream' || value === 'poll') {
			appSettings.setEventCollectionMode(value);
			toast.success(`事件采集模式：${value === 'stream' ? '流式' : '轮询'}`);
		}
	}

	function handleEventPollIntervalChange(selected: { value: number } | undefined) {
		if (selected?.value) {
			appSettings.setEventPollInterval(selected.value);
			toast.success(`事件轮询间隔：${selected.value / 1000}秒`);
		}
	}

	function handleMetricsIntervalChange(selected: { value: number } | undefined) {
		if (selected?.value) {
			appSettings.setMetricsCollectionInterval(selected.value);
			toast.success(`指标采集间隔：${selected.value / 1000}秒`);
		}
	}
</script>

<div class="flex-1 min-h-0 overflow-y-auto">
	<div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
		<!-- Left column -->
		<div class="space-y-4">
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-sm font-medium flex items-center gap-2">
						<Eye class="w-4 h-4" />
						界面显示
						<Tooltip.Provider delayDuration={100}>
							<Tooltip.Root>
								<Tooltip.Trigger>
									<HelpCircle class="w-4 h-4 text-muted-foreground cursor-help" />
								</Tooltip.Trigger>
								<Tooltip.Portal>
									<Tooltip.Content side="right" sideOffset={8} class="!w-80">
										{#if $authStore.authEnabled}
											这些设置应用于登录页并作为默认值，个人偏好可在个人资料中配置。
										{:else}
											关闭身份验证时，主题和字体设置为全局生效。
										{/if}
									</Tooltip.Content>
								</Tooltip.Portal>
							</Tooltip.Root>
						</Tooltip.Provider>
					</Card.Title>
				</Card.Header>
				<Card.Content>
					<div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
						<!-- Left column -->
						<div class="space-y-4">
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>显示已停止容器</Label>
									<TogglePill
										checked={showStoppedContainers}
										onchange={() => {
											appSettings.setShowStoppedContainers(!showStoppedContainers);
											toast.success(showStoppedContainers ? '已显示停止的容器' : '已隐藏停止的容器');
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">在列表中显示已停止和已退出的容器</p>
							</div>
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>高亮显示可用更新</Label>
									<TogglePill
										checked={highlightUpdates}
										onchange={() => {
											appSettings.setHighlightUpdates(!highlightUpdates);
											toast.success(highlightUpdates ? '已开启更新高亮' : '已关闭更新高亮');
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">有可用更新时，用琥珀色高亮容器行</p>
							</div>
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>紧凑端口显示</Label>
									<TogglePill
										checked={compactPorts}
										onchange={() => {
											appSettings.setCompactPorts(!compactPorts);
											toast.success(compactPorts ? '已开启紧凑端口显示' : '已显示全部端口');
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">只显示第一个端口+数量，而非全部端口</p>
							</div>
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>时间格式</Label>
									<ToggleSwitch
										value={timeFormat}
										leftValue="24h"
										rightValue="12h"
										onchange={(newFormat) => {
											appSettings.setTimeFormat(newFormat as '12h' | '24h');
											toast.success(`时间格式已设为${newFormat === '12h' ? '12小时制(AM/PM)' : '24小时制'}`);
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">使用 12 小时制或 24小时制显示时间戳</p>
							</div>
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>日期格式</Label>
									<Select.Root
										type="single"
										value={dateFormat}
										onValueChange={(value) => {
											if (value) {
												appSettings.setDateFormat(value as DateFormat);
												toast.success(`日期格式已设置为 ${value}`);
											}
										}}
										disabled={!$canAccess('settings', 'edit')}
									>
										<Select.Trigger class="w-[180px]">
											<Calendar class="w-4 h-4 mr-2" />
											<span>{dateFormat}</span>
										</Select.Trigger>
										<Select.Content>
											{#each dateFormatOptions as option}
												<Select.Item value={option.value}>
													<div class="flex items-center justify-between w-full gap-4">
														<span>{option.label}</span>
														<span class="text-xs text-muted-foreground">{option.example}</span>
													</div>
												</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</div>
								<p class="text-xs text-muted-foreground">应用内全局日期显示方式</p>
							</div>
						</div>
						<!-- Right column: Theme settings (always shown, with hint when auth enabled) -->
						<div class="space-y-4">
							<ThemeSelector />
							{#if $authStore.authEnabled}
								<div class="text-xs text-muted-foreground flex items-start gap-1.5 mt-2 p-2 bg-muted/50 rounded-md">
									<HelpCircle class="w-3.5 h-3.5 shrink-0 mt-0.5" />
									<div>
										<p>个人主题偏好可在<a href="/profile" class="text-primary hover:underline">个人资料</a>中配置。</p>
									</div>
								</div>
							{/if}
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title class="text-sm font-medium flex items-center gap-2">
						<Globe class="w-4 h-4" />
						计划任务
					</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="space-y-2">
						<Label>默认时区</Label>
						<TimezoneSelector
							value={defaultTimezone}
							onchange={(value) => {
								appSettings.setDefaultTimezone(value);
								toast.success(`默认时区已设为 ${value}`);
							}}
							class="w-[320px]"
						/>
						<p class="text-xs text-muted-foreground">新建环境的默认时区，用于自动更新等计划任务。</p>
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title class="text-sm font-medium flex items-center gap-2">
						<Bell class="w-4 h-4" />
						操作确认
					</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="space-y-1">
						<div class="flex items-center gap-3">
							<Label>确认危险操作</Label>
							<TogglePill
								checked={confirmDestructive}
								onchange={() => {
									appSettings.setConfirmDestructive(!confirmDestructive);
									toast.success(confirmDestructive ? '已开启操作确认' : '已关闭操作确认');
								}}
								disabled={!$canAccess('settings', 'edit')}
							/>
						</div>
						<p class="text-xs text-muted-foreground">删除资源前显示确认对话框</p>
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title class="text-sm font-medium flex items-center gap-2">
						<FileText class="w-4 h-4" />
						日志与文件
					</Card.Title>
				</Card.Header>
				<Card.Content>
					<div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
						<div class="space-y-4">
							<div class="space-y-2">
								<Label for="log-buffer-size">日志缓冲区大小 (KB)</Label>
								<div class="flex items-center gap-2">
									<Input
										id="log-buffer-size"
										type="number"
										min="100"
										max="5000"
										value={logBufferSizeKb}
										onchange={handleLogBufferSizeChange}
										disabled={!$canAccess('settings', 'edit')}
										class="w-24"
									/>
									<span class="text-sm text-muted-foreground">KB</span>
								</div>
								<p class="text-xs text-muted-foreground">每个容器面板的最大日志缓冲区，超出后旧日志会被截断。</p>
								{#if logBufferSizeKb > 1000}
									<div class="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/20">
										<AlertTriangle class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
										<p class="text-xs text-amber-600 dark:text-amber-400">值过高可能降低浏览器性能，推荐：250-1000 KB。</p>
									</div>
								{/if}
							</div>
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>下载格式</Label>
									<ToggleSwitch
										value={downloadFormat}
										leftValue="tar"
										rightValue="tar.gz"
										onchange={(newFormat) => {
											appSettings.setDownloadFormat(newFormat as DownloadFormat);
											toast.success(`下载格式已设为 ${newFormat}`);
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">从容器下载文件时的归档格式</p>
							</div>
						</div>
						<div class="space-y-4">
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>格式化日志时间戳</Label>
									<TogglePill
										checked={formatLogTimestamps}
										onchange={() => {
											appSettings.setFormatLogTimestamps(!formatLogTimestamps);
											toast.success(formatLogTimestamps ? '已开启日志时间戳格式化' : '已关闭日志时间戳格式化');
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">将日志中的 ISO 时间戳转换为你配置的日期时间格式</p>
								<div class="flex items-start gap-1.5 mt-1">
									<Info class="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
									<p class="text-xs text-muted-foreground">Docker 日志默认使用 UTC 时间，启用后时间戳会转换为本地时间。</p>
								</div>
							</div>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

		</div>

		<!-- Right column -->
		<div class="space-y-4">
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-sm font-medium flex items-center gap-2">
						<ShieldCheck class="w-4 h-4" />
						漏洞扫描器
					</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="space-y-2">
						<Label for="grype-image">Grype 镜像</Label>
						<Input
							id="grype-image"
							value={defaultGrypeImage}
							onblur={handleGrypeImageBlur}
							disabled={!$canAccess('settings', 'edit')}
							placeholder={"anchore/grype:v0.110.0"}
						/>
						<p class="text-xs text-muted-foreground">Grype 扫描器使用的 Docker 镜像，建议固定版本以保证供应链安全。</p>
					</div>
					<div class="space-y-2">
						<Label for="trivy-image">Trivy 镜像</Label>
						<Input
							id="trivy-image"
							value={defaultTrivyImage}
							onblur={handleTrivyImageBlur}
							disabled={!$canAccess('settings', 'edit')}
							placeholder={"aquasec/trivy:0.69.3"}
						/>
						<p class="text-xs text-muted-foreground">Trivy 扫描器使用的 Docker 镜像，建议固定版本以保证供应链安全。</p>
					</div>
					<div class="space-y-2">
						<Label for="grype-args">Grype 默认参数</Label>
						<Input
							id="grype-args"
							value={defaultGrypeArgs}
							onblur={handleGrypeArgsBlur}
							disabled={!$canAccess('settings', 'edit')}
							placeholder={"-o json -v {image}"}
						/>
						<p class="text-xs text-muted-foreground">使用 <code class="bg-muted px-1 rounded">{'{image}'}</code> 作为镜像名称占位符</p>
					</div>
					<div class="space-y-2">
						<Label for="trivy-args">Trivy 默认参数</Label>
						<Input
							id="trivy-args"
							value={defaultTrivyArgs}
							onblur={handleTrivyArgsBlur}
							disabled={!$canAccess('settings', 'edit')}
							placeholder={"image --format json {image}"}
						/>
						<p class="text-xs text-muted-foreground">使用 <code class="bg-muted px-1 rounded">{'{image}'}</code> 作为镜像名称占位符</p>
					</div>
					<div class="pt-2 border-t">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium">Scanner cache</p>
								<p class="text-xs text-muted-foreground">Remove cached vulnerability databases to free disk space. Next scan will re-download fresh data (~200MB).</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								disabled={clearingCache || !$canAccess('settings', 'edit')}
								onclick={clearScannerCache}
							>
								{#if clearingCache}
									Clearing...
								{:else}
									Clear cache
								{/if}
							</Button>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title class="text-sm font-medium flex items-center gap-2">
						<Database class="w-4 h-4" />
						系统任务
					</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="space-y-3">
						<div>
							<div class="flex items-center gap-2">
								<Label>活动事件采集模式</Label>
								<Tooltip.Root>
									<Tooltip.Trigger>
										<HelpCircle class="w-3.5 h-3.5 text-muted-foreground" />
									</Tooltip.Trigger>
									<Tooltip.Content class="w-80">
										<p class="text-xs">
											<strong>流式：</strong> Docker 持续事件流，实时通知，CPU 占用较高<br />
											<strong>轮询：</strong> 定期检查新事件，通知略有延迟，CPU 占用较低
										</p>
									</Tooltip.Content>
								</Tooltip.Root>
							</div>
							<div class="flex items-center gap-4 mt-2">
								<label class="flex items-center gap-2 cursor-pointer">
									<input
										type="radio"
										name="eventCollectionMode"
										value="stream"
										checked={(eventCollectionMode || 'stream') === 'stream'}
										onchange={() => handleEventCollectionModeChange('stream')}
										disabled={!$canAccess('settings', 'edit')}
										class="accent-primary w-4 h-4"
									/>
									<Activity class="w-3.5 h-3.5" />
									<span class="text-sm">流式</span>
								</label>
								<label class="flex items-center gap-2 cursor-pointer">
									<input
										type="radio"
										name="eventCollectionMode"
										value="poll"
										checked={(eventCollectionMode || 'stream') === 'poll'}
										onchange={() => handleEventCollectionModeChange('poll')}
										disabled={!$canAccess('settings', 'edit')}
										class="accent-primary w-4 h-4"
									/>
									<Clock class="w-3.5 h-3.5" />
									<span class="text-sm">轮询</span>
								</label>

								<span class="text-xs text-muted-foreground {(eventCollectionMode || 'stream') === 'poll' ? '' : 'invisible'}">每</span>
								<Select.Root
									type="single"
									value={String(eventPollInterval || 60000)}
									onValueChange={(v) => v && handleEventPollIntervalChange({ value: parseInt(v) })}
									disabled={!$canAccess('settings', 'edit') || (eventCollectionMode || 'stream') !== 'poll'}
								>
									<Select.Trigger class="w-24 h-8 {(eventCollectionMode || 'stream') === 'poll' ? '' : 'invisible'}">
										{(eventPollInterval || 60000) === 30000 ? '30s' : (eventPollInterval || 60000) === 60000 ? '60s' : (eventPollInterval || 60000) === 120000 ? '120s' : '300s'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="30000">30s</Select.Item>
										<Select.Item value="60000">60s</Select.Item>
										<Select.Item value="120000">120s</Select.Item>
										<Select.Item value="300000">300s</Select.Item>
									</Select.Content>
								</Select.Root>
							</div>
						</div>
					</div>

					<div class="space-y-1 pt-2 border-t">
						<div class="flex items-center gap-2">
							<Label for="metrics-interval">指标采集间隔</Label>
							<Tooltip.Root>
								<Tooltip.Trigger>
									<HelpCircle class="w-3.5 h-3.5 text-muted-foreground" />
								</Tooltip.Trigger>
								<Tooltip.Content class="w-80">
									<p class="text-xs">
										采集运行中容器 CPU/内存指标的频率，间隔越小更新越频繁，但 CPU 占用越高
									</p>
								</Tooltip.Content>
							</Tooltip.Root>
						</div>
						<div class="flex items-center gap-2 mt-2">
							<Select.Root
								type="single"
								value={String(metricsCollectionInterval || 30000)}
								onValueChange={(v) => v && handleMetricsIntervalChange({ value: parseInt(v) })}
								disabled={!$canAccess('settings', 'edit')}
							>
								<Select.Trigger class="w-24 h-8">
									{(metricsCollectionInterval || 30000) === 10000 ? '10s' : (metricsCollectionInterval || 30000) === 30000 ? '30s' : (metricsCollectionInterval || 30000) === 60000 ? '60s' : '120s'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="10000">10s</Select.Item>
									<Select.Item value="30000">30s</Select.Item>
									<Select.Item value="60000">60s</Select.Item>
									<Select.Item value="120000">120s</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
					</div>

					<div class="space-y-1 pt-2 border-t">
						<div class="flex items-center gap-3">
							<Label for="schedule-retention">计划执行清理</Label>
							<TogglePill
								checked={scheduleCleanupEnabled}
								onchange={handleScheduleCleanupEnabledChange}
								disabled={!$canAccess('settings', 'edit')}
							/>
						</div>
						<p class="text-xs text-muted-foreground">删除超过指定天数的执行记录</p>
						<div class="flex items-center gap-2 mt-2">
							<Input
								id="schedule-retention"
								type="number"
								min="1"
								max="365"
								value={scheduleRetentionDays}
								onchange={handleScheduleRetentionChange}
								disabled={!$canAccess('settings', 'edit') || !scheduleCleanupEnabled}
								class="w-20"
							/>
							<span class="text-sm text-muted-foreground">天</span>
							<div class="ml-auto">
								<CronEditor
									value={scheduleCleanupCron}
									onchange={handleScheduleCleanupCronChange}
									disabled={!$canAccess('settings', 'edit') || !scheduleCleanupEnabled}
								/>
							</div>
						</div>
					</div>
					<div class="space-y-1">
						<div class="flex items-center gap-3">
							<Label for="event-retention">容器事件清理</Label>
							<TogglePill
								checked={eventCleanupEnabled}
								onchange={handleEventCleanupEnabledChange}
								disabled={!$canAccess('settings', 'edit')}
							/>
						</div>
						<p class="text-xs text-muted-foreground">删除超过指定天数的事件记录</p>
						<div class="flex items-center gap-2 mt-2">
							<Input
								id="event-retention"
								type="number"
								min="1"
								max="365"
								value={eventRetentionDays}
								onchange={handleEventRetentionChange}
								disabled={!$canAccess('settings', 'edit') || !eventCleanupEnabled}
								class="w-20"
							/>
							<span class="text-sm text-muted-foreground">天</span>
							<div class="ml-auto">
								<CronEditor
									value={eventCleanupCron}
									onchange={handleEventCleanupCronChange}
									disabled={!$canAccess('settings', 'edit') || !eventCleanupEnabled}
								/>
							</div>
						</div>
					</div>
					<div class="space-y-1 pt-2 border-t">
						<div class="flex items-center gap-3">
							<Label>数据卷助手清理</Label>
							<Badge variant="secondary" class="text-xs">始终启用</Badge>
						</div>
						<p class="text-xs text-muted-foreground">
							自动删除用于浏览数据卷内容的临时容器，每 30 分钟执行一次，启动时也会执行
						</p>
					</div>
				</Card.Content>
			</Card.Root>
		</div>
	</div>
</div>
