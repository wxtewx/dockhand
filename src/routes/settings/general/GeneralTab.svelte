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
	import { Eye, Bell, Database, Calendar, ShieldCheck, FileText, AlertTriangle, HelpCircle, Globe, Activity, Clock, Info, Save, RotateCcw, LayoutDashboard, Tags, Archive, ChevronRight, ChevronDown } from 'lucide-svelte';
	import CodeEditor from '$lib/components/CodeEditor.svelte';
	import { appSettings, type DateFormat, type DownloadFormat, type EventCollectionMode, type LabelFilterMode } from '$lib/stores/settings';
	import { canAccess, authStore } from '$lib/stores/auth';
	import { toast } from 'svelte-sonner';
	import ThemeSelector from '$lib/components/ThemeSelector.svelte';
	import AnimateIconsToggle from '$lib/components/AnimateIconsToggle.svelte';
	import ColoredActionsToggle from '$lib/components/ColoredActionsToggle.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	// General settings state - these derive from the store
	let confirmDestructive = $derived($appSettings.confirmDestructive);
	let showStoppedContainers = $derived($appSettings.showStoppedContainers);
	let highlightUpdates = $derived($appSettings.highlightUpdates);
	let compactPorts = $derived($appSettings.compactPorts);
	let showExposedPorts = $derived($appSettings.showExposedPorts);
	let showGitCommitHash = $derived($appSettings.showGitCommitHash);
	let honorProxyLabels = $derived($appSettings.honorProxyLabels);
	let showImageChangelogLinks = $derived($appSettings.showImageChangelogLinks);
	let showWhatsNew = $derived($appSettings.showWhatsNew);
	let timeFormat = $derived($appSettings.timeFormat);
	let dateFormat = $derived($appSettings.dateFormat);
	let downloadFormat = $derived($appSettings.downloadFormat);
	let defaultGrypeArgs = $derived($appSettings.defaultGrypeArgs);
	let defaultTrivyArgs = $derived($appSettings.defaultTrivyArgs);
	let defaultGrypeImage = $derived($appSettings.defaultGrypeImage);
	let defaultTrivyImage = $derived($appSettings.defaultTrivyImage);
	let defaultScannerNetworkMode = $derived($appSettings.defaultScannerNetworkMode);
	let defaultScannerDns = $derived($appSettings.defaultScannerDns);
	let showAdvancedScannerSettings = $state(false);
	let defaultComposeTemplate = $derived($appSettings.defaultComposeTemplate);
	let labelFilterMode = $derived($appSettings.labelFilterMode);
	let composeTemplateWIP = $state('');
	let composeTemplateInitialized = false;

	$effect(() => {
		if (!composeTemplateInitialized && defaultComposeTemplate !== undefined) {
			composeTemplateWIP = defaultComposeTemplate;
			composeTemplateInitialized = true;
		}
	});

	const builtinComposeTemplate = `version: "3.8"

services:
  app:
    image: nginx:alpine
    ports:
      - "8080:80"
    environment:
      - APP_ENV=\${APP_ENV:-production}
    volumes:
      - ./html:/usr/share/nginx/html:ro
    restart: unless-stopped

# Add more services as needed
# networks:
#   default:
#     driver: bridge
`;

	function saveComposeTemplate() {
		appSettings.setDefaultComposeTemplate(composeTemplateWIP);
		toast.success('Compose 模板已更新');
	}

	function revertComposeTemplate() {
		composeTemplateWIP = builtinComposeTemplate;
		toast.info('模板已恢复为默认值');
	}
	let scheduleRetentionDays = $derived($appSettings.scheduleRetentionDays);
	let eventRetentionDays = $derived($appSettings.eventRetentionDays);
	let scheduleCleanupCron = $derived($appSettings.scheduleCleanupCron);
	let eventCleanupCron = $derived($appSettings.eventCleanupCron);
	let scheduleCleanupEnabled = $derived($appSettings.scheduleCleanupEnabled);
	let eventCleanupEnabled = $derived($appSettings.eventCleanupEnabled);
	let scannerCleanupCron = $derived($appSettings.scannerCleanupCron);
	let scannerCleanupEnabled = $derived($appSettings.scannerCleanupEnabled);
	let logMaxLines = $derived($appSettings.logMaxLines);
	let formatLogTimestamps = $derived($appSettings.formatLogTimestamps);
	let defaultTimezone = $derived($appSettings.defaultTimezone);
	let eventCollectionMode = $derived($appSettings.eventCollectionMode);
	let eventPollInterval = $derived($appSettings.eventPollInterval);
	let metricsCollectionInterval = $derived($appSettings.metricsCollectionInterval);
	let defaultBackupImage = $derived($appSettings.defaultBackupImage);

	let clearingCache = $state(false);

	async function clearScannerCache() {
		clearingCache = true;
		try {
			const res = await fetch('/api/settings/scanner/cache', { method: 'DELETE' });
			const data = await res.json();
			if (res.ok && data.success) {
				const total = (data.removedVolumes?.length || 0) + (data.removedDirs?.length || 0);
				if (total > 0) {
					toast.success(`扫描器缓存已清理 (已移除 ${total} 项)`);
				} else {
					toast.info('扫描器缓存早已为空');
				}
			} else {
				toast.error(data.error || '清理扫描器缓存失败');
			}
		} catch {
			toast.error('清理扫描器缓存失败');
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

	const downloadFormatOptions: { value: DownloadFormat; label: string; description: string }[] = [
		{ value: 'tar', label: 'tar', description: '未压缩归档包' },
		{ value: 'tar.gz', label: 'tar.gz', description: 'Gzip 压缩归档包' },
		{ value: 'raw', label: '不打包', description: '单个原始二进制文件' }
	];

	const downloadFormatLabel: Record<DownloadFormat, string> = {
		tar: 'tar',
		'tar.gz': 'tar.gz',
		raw: '不打包'
	};

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

	function handleScannerCleanupCronChange(cron: string) {
		appSettings.setScannerCleanupCron(cron);
		toast.success('扫描器清理定时任务已更新');
	}

	function handleScannerCleanupEnabledChange() {
		const newState = !scannerCleanupEnabled;
		appSettings.setScannerCleanupEnabled(newState);
		toast.success(newState ? '扫描器清理已启用' : '扫描器清理已禁用');
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

	function handleScannerNetworkModeChange(value: string) {
		const trimmed = (value ?? '').trim();
		if (trimmed !== defaultScannerNetworkMode) {
			appSettings.setDefaultScannerNetworkMode(trimmed);
			toast.success(trimmed ? `扫描器网络模式已设置为 ${trimmed}` : '已清空扫描器网络模式');
		}
	}

	function handleScannerDnsBlur(e: Event) {
		const raw = (e.target as HTMLInputElement).value.trim();
		const cleaned = raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const sameAsCurrent =
			cleaned.length === defaultScannerDns.length &&
			cleaned.every((v, i) => v === defaultScannerDns[i]);
		if (!sameAsCurrent) {
			appSettings.setDefaultScannerDns(cleaned);
			toast.success(cleaned.length ? `扫描器 DNS 已设置为 ${cleaned.join(', ')}` : '已清空扫描器 DNS');
		}
	}

	// Anything above 2K starts feeling laggy in browsers without virtualized rendering.
	const logMaxLinesOptions = [
		{ value: '500', label: '500 行' },
		{ value: '1000', label: '1,000 行' },
		{ value: '2000', label: '2,000 行' }
	];

	function handleLogMaxLinesChange(value: string | undefined) {
		const n = parseInt(value ?? '');
		if (!Number.isFinite(n) || n <= 0) return;
		appSettings.setLogMaxLines(Math.min(2000, Math.max(100, n)));
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

	function handleBackupImageBlur(e: Event) {
		const value = (e.target as HTMLInputElement).value.trim();
		if (value && value !== defaultBackupImage) {
			appSettings.setDefaultBackupImage(value);
			toast.success('备份镜像已更新');
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
									<Label>显示更新日志链接</Label>
									<Tooltip.Root>
										<Tooltip.Trigger>
											<HelpCircle class="w-3.5 h-3.5 text-muted-foreground" />
										</Tooltip.Trigger>
										<Tooltip.Content side="top" class="w-96 max-w-[90vw]">
											<p>在有可用更新的镜像行右侧展示版本更新说明链接。该链接会优先读取镜像标签 <code>org.opencontainers.image.source</code>、ghcr.io 仓库地址，或自定义覆盖标签 <code>dockhand.changelog.url</code> 进行解析。</p>
										</Tooltip.Content>
									</Tooltip.Root>
									<TogglePill
										checked={showImageChangelogLinks}
										onchange={(checked) => {
											appSettings.setShowImageChangelogLinks(checked);
											toast.success(checked ? '已显示更新日志链接' : '已隐藏更新日志链接');
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">在存在可用更新的镜像旁显示版本说明图标</p>
							</div>
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>显示 "更新公告"</Label>
									<TogglePill
										checked={showWhatsNew}
										onchange={(checked) => {
											appSettings.setShowWhatsNew(checked);
											toast.success(checked ? "已启用更新公告弹窗" : "已关闭更新公告弹窗");
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">升级新版本后展示 "更新公告" 弹窗</p>
							</div>
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>精简端口展示</Label>
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
									<Label>显示暴露端口</Label>
									<Tooltip.Root>
										<Tooltip.Trigger>
											<HelpCircle class="w-3.5 h-3.5 text-muted-foreground" />
										</Tooltip.Trigger>
										<Tooltip.Content side="top" class="w-96 max-w-[90vw]">
											<p>展示容器内通过 EXPOSE 声明、未映射至主机的内部端口。这类端口会在容器列表中以琥珀色角标显示，以此区分已发布的端口映射。</p>
										</Tooltip.Content>
									</Tooltip.Root>
									<TogglePill
										checked={showExposedPorts}
										onchange={(checked) => {
											appSettings.setShowExposedPorts(checked);
											toast.success(checked ? '已在容器列表中显示暴露端口' : '已在容器列表中隐藏暴露端口');
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">在容器列表网格中显示内部容器端口</p>
							</div>
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>显示 Git 提交哈希</Label>
									<Tooltip.Root>
										<Tooltip.Trigger>
											<HelpCircle class="w-3.5 h-3.5 text-muted-foreground" />
										</Tooltip.Trigger>
										<Tooltip.Content side="top" class="w-96 max-w-[90vw]">
											<p>在堆栈列表源代码列的 Git 标识上展示已部署简短提交哈希，悬浮提示内显示完整哈希、仓库地址与分支名称。</p>
										</Tooltip.Content>
									</Tooltip.Root>
									<TogglePill
										checked={showGitCommitHash}
										onchange={(checked) => {
											appSettings.setShowGitCommitHash(checked);
											toast.success(checked ? '已在堆栈标识显示 Git 提交哈希' : 'Git 提交哈希已隐藏');
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">在堆栈列表的 Git 来源标识上展示已部署提交哈希</p>
							</div>
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>识别 Traefik/Pangolin 标签</Label>
									<Tooltip.Root>
										<Tooltip.Trigger>
											<HelpCircle class="w-3.5 h-3.5 text-muted-foreground" />
										</Tooltip.Trigger>
										<Tooltip.Content side="top" class="w-96 max-w-[90vw]">
											<p>解析标签 <code>traefik.http.routers.&lt;name&gt;.rule</code>、<code>pangolin.public-resources.&lt;name&gt;.full-domain</code> 与 <code>pangolin.private-resources.&lt;name&gt;.full-domain</code>，并将解析出的网址以可点击角标展示在端口旁。关闭此项后，仅会展示手动配置的 <code>dockhand.url</code> 标签地址。</p>
										</Tooltip.Content>
									</Tooltip.Root>
									<TogglePill
										checked={honorProxyLabels}
										onchange={(checked) => {
											appSettings.setHonorProxyLabels(checked);
											toast.success(checked ? '已启用代理标签解析' : '已忽略代理标签');
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">同时展示从 Traefik、Pangolin 标签自动识别的网址与 dockhand.url 配置地址</p>
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
											toast.success(`时间格式已设为${newFormat === '12h' ? '12 小时制(AM/PM)' : '24 小时制'}`);
										}}
										disabled={!$canAccess('settings', 'edit')}
									/>
								</div>
								<p class="text-xs text-muted-foreground">使用 12 小时制或 24 小时制显示时间戳</p>
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
							<ColoredActionsToggle />
							<AnimateIconsToggle />
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
								<Label for="log-max-lines">日志缓冲区大小</Label>
								<Select.Root
									type="single"
									value={String(logMaxLines)}
									onValueChange={handleLogMaxLinesChange}
									disabled={!$canAccess('settings', 'edit')}
								>
									<Select.Trigger id="log-max-lines" class="w-48">
										{logMaxLines.toLocaleString()} 行
									</Select.Trigger>
									<Select.Content>
										{#each logMaxLinesOptions as opt}
											<Select.Item value={opt.value}>{opt.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
								<p class="text-xs text-muted-foreground">每个容器面板保留的最大日志行数。超出限制时会丢弃较早的日志行。</p>
							</div>
							<div class="space-y-1">
								<div class="flex items-center gap-3">
									<Label>下载格式</Label>
									<Select.Root
										type="single"
										value={downloadFormat}
										onValueChange={(value) => {
											if (value) {
												appSettings.setDownloadFormat(value as DownloadFormat);
												toast.success(`下载格式已设置为 ${downloadFormatLabel[value as DownloadFormat]}`);
											}
										}}
										disabled={!$canAccess('settings', 'edit')}
									>
										<Select.Trigger class="w-[180px]">
											<FileText class="w-4 h-4 mr-2" />
											<span>{downloadFormatLabel[downloadFormat]}</span>
										</Select.Trigger>
										<Select.Content>
											{#each downloadFormatOptions as option}
												<Select.Item value={option.value}>
													<div class="flex items-center justify-between w-full gap-4">
														<span>{option.label}</span>
														<span class="text-xs text-muted-foreground">{option.description}</span>
													</div>
												</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</div>
								<p class="text-xs text-muted-foreground">从容器或数据卷下载文件时使用的格式。 "不打包" 仅对单个文件输出原始字节；目录仍会以tar包形式下载。</p>
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

			<Card.Root>
				<Card.Header>
					<Card.Title class="text-sm font-medium flex items-center gap-2">
						<FileText class="w-4 h-4" />
						Compose 模板
					</Card.Title>
					<p class="text-xs text-muted-foreground">创建新堆栈时的默认 YAML 内容。</p>
				</Card.Header>
				<Card.Content class="space-y-3">
					<div class="h-64">
						<CodeEditor
							value={composeTemplateWIP}
							onchange={(v) => { composeTemplateWIP = v; }}
							language="yaml"
							readonly={!$canAccess('settings', 'edit')}
							class="h-full rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700"
						/>
					</div>
					{#if $canAccess('settings', 'edit')}
						<div class="flex gap-2">
							<Button size="sm" variant="outline" onclick={saveComposeTemplate}>
								<Save class="w-3.5 h-3.5" />
								保存模板
							</Button>
							<Button size="sm" variant="ghost" onclick={revertComposeTemplate}>
								<RotateCcw class="w-3.5 h-3.5" />
								恢复为默认值
							</Button>
						</div>
					{/if}
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
					<div class="pt-2">
						<button
							type="button"
							class="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 select-none"
							onclick={() => (showAdvancedScannerSettings = !showAdvancedScannerSettings)}
						>
							{#if showAdvancedScannerSettings}
								<ChevronDown class="w-3.5 h-3.5" />
							{:else}
								<ChevronRight class="w-3.5 h-3.5" />
							{/if}
							高级设置
						</button>
					</div>
					{#if showAdvancedScannerSettings}
						<div class="space-y-2">
							<Label for="scanner-network-mode">网络模式</Label>
							<Select.Root
								type="single"
								value={defaultScannerNetworkMode}
								onValueChange={handleScannerNetworkModeChange}
							>
								<Select.Trigger id="scanner-network-mode" class="w-full" disabled={!$canAccess('settings', 'edit')}>
									<span>{defaultScannerNetworkMode || '默认 (自动检测)'}</span>
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="">默认 (自动检测)</Select.Item>
									<Select.Item value="host">host</Select.Item>
									<Select.Item value="bridge">bridge</Select.Item>
									<Select.Item value="none">none</Select.Item>
								</Select.Content>
							</Select.Root>
							<p class="text-xs text-muted-foreground">为漏洞扫描容器自定义 Docker 网络模式。当默认 bridge 网络无法访问网络时请使用 <code class="bg-muted px-1 rounded">host</code> (例如：iptables 未启用、SELinux 限制场景)。</p>
						</div>
						<div class="space-y-2">
							<Label for="scanner-dns">DNS 服务器</Label>
							<Input
								id="scanner-dns"
								value={defaultScannerDns.join(', ')}
								onblur={handleScannerDnsBlur}
								disabled={!$canAccess('settings', 'edit')}
							/>
							<p class="text-xs text-muted-foreground">供扫描容器使用的 DNS IP，多个地址使用逗号分隔。留空则继承 Docker 守护进程配置。</p>
						</div>
					{/if}
					<div class="pt-2 border-t">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium">扫描器缓存</p>
								<p class="text-xs text-muted-foreground">移除缓存的漏洞数据库以释放磁盘空间。下次扫描将重新下载最新数据 (约 200MB)。</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								disabled={clearingCache || !$canAccess('settings', 'edit')}
								onclick={clearScannerCache}
							>
								{#if clearingCache}
									正在清理...
								{:else}
									清理缓存
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
										{(eventPollInterval || 60000) === 30000 ? '30 秒' : (eventPollInterval || 60000) === 60000 ? '60 秒' : (eventPollInterval || 60000) === 120000 ? '120 秒' : '300 秒'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="30000">30 秒</Select.Item>
										<Select.Item value="60000">60 秒</Select.Item>
										<Select.Item value="120000">120 秒</Select.Item>
										<Select.Item value="300000">300 秒</Select.Item>
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
									{(metricsCollectionInterval || 30000) === 10000 ? '10 秒' : (metricsCollectionInterval || 30000) === 30000 ? '30 秒' : (metricsCollectionInterval || 30000) === 60000 ? '60 秒' : '120 秒'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="10000">10 秒</Select.Item>
									<Select.Item value="30000">30 秒</Select.Item>
									<Select.Item value="60000">60 秒</Select.Item>
									<Select.Item value="120000">120 秒</Select.Item>
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
					<div class="space-y-1 pt-2 border-t">
						<div class="flex items-center gap-3">
							<Label>扫描器缓存清理</Label>
							<TogglePill
								checked={scannerCleanupEnabled}
								onchange={handleScannerCleanupEnabledChange}
								disabled={!$canAccess('settings', 'edit')}
							/>
						</div>
						<p class="text-xs text-muted-foreground">清除缓存的漏洞数据库以释放磁盘空间</p>
						{#if scannerCleanupEnabled}
							<div class="mt-2">
								<CronEditor
									value={scannerCleanupCron}
									onchange={handleScannerCleanupCronChange}
									disabled={!$canAccess('settings', 'edit')}
								/>
							</div>
						{/if}
					</div>
					<div class="space-y-1 pt-2 border-t">
						<div class="flex items-center gap-3">
							<Label>保护扫描器镜像不被清理</Label>
							<Tooltip.Root>
								<Tooltip.Trigger>
									<HelpCircle class="w-3.5 h-3.5 text-muted-foreground" />
								</Tooltip.Trigger>
								<Tooltip.Content side="top" class="w-96 max-w-[90vw]">
									<p>开启后，执行「清理所有未使用资源」操作时会跳过 Dockhand 内置的 grype 与 trivy 扫描镜像，避免下次扫描重新拉取镜像并下载约 100MB 漏洞库。关闭后，清理逻辑与原生 Docker 一致，扫描镜像可能会被一并删除。</p>
								</Tooltip.Content>
							</Tooltip.Root>
							<TogglePill
								checked={$appSettings.protectScannerImages}
								onchange={(checked) => {
									appSettings.setProtectScannerImages(checked);
									toast.success(checked ? '清理操作将跳过扫描器镜像' : '扫描器镜像会随其他资源一同清理');
								}}
								disabled={!$canAccess('settings', 'edit')}
							/>
						</div>
						<p class="text-xs text-muted-foreground">执行「清理所有未使用资源」时保留 grype、trivy 扫描镜像</p>
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<Card.Title class="text-sm font-medium flex items-center gap-2">
						<LayoutDashboard class="w-4 h-4" />
						仪表板
					</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="space-y-3">
						<div class="space-y-1">
							<div class="flex items-center gap-3">
								<Label>标签过滤匹配方式</Label>
								<Tooltip.Root>
									<Tooltip.Trigger>
										<HelpCircle class="w-3.5 h-3.5 text-muted-foreground" />
									</Tooltip.Trigger>
									<Tooltip.Content class="w-80">
										<p class="text-xs">
											控制多个选中的标签如何在仪表板上过滤环境。
											<strong>"任意"</strong>：显示包含至少一个选中标签的环境。
											<strong>"全部"</strong>：仅显示包含所有选中标签的环境。
										</p>
									</Tooltip.Content>
								</Tooltip.Root>
								<ToggleSwitch
									value={labelFilterMode}
									leftValue="any"
									rightValue="all"
									leftLabel="任意"
                        			rightLabel="全部"
									onchange={(mode) => appSettings.setLabelFilterMode(mode as LabelFilterMode)}
									disabled={!$canAccess('settings', 'edit')}
								/>
							</div>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		</div>
	</div>
</div>
