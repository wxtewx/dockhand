<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Loader2, Box, Info, Layers, Cpu, MemoryStick, HardDrive, Network, Shield, Settings2, Code, Copy, Check, XCircle, Activity, Wifi, Pencil, RefreshCw, X, FolderOpen, Moon, Tags, ExternalLink, Gpu } from 'lucide-svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { currentEnvironment, appendEnvParam, environments } from '$lib/stores/environment';
	import ImageLayersView from '../images/ImageLayersView.svelte';
	import LogsPanel from '../logs/LogsPanel.svelte';
	import FileBrowserPanel from './FileBrowserPanel.svelte';
	import { formatDateTime } from '$lib/stores/settings';
	import { formatHostPortUrl } from '$lib/utils/url';
	import { getLabelText } from '$lib/types';

	interface Props {
		open: boolean;
		containerId: string;
		containerName?: string;
		onRename?: (newName: string) => void;
	}

	let { open = $bindable(), containerId, containerName, onRename }: Props = $props();

	// Rename state
	let isEditing = $state(false);
	let editName = $state('');
	let renaming = $state(false);
	let displayName = $state('');

	let loading = $state(true);
	let error = $state('');
	let containerData = $state<any>(null);

	// Active tab state for layers visibility
	let activeTab = $state('overview');

	// Logs panel state
	let showLogs = $state(false);

	// Raw JSON modal state
	let showRawJson = $state(false);
	let jsonCopied = $state<'ok' | 'error' | null>(null);

	// Label copy state
	let copiedLabel = $state<string | null>(null);
	let copyLabelFailed = $state(false);

	async function copyLabel(key: string, value: string) {
		const ok = await copyToClipboard(`${key}=${value}`);
		if (ok) {
			copiedLabel = key;
			setTimeout(() => copiedLabel = null, 2000);
		} else {
			copyLabelFailed = true;
			setTimeout(() => copyLabelFailed = false, 2000);
		}
	}

	// Processes state
	interface ProcessesData {
		Titles: string[];
		Processes: string[][];
	}
	let processesData = $state<ProcessesData | null>(null);
	let processesLoading = $state(false);
	let processesError = $state('');
	let processesInterval: ReturnType<typeof setInterval> | null = null;
	let processesAutoRefresh = $state(true);

	// Stats state
	interface ContainerStat {
		cpuPercent: number;
		memoryUsage: number;
		memoryLimit: number;
		memoryPercent: number;
		networkRx: number;
		networkTx: number;
		blockRead: number;
		blockWrite: number;
		timestamp: number;
	}
	let currentStats = $state<ContainerStat | null>(null);
	let cpuHistory = $state<number[]>([]);
	let memoryHistory = $state<number[]>([]);
	let statsInterval: ReturnType<typeof setInterval> | null = null;
	const MAX_HISTORY = 30;
	let lastStatsUpdate = $state<number>(0);
	let isLiveConnected = $state(false);

	let editInputRef: HTMLInputElement | null = null;

	// Current environment details for port URL generation
	const currentEnvDetails = $derived($environments.find(e => e.id === $currentEnvironment?.id) ?? null);

	function extractHostFromUrl(urlString: string): string | null {
		if (!urlString) return null;
		// Handle tcp:// URLs (Docker remote)
		const tcpMatch = urlString.match(/^tcp:\/\/([^:\/]+)/);
		if (tcpMatch) return tcpMatch[1];
		// Handle http:// or https:// URLs
		const httpMatch = urlString.match(/^https?:\/\/([^:\/]+)/);
		if (httpMatch) return httpMatch[1];
		// Handle host:port format
		const hostPortMatch = urlString.match(/^([^:\/]+):\d+/);
		if (hostPortMatch) return hostPortMatch[1];
		// Just a hostname
		return urlString;
	}

	function getPortUrl(publicPort: number): string | null {
		const env = currentEnvDetails;
		if (!env) return null;
		// Priority 1: Use publicIp if configured
		if (env.publicIp) {
			return formatHostPortUrl(env.publicIp, publicPort);
		}
		// Priority 2: Extract from host for direct/hawser-standard
		const connectionType = env.connectionType || 'socket';
		if (connectionType === 'direct' && env.host) {
			const host = extractHostFromUrl(env.host);
			if (host) return formatHostPortUrl(host, publicPort);
		} else if (connectionType === 'hawser-standard' && env.host) {
			const host = extractHostFromUrl(env.host);
			if (host) return formatHostPortUrl(host, publicPort);
		}
		// No public IP available for socket or hawser-edge
		return null;
	}

	function startEditing() {
		editName = displayName;
		isEditing = true;
		// Focus after DOM updates
		setTimeout(() => {
			editInputRef?.focus();
			editInputRef?.select();
		}, 0);
	}

	function cancelEditing() {
		isEditing = false;
		editName = '';
	}

	async function saveRename() {
		if (!editName.trim() || editName === displayName) {
			cancelEditing();
			return;
		}
		renaming = true;
		try {
			const envId = $currentEnvironment?.id ?? null;
			const response = await fetch(appendEnvParam(`/api/containers/${containerId}/rename`, envId), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: editName.trim() })
			});
			if (response.ok) {
				displayName = editName.trim();
				isEditing = false;
				if (onRename) {
					onRename(editName.trim());
				}
			} else {
				const data = await response.json();
				console.error('重命名容器失败：', data.error);
			}
		} catch (error) {
			console.error('重命名容器失败：', error);
		} finally {
			renaming = false;
		}
	}

	// Track previous containerId to avoid re-fetching
	let lastFetchedId = $state('');

	// Fetch container data when modal opens
	$effect(() => {
		if (open && containerId && containerId !== lastFetchedId) {
			lastFetchedId = containerId;
			fetchContainerInspect();
		}
	});

	// Start/stop stats collection based on container state (separate effect)
	$effect(() => {
		if (open && containerData?.State?.Running) {
			startStatsCollection();
		} else {
			stopStatsCollection();
		}
	});

	// Initialize displayName when modal opens
	$effect(() => {
		if (open) {
			displayName = containerName || containerId.slice(0, 12);
		}
	});

	// Reset when modal closes
	$effect(() => {
		if (!open) {
			showLogs = false;
			activeTab = 'overview';
			stopStatsCollection();
			stopProcessesCollection();
			cpuHistory = [];
			memoryHistory = [];
			currentStats = null;
			processesData = null;
			containerData = null;
			loading = true;
			error = '';
			lastFetchedId = '';
			isLiveConnected = false;
			lastStatsUpdate = 0;
			displayName = '';
			isEditing = false;
			editName = '';
		}
	});

	async function fetchContainerInspect() {
		loading = true;
		error = '';
		try {
			const envId = $currentEnvironment?.id ?? null;
			const response = await fetch(appendEnvParam(`/api/containers/${containerId}/inspect`, envId));
			if (!response.ok) {
				throw new Error('获取容器详情失败');
			}
			containerData = await response.json();
		} catch (err: any) {
			error = err.message || '加载容器详情失败';
			console.error('获取容器详情失败：', err);
		} finally {
			loading = false;
		}
	}

	async function fetchStats() {
		if (!containerId || !containerData?.State?.Running) return;
		try {
			const envId = $currentEnvironment?.id ?? null;
			const response = await fetch(appendEnvParam(`/api/containers/${containerId}/stats`, envId));
			if (response.ok) {
				const stats = await response.json();
				if (!stats.error) {
					currentStats = stats;
					cpuHistory = [...cpuHistory.slice(-(MAX_HISTORY - 1)), stats.cpuPercent];
					memoryHistory = [...memoryHistory.slice(-(MAX_HISTORY - 1)), stats.memoryPercent];
					lastStatsUpdate = Date.now();
					isLiveConnected = true;
				} else {
					isLiveConnected = false;
				}
			} else {
				isLiveConnected = false;
			}
		} catch (err) {
			isLiveConnected = false;
		}
	}

	function startStatsCollection() {
		if (statsInterval) return;
		fetchStats();
		statsInterval = setInterval(fetchStats, 2000);
	}

	function stopStatsCollection() {
		if (statsInterval) {
			clearInterval(statsInterval);
			statsInterval = null;
		}
	}

	async function fetchProcesses() {
		if (!containerId || !containerData?.State?.Running) return;
		// Only show loading spinner on first fetch
		if (!processesData) {
			processesLoading = true;
		}
		processesError = '';
		try {
			const envId = $currentEnvironment?.id ?? null;
			const response = await fetch(appendEnvParam(`/api/containers/${containerId}/top`, envId));
			if (response.ok) {
				const data = await response.json();
				if (!data.error) {
					processesData = data;
				} else {
					processesError = data.error;
				}
			} else {
				processesError = '获取进程信息失败';
			}
		} catch (err: any) {
			processesError = err.message || '获取进程信息失败';
		} finally {
			processesLoading = false;
		}
	}

	function startProcessesCollection() {
		if (processesInterval) return;
		fetchProcesses();
		processesInterval = setInterval(fetchProcesses, 2000);
	}

	function stopProcessesCollection() {
		if (processesInterval) {
			clearInterval(processesInterval);
			processesInterval = null;
		}
	}

	function toggleProcessesAutoRefresh() {
		processesAutoRefresh = !processesAutoRefresh;
		if (processesAutoRefresh) {
			startProcessesCollection();
		} else {
			stopProcessesCollection();
		}
	}

	onDestroy(() => {
		stopStatsCollection();
		stopProcessesCollection();
	});

	function formatDate(dateString: string): string {
		if (!dateString) return 'N/A';
		return formatDateTime(dateString);
	}

	function formatBytes(bytes: number): string {
		if (!bytes || bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0)} ${sizes[i]}`;
	}

	function formatMemory(bytes: number): string {
		if (!bytes) return '无限制';
		const mb = bytes / (1024 * 1024);
		if (mb < 1024) return `${mb.toFixed(0)} MB`;
		return `${(mb / 1024).toFixed(2)} GB`;
	}

	function getStateColor(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		switch (state.toLowerCase()) {
			case 'running': return 'default';
			case 'paused': return 'secondary';
			case 'exited': return 'destructive';
			default: return 'outline';
		}
	}

	// Sparkline path generator
	function generateSparklinePath(data: number[], width: number, height: number): string {
		if (data.length < 2) return '';
		const max = Math.max(...data, 1);
		const min = 0;
		const range = max - min || 1;
		const stepX = width / (data.length - 1);
		const points = data.map((value, i) => {
			const x = i * stepX;
			const y = height - ((value - min) / range) * height;
			return `${x},${y}`;
		});
		return `M ${points.join(' L ')}`;
	}

	function generateAreaPath(data: number[], width: number, height: number): string {
		if (data.length < 2) return '';
		const max = Math.max(...data, 1);
		const min = 0;
		const range = max - min || 1;
		const stepX = width / (data.length - 1);
		const points = data.map((value, i) => {
			const x = i * stepX;
			const y = height - ((value - min) / range) * height;
			return `${x},${y}`;
		});
		return `M 0,${height} L ${points.join(' L ')} L ${width},${height} Z`;
	}

	async function copyJson() {
		if (containerData) {
			const ok = await copyToClipboard(JSON.stringify(containerData, null, 2));
			jsonCopied = ok ? 'ok' : 'error';
			setTimeout(() => jsonCopied = null, 2000);
		}
	}

	function syntaxHighlight(json: string): string {
		return json
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
				let cls = 'text-orange-500'; // number
				if (/^"/.test(match)) {
					if (/:$/.test(match)) {
						cls = 'text-blue-500'; // key
					} else {
						cls = 'text-green-500'; // string
					}
				} else if (/true|false/.test(match)) {
					cls = 'text-purple-500'; // boolean
				} else if (/null/.test(match)) {
					cls = 'text-red-500'; // null
				}
				return `<span class="${cls}">${match}</span>`;
			});
	}

	const formattedJson = $derived(
		containerData ? syntaxHighlight(JSON.stringify(containerData, null, 2)) : ''
	);

	const jsonLines = $derived(formattedJson.split('\n'));
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-6xl w-full h-[calc(100vh-2rem)] flex flex-col">
		<Dialog.Header class="shrink-0">
			<Dialog.Title class="flex items-center gap-2">
				<Box class="w-5 h-5" />
				容器详情：
				{#if isEditing}
					<input
						type="text"
						bind:value={editName}
						bind:this={editInputRef}
						class="text-muted-foreground font-normal bg-muted border border-input rounded px-2 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
						onkeydown={(e) => {
							if (e.key === 'Enter') saveRename();
							if (e.key === 'Escape') cancelEditing();
						}}
						disabled={renaming}
					/>
					<button
						type="button"
						onclick={saveRename}
						title="保存"
						disabled={renaming}
						class="p-1 rounded hover:bg-muted transition-colors"
					>
						{#if renaming}
							<RefreshCw class="w-3.5 h-3.5 text-muted-foreground animate-spin" />
						{:else}
							<Check class="w-3.5 h-3.5 text-green-500 hover:text-green-600" />
						{/if}
					</button>
					<button
						type="button"
						onclick={cancelEditing}
						title="Cancel"
						disabled={renaming}
						class="p-1 rounded hover:bg-muted transition-colors"
					>
						<X class="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
					</button>
				{:else}
					<span class="text-muted-foreground font-normal">{displayName || containerId.slice(0, 12)}</span>
					<button
						type="button"
						onclick={startEditing}
						title="重命名容器"
						class="p-0.5 rounded hover:bg-muted transition-colors ml-0.5"
					>
						<Pencil class="w-3 h-3 text-muted-foreground hover:text-foreground" />
					</button>
				{/if}
				{#if containerData?.State?.Running && !loading}
					<span class="inline-flex items-center gap-1.5 ml-2 text-xs {isLiveConnected ? 'text-emerald-500' : 'text-muted-foreground'}" title={isLiveConnected ? '正在接收实时更新' : '连接已断开'}>
						<Wifi class="w-3.5 h-3.5 {isLiveConnected ? 'animate-pulse' : ''}" />
						{isLiveConnected ? '实时' : '离线'}
					</span>
				{/if}
				{#if containerData && !loading}
					<Button
						variant="outline"
						size="sm"
						onclick={() => showRawJson = true}
						title="查看原始 JSON"
						class="ml-auto mr-6"
					>
						<Code class="w-4 h-4 mr-1.5" />
						JSON
					</Button>
				{/if}
			</Dialog.Title>
		</Dialog.Header>

		<div class="flex-1 flex flex-col min-h-[400px]">
			{#if loading}
				<div class="flex items-center justify-center py-8">
					<Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
				</div>
			{:else if error}
				<div class="text-sm text-red-600 dark:text-red-400 p-3 bg-red-50 dark:bg-red-950 rounded">
					{error}
				</div>
			{:else if containerData}
				<Tabs.Root bind:value={activeTab} class="w-full h-full flex flex-col">
					<Tabs.List class="w-full justify-start shrink-0 flex-wrap h-auto min-h-10 bg-muted rounded-lg">
						<Tabs.Trigger value="overview" onclick={() => showLogs = false}>概览</Tabs.Trigger>
						<Tabs.Trigger value="logs" onclick={() => showLogs = true}>日志</Tabs.Trigger>
						<Tabs.Trigger value="layers" onclick={() => showLogs = false}>镜像层</Tabs.Trigger>
						<Tabs.Trigger value="processes" onclick={() => { showLogs = false; if (processesAutoRefresh) startProcessesCollection(); else fetchProcesses(); }}>进程</Tabs.Trigger>
						<Tabs.Trigger value="network" onclick={() => showLogs = false}>网络</Tabs.Trigger>
						<Tabs.Trigger value="mounts" onclick={() => showLogs = false}>数据卷</Tabs.Trigger>
						<Tabs.Trigger value="files" onclick={() => showLogs = false}>文件</Tabs.Trigger>
						<Tabs.Trigger value="env" onclick={() => showLogs = false}>环境变量</Tabs.Trigger>
						<Tabs.Trigger value="labels" onclick={() => showLogs = false}>标签</Tabs.Trigger>
						<Tabs.Trigger value="security" onclick={() => showLogs = false}>安全</Tabs.Trigger>
						<Tabs.Trigger value="resources" onclick={() => showLogs = false}>资源</Tabs.Trigger>
						<Tabs.Trigger value="health" onclick={() => showLogs = false}>健康检查</Tabs.Trigger>
					</Tabs.List>

					<!-- Overview Tab -->
					<Tabs.Content value="overview" class="space-y-4 overflow-auto">
						<!-- Real-time Stats (only for running containers) -->
						{#if containerData.State?.Running}
							<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
								<!-- CPU -->
								<div class="p-3 border border-border rounded-lg">
									<div class="flex items-center gap-2 mb-2">
										<Cpu class="w-4 h-4 text-blue-500" />
										<span class="text-xs font-medium">CPU</span>
										<span class="ml-auto text-sm font-bold">{currentStats?.cpuPercent?.toFixed(1) ?? '—'}%</span>
									</div>
									{#if cpuHistory.length >= 2}
										<svg class="w-full h-8" viewBox="0 0 120 32" preserveAspectRatio="none">
											<path
												d={generateAreaPath(cpuHistory, 120, 32)}
												fill="rgba(59, 130, 246, 0.2)"
											/>
											<path
												d={generateSparklinePath(cpuHistory, 120, 32)}
												fill="none"
												stroke="rgb(59, 130, 246)"
												stroke-width="1.5"
											/>
										</svg>
									{:else}
										<div class="h-8 flex items-center justify-center text-xs text-muted-foreground">加载中...</div>
									{/if}
								</div>
								<!-- Memory -->
								<div class="p-3 border border-border rounded-lg">
									<div class="flex items-center gap-2 mb-2">
										<MemoryStick class="w-4 h-4 text-green-500" />
										<span class="text-xs font-medium">内存</span>
										<span class="ml-auto text-sm font-bold">{currentStats?.memoryPercent?.toFixed(1) ?? '—'}%</span>
									</div>
									{#if memoryHistory.length >= 2}
										<svg class="w-full h-8" viewBox="0 0 120 32" preserveAspectRatio="none">
											<path
												d={generateAreaPath(memoryHistory, 120, 32)}
												fill="rgba(34, 197, 94, 0.2)"
											/>
											<path
												d={generateSparklinePath(memoryHistory, 120, 32)}
												fill="none"
												stroke="rgb(34, 197, 94)"
												stroke-width="1.5"
											/>
										</svg>
									{:else}
										<div class="h-8 flex items-center justify-center text-xs text-muted-foreground">加载中...</div>
									{/if}
									<div class="text-2xs text-muted-foreground mt-1">
										{formatBytes(currentStats?.memoryUsage ?? 0)} / {formatBytes(currentStats?.memoryLimit ?? 0)}
									</div>
								</div>
								<!-- Network I/O -->
								<div class="p-3 border border-border rounded-lg">
									<div class="flex items-center gap-2 mb-2">
										<Network class="w-4 h-4 text-purple-500" />
										<span class="text-xs font-medium">网络 I/O</span>
									</div>
									<div class="space-y-1 text-xs">
										<div class="flex justify-between">
											<span class="text-muted-foreground">接收：</span>
											<span class="font-mono">{formatBytes(currentStats?.networkRx ?? 0)}</span>
										</div>
										<div class="flex justify-between">
											<span class="text-muted-foreground">发送：</span>
											<span class="font-mono">{formatBytes(currentStats?.networkTx ?? 0)}</span>
										</div>
									</div>
								</div>
								<!-- Block I/O -->
								<div class="p-3 border border-border rounded-lg">
									<div class="flex items-center gap-2 mb-2">
										<HardDrive class="w-4 h-4 text-orange-500" />
										<span class="text-xs font-medium">磁盘 I/O</span>
									</div>
									<div class="space-y-1 text-xs">
										<div class="flex justify-between">
											<span class="text-muted-foreground">读取：</span>
											<span class="font-mono">{formatBytes(currentStats?.blockRead ?? 0)}</span>
										</div>
										<div class="flex justify-between">
											<span class="text-muted-foreground">写入：</span>
											<span class="font-mono">{formatBytes(currentStats?.blockWrite ?? 0)}</span>
										</div>
									</div>
								</div>
							</div>
						{/if}

						<!-- Status & Basic Info combined -->
						<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
							<!-- Status -->
							<div class="space-y-3">
								<h3 class="text-sm font-semibold flex items-center gap-2">
									<Info class="w-4 h-4" />
									状态
								</h3>
								<div class="grid grid-cols-2 gap-2 text-sm">
									<div>
										<p class="text-muted-foreground text-xs">运行状态</p>
										<Badge variant={getStateColor(containerData.State?.Status || 'unknown')}>
											{getLabelText(containerData.State?.Status)}
										</Badge>
									</div>
									<div>
										<p class="text-muted-foreground text-xs">重启策略</p>
										<Badge variant="outline">{getLabelText(containerData.HostConfig?.RestartPolicy?.Name)}</Badge>
									</div>
									<div>
										<p class="text-muted-foreground text-xs">退出码</p>
										<code class="text-xs">{containerData.State?.ExitCode ?? 'N/A'}</code>
									</div>
									<div>
										<p class="text-muted-foreground text-xs">重启次数</p>
										<code class="text-xs">{containerData.RestartCount ?? 0}</code>
									</div>
								</div>
							</div>

							<!-- Basic Info -->
							<div class="space-y-3">
								<h3 class="text-sm font-semibold">基本信息</h3>
								<div class="grid grid-cols-2 gap-2 text-sm">
									<div>
										<p class="text-muted-foreground text-xs">ID</p>
										<code class="text-xs">{containerData.Id?.slice(0, 12)}</code>
									</div>
									<div>
										<p class="text-muted-foreground text-xs">平台</p>
										<p class="text-xs">{containerData.Platform || 'N/A'}</p>
									</div>
									<div>
										<p class="text-muted-foreground text-xs">创建时间</p>
										<p class="text-xs">{formatDate(containerData.Created)}</p>
									</div>
									<div>
										<p class="text-muted-foreground text-xs">启动时间</p>
										<p class="text-xs">{formatDate(containerData.State?.StartedAt)}</p>
									</div>
								</div>
							</div>
						</div>

						<!-- Image -->
						<div class="space-y-2">
							<h3 class="text-sm font-semibold">镜像</h3>
							<div class="flex items-center gap-2 p-2 bg-muted rounded">
								<code class="text-xs break-all flex-1">{containerData.Config?.Image || 'N/A'}</code>
							</div>
						</div>

						<!-- Command -->
						{#if containerData.Path || containerData.Args}
							<div class="space-y-2">
								<h3 class="text-sm font-semibold">命令</h3>
								<div class="p-2 bg-muted rounded">
									<code class="text-xs break-all">
										{containerData.Path || ''} {containerData.Args?.join(' ') || ''}
									</code>
								</div>
							</div>
						{/if}

					</Tabs.Content>

					<!-- Processes Tab -->
					<Tabs.Content value="processes" class="overflow-auto data-[state=inactive]:hidden">
						{#if !containerData.State?.Running}
							<div class="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
								<Moon class="w-5 h-5" />
								<span>容器未运行</span>
							</div>
						{:else if processesLoading}
							<div class="flex items-center justify-center py-8">
								<Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
							</div>
						{:else if processesError}
							<div class="text-sm text-red-600 dark:text-red-400 p-3 bg-red-50 dark:bg-red-950 rounded">
								{processesError}
							</div>
						{:else if processesData && processesData.Processes?.length > 0}
							<div class="border border-border rounded-lg overflow-auto max-h-[60vh]">
								<table class="w-full text-xs">
									<thead class="sticky top-0 bg-muted z-10">
										<tr class="border-b border-border">
											<th class="text-left p-2 font-medium text-muted-foreground">#</th>
											{#each processesData.Titles as title}
												<th class="text-left p-2 font-medium text-muted-foreground">{title}</th>
											{/each}
										</tr>
									</thead>
									<tbody>
										{#each processesData.Processes as process, i}
											<tr class="border-b border-border hover:bg-muted/50">
												<td class="p-2 text-muted-foreground">{i + 1}</td>
												{#each process as cell}
													<td class="p-2 font-mono">{cell}</td>
												{/each}
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
							<div class="text-xs text-muted-foreground pt-2">
								{processesData.Processes.length} 个进程
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">未找到进程</p>
						{/if}
					</Tabs.Content>

					<!-- Logs Tab -->
					<Tabs.Content value="logs" class="flex-1 min-h-0">
						<LogsPanel
							containerId={containerId}
							containerName={containerName || containerId.slice(0, 12)}
							visible={showLogs}
							envId={$currentEnvironment?.id ?? null}
							fillHeight={true}
							showCloseButton={false}
							onClose={() => showLogs = false}
						/>
					</Tabs.Content>

					<!-- Layers Tab -->
					<Tabs.Content value="layers" class="overflow-auto">
						{#if containerData?.Image}
							<ImageLayersView
								imageId={containerData.Image}
								imageName={containerData.Config?.Image || containerData.Image}
								visible={activeTab === 'layers'}
							/>
						{:else}
							<p class="text-sm text-muted-foreground py-8 text-center">暂无镜像信息</p>
						{/if}
					</Tabs.Content>

					<!-- Network Tab -->
					<Tabs.Content value="network" class="space-y-4 overflow-auto">
						<!-- Network Mode -->
						<div class="space-y-2">
							<h3 class="text-sm font-semibold">网络模式</h3>
							<Badge variant="outline">{containerData.HostConfig?.NetworkMode || '默认'}</Badge>
						</div>

						<!-- DNS Settings -->
						{#if containerData.HostConfig?.Dns?.length > 0 || containerData.HostConfig?.DnsSearch?.length > 0 || containerData.HostConfig?.DnsOptions?.length > 0}
							<div class="space-y-2">
								<h3 class="text-sm font-semibold">DNS 配置</h3>
								<div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
									{#if containerData.HostConfig?.Dns?.length > 0}
										<div class="p-2 bg-muted rounded">
											<p class="text-xs text-muted-foreground mb-1">DNS 服务器</p>
											{#each containerData.HostConfig.Dns as dns}
												<code class="text-xs block">{dns}</code>
											{/each}
										</div>
									{/if}
									{#if containerData.HostConfig?.DnsSearch?.length > 0}
										<div class="p-2 bg-muted rounded">
											<p class="text-xs text-muted-foreground mb-1">DNS 搜索</p>
											{#each containerData.HostConfig.DnsSearch as search}
												<code class="text-xs block">{search}</code>
											{/each}
										</div>
									{/if}
									{#if containerData.HostConfig?.DnsOptions?.length > 0}
										<div class="p-2 bg-muted rounded">
											<p class="text-xs text-muted-foreground mb-1">DNS 选项</p>
											{#each containerData.HostConfig.DnsOptions as opt}
												<code class="text-xs block">{opt}</code>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						{/if}

						<!-- Extra Hosts -->
						{#if containerData.HostConfig?.ExtraHosts?.length > 0}
							<div class="space-y-2">
								<h3 class="text-sm font-semibold">额外主机</h3>
								<div class="space-y-1">
									{#each containerData.HostConfig.ExtraHosts as host}
										<div class="text-xs p-2 bg-muted rounded">
											<code>{host}</code>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Networks -->
						{#if containerData.NetworkSettings?.Networks && Object.keys(containerData.NetworkSettings.Networks).length > 0}
							<div class="space-y-2">
								<h3 class="text-sm font-semibold">已连接网络</h3>
								<div class="space-y-2">
									{#each Object.entries(containerData.NetworkSettings.Networks) as [networkName, networkData]}
										<div class="p-3 border border-border rounded-lg space-y-2">
											<div class="flex items-center justify-between">
												<span class="font-medium text-sm">{networkName}</span>
												<Badge variant="secondary" class="text-xs">{networkData.NetworkID?.slice(0, 12)}</Badge>
											</div>
											<div class="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
												{#if networkData.IPAddress}
													<div>
														<p class="text-muted-foreground">IPv4</p>
														<code>{networkData.IPAddress}</code>
													</div>
												{/if}
												{#if networkData.GlobalIPv6Address}
													<div>
														<p class="text-muted-foreground">IPv6</p>
														<code>{networkData.GlobalIPv6Address}</code>
													</div>
												{/if}
												{#if networkData.MacAddress}
													<div>
														<p class="text-muted-foreground">MAC 地址</p>
														<code>{networkData.MacAddress}</code>
													</div>
												{/if}
												{#if networkData.Gateway}
													<div>
														<p class="text-muted-foreground">网关</p>
														<code>{networkData.Gateway}</code>
													</div>
												{/if}
												{#if networkData.Aliases?.length > 0}
													<div class="col-span-2">
														<p class="text-muted-foreground">别名</p>
														<code>{networkData.Aliases.join(', ')}</code>
													</div>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Ports -->
						{#if containerData.NetworkSettings?.Ports && Object.keys(containerData.NetworkSettings.Ports).length > 0}
							<div class="space-y-2">
								<h3 class="text-sm font-semibold">端口映射</h3>
								<div class="flex flex-wrap gap-2">
									{#each Object.entries(containerData.NetworkSettings.Ports) as [containerPort, hostBindings]}
										{#if hostBindings && hostBindings.length > 0}
											{#each hostBindings as binding}
												{@const url = getPortUrl(parseInt(binding.HostPort))}
												<div class="flex items-center gap-2 text-xs p-2 bg-muted rounded">
													{#if url}
														<a
															href={url}
															target="_blank"
															rel="noopener noreferrer"
															class="inline-flex items-center gap-1 text-primary hover:underline"
															title="打开 {url}"
														>
															<code>{binding.HostIp || '0.0.0.0'}:{binding.HostPort}</code>
															<ExternalLink class="w-3 h-3" />
														</a>
													{:else}
														<code>{binding.HostIp || '0.0.0.0'}:{binding.HostPort}</code>
													{/if}
													<span class="text-muted-foreground">→</span>
													<code>{containerPort}</code>
												</div>
											{/each}
										{:else}
											<div class="flex items-center gap-2 text-xs p-2 bg-muted rounded">
												<code class="text-muted-foreground">已暴露</code>
												<code>{containerPort}</code>
											</div>
										{/if}
									{/each}
								</div>
							</div>
						{/if}
					</Tabs.Content>

					<!-- Mounts Tab -->
					<Tabs.Content value="mounts" class="space-y-4 overflow-auto">
						{#if containerData.Mounts && containerData.Mounts.length > 0}
							<div class="space-y-2">
								{#each containerData.Mounts as mount}
									<div class="p-3 border border-border rounded-lg space-y-2">
										<div class="flex items-center justify-between">
											<Badge variant="outline" class="text-xs">{getLabelText(mount.Type)}</Badge>
											<Badge variant={mount.RW ? 'default' : 'secondary'} class="text-xs">
												{mount.RW ? '读写' : '只读'}
											</Badge>
										</div>
										<div class="grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs">
											<div>
												<p class="text-muted-foreground">源路径</p>
												<code class="break-all">{mount.Source || mount.Name || 'N/A'}</code>
											</div>
											<div>
												<p class="text-muted-foreground">目标路径</p>
												<code class="break-all">{mount.Destination}</code>
											</div>
											{#if mount.Driver}
												<div>
													<p class="text-muted-foreground">驱动</p>
													<code>{mount.Driver}</code>
												</div>
											{/if}
											{#if mount.Propagation}
												<div>
													<p class="text-muted-foreground">挂载传播</p>
													<code>{getLabelText(mount.Propagation)}</code>
												</div>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">未配置数据卷</p>
						{/if}
					</Tabs.Content>

					<!-- Files Tab -->
					<Tabs.Content value="files" class="flex-1 min-h-0">
						{#if containerData.State?.Running && !containerData.State?.Paused}
							<FileBrowserPanel
								containerId={containerId}
								envId={$currentEnvironment?.id ?? undefined}
							/>
						{:else if containerData.State?.Paused}
							<div class="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
								<Moon class="w-5 h-5" />
								<span>容器已暂停</span>
							</div>
						{:else}
							<div class="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
								<Moon class="w-5 h-5" />
								<span>容器未运行</span>
							</div>
						{/if}
					</Tabs.Content>

					<!-- Environment Tab -->
					<Tabs.Content value="env" class="space-y-4 overflow-auto">
						{#if containerData.Config?.Env && containerData.Config.Env.length > 0}
							<div class="space-y-1">
								{#each [...containerData.Config.Env].sort((a, b) => a.split('=')[0].localeCompare(b.split('=')[0])) as envVar}
									{@const [key, ...valueParts] = envVar.split('=')}
									{@const value = valueParts.join('=')}
									<div class="text-xs p-2 bg-muted rounded">
										<code class="text-muted-foreground font-medium">{key}</code>
										<code class="text-muted-foreground">=</code>
										<code class="break-all">{value}</code>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">无环境变量</p>
						{/if}
					</Tabs.Content>

					<!-- Labels Tab -->
					<Tabs.Content value="labels" class="space-y-4 overflow-auto">
						{#if containerData.Config?.Labels && Object.keys(containerData.Config.Labels).length > 0}
							<div class="space-y-1">
								{#each Object.entries(containerData.Config.Labels).sort((a, b) => a[0].localeCompare(b[0])) as [key, value]}
									<div class="text-xs p-2 bg-muted rounded flex items-start gap-2 group">
										<div class="flex-1 min-w-0">
											<code class="text-muted-foreground font-medium">{key}</code>
											<code class="text-muted-foreground">=</code>
											<code class="break-all">{value}</code>
										</div>
										<button
											type="button"
											onclick={() => copyLabel(key, value)}
											class="shrink-0 p-1 rounded hover:bg-background/50 transition-colors opacity-0 group-hover:opacity-100 {copiedLabel === key ? '!opacity-100' : ''}"
											title={copiedLabel === key ? '已复制！' : '复制标签'}
										>
											{#if copiedLabel === key}
												<Check class="w-3 h-3 text-green-500" />
											{:else}
												<Copy class="w-3 h-3 text-muted-foreground" />
											{/if}
										</button>
									</div>
								{/each}
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">无标签</p>
						{/if}
					</Tabs.Content>

					<!-- Security Tab -->
					<Tabs.Content value="security" class="space-y-4 overflow-auto">
						<!-- Privileged & User -->
						<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
							<div class="p-3 border border-border rounded-lg">
								<p class="text-xs text-muted-foreground mb-1">特权模式</p>
								<Badge variant={containerData.HostConfig?.Privileged ? 'destructive' : 'secondary'}>
									{containerData.HostConfig?.Privileged ? '是' : '否'}
								</Badge>
							</div>
							<div class="p-3 border border-border rounded-lg">
								<p class="text-xs text-muted-foreground mb-1">根目录只读</p>
								<Badge variant={containerData.HostConfig?.ReadonlyRootfs ? 'default' : 'outline'}>
									{containerData.HostConfig?.ReadonlyRootfs ? '是' : '否'}
								</Badge>
							</div>
							<div class="p-3 border border-border rounded-lg">
								<p class="text-xs text-muted-foreground mb-1">用户</p>
								<code class="text-xs">{containerData.Config?.User || 'root'}</code>
							</div>
							<div class="p-3 border border-border rounded-lg">
								<p class="text-xs text-muted-foreground mb-1">用户命名空间</p>
								<code class="text-xs">{containerData.HostConfig?.UsernsMode || 'host'}</code>
							</div>
						</div>

						<!-- Security Options -->
						{#if containerData.HostConfig?.SecurityOpt?.length > 0}
							<div class="space-y-2">
								<h3 class="text-sm font-semibold">安全选项</h3>
								<div class="space-y-1">
									{#each containerData.HostConfig.SecurityOpt as opt}
										<div class="text-xs p-2 bg-muted rounded">
											<code>{opt}</code>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- AppArmor / Seccomp -->
						<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
							{#if containerData.AppArmorProfile !== undefined}
								<div class="p-3 border border-border rounded-lg">
									<p class="text-xs text-muted-foreground mb-1">AppArmor 配置文件</p>
									<code class="text-xs">{containerData.AppArmorProfile || 'unconfined'}</code>
								</div>
							{/if}
							{#if containerData.HostConfig?.SecurityOpt?.some((o: string) => o.startsWith('seccomp'))}
								<div class="p-3 border border-border rounded-lg">
									<p class="text-xs text-muted-foreground mb-1">安全计算模式 (Seccomp)</p>
									<code class="text-xs">
										{containerData.HostConfig.SecurityOpt.find((o: string) => o.startsWith('seccomp'))?.split('=')[1] || 'default'}
									</code>
								</div>
							{/if}
						</div>

						<!-- Capabilities -->
						<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
							{#if containerData.HostConfig?.CapAdd?.length > 0}
								<div class="space-y-2">
									<h3 class="text-sm font-semibold text-green-600 dark:text-green-400">已添加权限</h3>
									<div class="flex flex-wrap gap-1">
										{#each containerData.HostConfig.CapAdd as cap}
											<Badge variant="outline" class="text-xs bg-green-500/10">{cap}</Badge>
										{/each}
									</div>
								</div>
							{/if}
							{#if containerData.HostConfig?.CapDrop?.length > 0}
								<div class="space-y-2">
									<h3 class="text-sm font-semibold text-red-600 dark:text-red-400">已移除权限</h3>
									<div class="flex flex-wrap gap-1">
										{#each containerData.HostConfig.CapDrop as cap}
											<Badge variant="outline" class="text-xs bg-red-500/10">{cap}</Badge>
										{/each}
									</div>
								</div>
							{/if}
						</div>

						{#if !containerData.HostConfig?.CapAdd?.length && !containerData.HostConfig?.CapDrop?.length && !containerData.HostConfig?.SecurityOpt?.length}
							<p class="text-sm text-muted-foreground">默认安全配置</p>
						{/if}
					</Tabs.Content>

					<!-- Resources Tab -->
					<Tabs.Content value="resources" class="space-y-4 overflow-auto">
						<!-- CPU & Memory Limits -->
						<div class="space-y-2">
							<h3 class="text-sm font-semibold flex items-center gap-2">
								<Settings2 class="w-4 h-4" />
								资源限制
							</h3>
							<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
								<div class="p-3 border border-border rounded-lg">
									<p class="text-xs text-muted-foreground mb-1">CPU 共享值</p>
									<code class="text-sm">{containerData.HostConfig?.CpuShares || '默认'}</code>
								</div>
								<div class="p-3 border border-border rounded-lg">
									<p class="text-xs text-muted-foreground mb-1">CPU 核心数</p>
									<code class="text-sm">{containerData.HostConfig?.NanoCpus ? (containerData.HostConfig.NanoCpus / 1e9).toFixed(2) : '无限制'}</code>
								</div>
								<div class="p-3 border border-border rounded-lg">
									<p class="text-xs text-muted-foreground mb-1">内存</p>
									<code class="text-sm">{formatMemory(containerData.HostConfig?.Memory)}</code>
								</div>
								<div class="p-3 border border-border rounded-lg">
									<p class="text-xs text-muted-foreground mb-1">交换分区</p>
									<code class="text-sm">{formatMemory(containerData.HostConfig?.MemorySwap)}</code>
								</div>
								<div class="p-3 border border-border rounded-lg">
									<p class="text-xs text-muted-foreground mb-1">内存预留</p>
									<code class="text-sm">{formatMemory(containerData.HostConfig?.MemoryReservation)}</code>
								</div>
								<div class="p-3 border border-border rounded-lg">
									<p class="text-xs text-muted-foreground mb-1">进程数限制</p>
									<code class="text-sm">{containerData.HostConfig?.PidsLimit ?? '无限制'}</code>
								</div>
								<div class="p-3 border border-border rounded-lg">
									<p class="text-xs text-muted-foreground mb-1">OOM 终止</p>
									<Badge variant={containerData.HostConfig?.OomKillDisable ? 'destructive' : 'default'}>
										{containerData.HostConfig?.OomKillDisable ? '已禁用' : '已启用'}
									</Badge>
								</div>
								<div class="p-3 border border-border rounded-lg">
									<p class="text-xs text-muted-foreground mb-1">CPU 周期/配额</p>
									<code class="text-sm">
										{containerData.HostConfig?.CpuPeriod || 0}/{containerData.HostConfig?.CpuQuota || 0}
									</code>
								</div>
							</div>
						</div>

						<!-- Ulimits -->
						{#if containerData.HostConfig?.Ulimits?.length > 0}
							<div class="space-y-2">
								<h3 class="text-sm font-semibold">用户资源限制</h3>
								<div class="grid grid-cols-1 lg:grid-cols-2 gap-2">
									{#each containerData.HostConfig.Ulimits as ulimit}
										<div class="flex justify-between text-xs p-2 bg-muted rounded">
											<code class="text-muted-foreground">{ulimit.Name}</code>
											<code>软限制={ulimit.Soft} 硬限制={ulimit.Hard}</code>
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Devices -->
						{#if containerData.HostConfig?.Devices?.length > 0}
							<div class="space-y-2">
								<h3 class="text-sm font-semibold">设备挂载</h3>
								<div class="space-y-1">
									{#each containerData.HostConfig.Devices as device}
										<div class="text-xs p-2 bg-muted rounded flex gap-2">
											<code class="text-muted-foreground">{device.PathOnHost}</code>
											<span class="text-muted-foreground">→</span>
											<code>{device.PathInContainer}</code>
											{#if device.CgroupPermissions}
												<Badge variant="outline" class="text-2xs">{device.CgroupPermissions}</Badge>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/if}

						<!-- GPU / Device Requests -->
						{#if containerData.HostConfig?.DeviceRequests?.length > 0 || (containerData.HostConfig?.Runtime && containerData.HostConfig.Runtime !== 'runc')}
							<div class="space-y-2">
								<h3 class="text-sm font-semibold flex items-center gap-2">
									<Gpu class="w-4 h-4" />
									GPU
								</h3>
								<div class="grid grid-cols-2 lg:grid-cols-3 gap-3">
									{#if containerData.HostConfig?.Runtime}
										<div class="p-3 border border-border rounded-lg">
											<p class="text-xs text-muted-foreground mb-1">运行时</p>
											<code class="text-sm">{containerData.HostConfig.Runtime}</code>
										</div>
									{/if}
									{#if containerData.HostConfig?.DeviceRequests?.length > 0}
										{@const req = containerData.HostConfig.DeviceRequests[0]}
										<div class="p-3 border border-border rounded-lg">
											<p class="text-xs text-muted-foreground mb-1">数量</p>
											<code class="text-sm">{req.Count === -1 ? '全部' : req.Count}</code>
										</div>
										{#if req.Driver}
											<div class="p-3 border border-border rounded-lg">
												<p class="text-xs text-muted-foreground mb-1">驱动</p>
												<code class="text-sm">{req.Driver}</code>
											</div>
										{/if}
										{#if req.DeviceIDs?.length > 0}
											<div class="p-3 border border-border rounded-lg col-span-full">
												<p class="text-xs text-muted-foreground mb-1">设备 ID</p>
												<div class="flex flex-wrap gap-1.5">
													{#each req.DeviceIDs as id}
														<Badge variant="secondary" class="text-2xs">{id}</Badge>
													{/each}
												</div>
											</div>
										{/if}
										{#if req.Capabilities?.length > 0}
											<div class="p-3 border border-border rounded-lg col-span-full">
												<p class="text-xs text-muted-foreground mb-1">功能权限</p>
												<div class="flex flex-wrap gap-1.5">
													{#each req.Capabilities.flat() as cap}
														<Badge variant="outline" class="text-2xs bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">{cap}</Badge>
													{/each}
												</div>
											</div>
										{/if}
									{/if}
								</div>
							</div>
						{/if}

						<!-- Cgroup -->
						<div class="space-y-2">
							<h3 class="text-sm font-semibold">控制组 (Cgroup) 配置</h3>
							<div class="grid grid-cols-2 lg:grid-cols-3 gap-3">
								<div class="p-2 bg-muted rounded">
									<p class="text-xs text-muted-foreground">控制组 (Cgroup)</p>
									<code class="text-xs">{containerData.HostConfig?.Cgroup || '默认'}</code>
								</div>
								<div class="p-2 bg-muted rounded">
									<p class="text-xs text-muted-foreground">父控制组 (Cgroup)</p>
									<code class="text-xs">{containerData.HostConfig?.CgroupParent || '默认'}</code>
								</div>
								<div class="p-2 bg-muted rounded">
									<p class="text-xs text-muted-foreground">控制组 (Cgroup) 命名空间模式</p>
									<code class="text-xs">{containerData.HostConfig?.CgroupnsMode || 'host'}</code>
								</div>
							</div>
						</div>
					</Tabs.Content>

					<!-- Health Tab -->
					<Tabs.Content value="health" class="flex flex-col overflow-hidden">
						{@const healthConfig = containerData.Config?.Healthcheck}
						{@const healthState = containerData.State?.Health}
						{@const formatNs = (ns: number) => ns ? `${ns / 1e9}秒` : '-'}
						{#if healthConfig || healthState}
							<div class="flex flex-col flex-1 min-h-0 gap-4">
								<!-- Healthcheck Configuration -->
								{#if healthConfig && healthConfig.Test && healthConfig.Test.length > 0}
									<div class="shrink-0">
										<h3 class="text-sm font-semibold mb-2">配置信息</h3>
										<div class="grid grid-cols-2 gap-3 text-sm">
											<div class="col-span-2">
												<p class="text-muted-foreground">检查命令</p>
												<code class="text-xs break-all">{healthConfig.Test.join(' ')}</code>
											</div>
											<div>
												<p class="text-muted-foreground">检查间隔</p>
												<code class="text-xs">{formatNs(healthConfig.Interval)}</code>
											</div>
											<div>
												<p class="text-muted-foreground">超时时间</p>
												<code class="text-xs">{formatNs(healthConfig.Timeout)}</code>
											</div>
											<div>
												<p class="text-muted-foreground">重试次数</p>
												<code class="text-xs">{healthConfig.Retries || '-'}</code>
											</div>
											<div>
												<p class="text-muted-foreground">启动等待时间</p>
												<code class="text-xs">{formatNs(healthConfig.StartPeriod)}</code>
											</div>
										</div>
									</div>
								{/if}

								<!-- Runtime Status -->
								{#if healthState}
									<div class="shrink-0">
										<h3 class="text-sm font-semibold mb-2">运行状态</h3>
										<div class="grid grid-cols-2 gap-3 text-sm">
											<div>
												<p class="text-muted-foreground">当前状态</p>
												<Badge variant={healthState.Status === 'healthy' ? 'default' : healthState.Status === 'starting' ? 'secondary' : 'destructive'}>
													{healthState.Status === 'healthy' ? '健康' : healthState.Status === 'starting' ? '启动中' : '异常'}
												</Badge>
											</div>
											<div>
												<p class="text-muted-foreground">连续失败次数</p>
												<code class="text-xs">{healthState.FailingStreak || 0}</code>
											</div>
										</div>
									</div>

									{#if healthState.Log && healthState.Log.length > 0}
										<div class="flex flex-col flex-1 min-h-0">
											<h3 class="text-sm font-semibold mb-2 shrink-0">健康检查日志</h3>
											<div class="space-y-1 overflow-y-auto flex-1">
												{#each healthState.Log.slice(-5) as log}
													<div class="p-2 border border-border rounded text-xs space-y-1">
														<div class="flex justify-between items-center">
															<Badge variant={log.ExitCode === 0 ? 'default' : 'destructive'} class="text-xs">
																退出码：{log.ExitCode}
															</Badge>
															<span class="text-muted-foreground">{formatDate(log.End)}</span>
														</div>
														{#if log.Output}
															<code class="block text-xs bg-muted p-1 rounded break-all">{log.Output.trim()}</code>
														{/if}
													</div>
												{/each}
											</div>
										</div>
									{/if}
								{:else if healthConfig}
									<p class="text-sm text-muted-foreground">等待首次健康检查完成...</p>
								{/if}
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">未配置健康检查</p>
						{/if}
					</Tabs.Content>
				</Tabs.Root>
			{/if}
		</div>

		<Dialog.Footer class="shrink-0">
			<Button variant="outline" onclick={() => (open = false)}>关闭</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Raw JSON Modal -->
<Dialog.Root bind:open={showRawJson}>
	<Dialog.Content class="max-w-4xl max-h-[90vh] sm:max-h-[80vh] flex flex-col">
		<Dialog.Header class="shrink-0">
			<Dialog.Title class="flex items-center gap-2">
				<Code class="w-5 h-5" />
				原始 JSON
				<Button
					variant="outline"
					size="sm"
					onclick={copyJson}
					title={jsonCopied === 'ok' ? '已复制！' : '复制到剪贴板'}
				>
					{#if jsonCopied === 'error'}
						<Tooltip.Root open>
							<Tooltip.Trigger>
								<XCircle class="w-4 h-4 mr-1.5 text-red-500" />
							</Tooltip.Trigger>
							<Tooltip.Content>复制需要 HTTPS 协议</Tooltip.Content>
						</Tooltip.Root>
						<span class="text-red-500">失败</span>
					{:else if jsonCopied === 'ok'}
						<Check class="w-4 h-4 mr-1.5 text-green-500" />
						<span class="text-green-500">已复制！</span>
					{:else}
						<Copy class="w-4 h-4 mr-1.5" />
						复制
					{/if}
				</Button>
			</Dialog.Title>
		</Dialog.Header>
		<div class="flex-1 overflow-auto min-h-0">
			<div class="bg-gray-100 dark:bg-zinc-900 rounded-lg text-xs font-mono overflow-auto h-full">
				<table class="w-full">
					<tbody>
						{#each jsonLines as line, i}
							<tr class="hover:bg-gray-200/50 dark:hover:bg-zinc-800/50">
								<td class="text-right text-gray-400 dark:text-zinc-500 select-none px-3 py-0 border-r border-gray-300 dark:border-zinc-700 sticky left-0 bg-gray-100 dark:bg-zinc-900">{i + 1}</td>
								<td class="px-3 py-0 whitespace-pre text-gray-900 dark:text-gray-100">{@html line || ' '}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
		<Dialog.Footer class="shrink-0">
			<Button variant="outline" onclick={() => showRawJson = false}>关闭</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

