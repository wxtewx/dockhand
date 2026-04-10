<script lang="ts">
	// Trigger rebuild for debug logging changes
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Box, Images, HardDrive, Network, Cpu, Server, Crown, Building2, Layers, Clock, Code, Package, ExternalLink, Search, FileText, Tag, Sparkles, Bug, ChevronDown, ChevronRight, Plug, ScrollText, Shield, MessageSquarePlus, GitBranch, Coffee, Monitor, Cog, MemoryStick, Database, CircleArrowUp, Loader2, CheckCircle2 } from 'lucide-svelte';
	import * as Tabs from '$lib/components/ui/tabs';
	import { onMount, onDestroy } from 'svelte';
	import { licenseStore } from '$lib/stores/license';
	import { browser } from '$app/environment';
	import LicenseModal from './LicenseModal.svelte';
	import PrivacyModal from './PrivacyModal.svelte';
	import SelfUpdateDialog from './SelfUpdateDialog.svelte';

	interface Dependency {
		name: string;
		version: string;
		license: string;
		repository: string | null;
	}

	interface ChangelogChange {
		type: 'feature' | 'fix';
		text: string;
	}

	interface ChangelogEntry {
		version: string;
		date: string;
		changes: ChangelogChange[];
		imageTag: string;
	}

	let dependencies = $state<Dependency[]>([]);
	let loadingDeps = $state(true);
	let depsError = $state<string | null>(null);
	let depsSearch = $state('');

	let changelog = $state<ChangelogEntry[]>([]);
	let loadingChangelog = $state(true);
	let changelogError = $state<string | null>(null);
	let expandedReleases = $state<Set<number>>(new Set([0])); // First release (latest) expanded by default

	let activeTab = $state('releases');

	function toggleRelease(index: number) {
		const newSet = new Set(expandedReleases);
		if (newSet.has(index)) {
			newSet.delete(index);
		} else {
			newSet.add(index);
		}
		expandedReleases = newSet;
	}

	// Current version from git tag (injected at build time)
	declare const __APP_VERSION__: string | null;
	const currentVersion = __APP_VERSION__ || 'unknown';

	const filteredDeps = $derived(
		dependencies.filter(dep =>
			dep.name.toLowerCase().includes(depsSearch.toLowerCase()) ||
			dep.license.toLowerCase().includes(depsSearch.toLowerCase())
		)
	);

	async function fetchDependencies() {
		try {
			const res = await fetch('/api/dependencies');
			if (!res.ok) throw new Error('获取更新日志失败');
			dependencies = await res.json();
		} catch (e) {
			depsError = e instanceof Error ? e.message : '未知错误';
		} finally {
			loadingDeps = false;
		}
	}

	async function fetchChangelog() {
		try {
			const res = await fetch('/api/changelog');
			if (!res.ok) throw new Error('获取更新日志失败');
			changelog = await res.json();
		} catch (e) {
			changelogError = e instanceof Error ? e.message : '未知错误';
		} finally {
			loadingChangelog = false;
		}
	}

	function formatChangelogDate(dateStr: string): string {
		try {
			const date = new Date(dateStr);
			return date.toLocaleDateString('zh-CN', {
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});
		} catch {
			return dateStr;
		}
	}

	// Build info - injected at build time
	declare const __BUILD_BRANCH__: string | null;
	const BUILD_DATE = __BUILD_DATE__ ?? null;
	const BUILD_COMMIT = __BUILD_COMMIT__ ?? null;
	const BUILD_BRANCH = __BUILD_BRANCH__ ?? null;

	const TAGLINES = [
		"简化部署，轻松使用",
		"减少输入，高效交付",
		"轻松管理容器，无需繁琐操作",
		"Docker 管理，告别复杂难题",
		"容器管理本不该如此繁琐",
		"统一界面，掌控所有容器 (与你的心态)",
		"CLI 操作疲惫？我们来解决",
		"自动化、编排化，我们负责核心工作",
		"让 docker ps 变得简单愉悦",
		"你的 API 值得更好的使用体验",
		"DevOps 也能轻松从容",
		"零门槛，轻松管理容器",
		"简化部署，轻松使用",
		"即使是容器工具，也需要便捷管理",
		"从混乱到有序，优雅实现",
		"平稳部署，无任何困扰",
		"你的 Docker 守护进程贴心助手",
		"告别复杂命令，像普通人一样管理 Docker",
		"docker ps 不该成为日常负担",
		"你的容器值得告别脚本与压力",
		"我们让 Docker 稳定运行，无需复杂参数",
		"从混乱的 YAML 到井然有序",
		"让容器一次性听话运行",
		"掌控混乱，无需繁琐 CLI 操作",
		"人人都能轻松管理容器",
		"让容器管理更规范，从 1.0 版本开始",
		"减少繁琐操作，专注交付部署",
		"每次部署都平稳顺畅",
		"简单纯粹，专注 Docker",
		"Docker 管理，精简高效",
		"流畅编排，零额外开销",
		"构建、交付、轻松休息",
		"少思考，快部署",
		"完全掌控，无需复杂操作",
		"因为你有更重要的事情要做",
		"别再让容器带来困扰",
		"CLI 疲惫？自动化来解决",
		"一个工具，告别重复命令记录",
		"让 Docker 管理更简单，始终如一",
		"因为管理 Docker 无需精通命令行",
		"你的容器，少些混乱，多些轻松",
		"别再重复复制粘贴 docker ps | grep 命令",
		"终于有一款好用的 Docker UI，不再难用",
		"我们精通容器管理，你无需费心",
		"让 Docker 管理重拾便捷与尊严",
		"适合热爱 Docker 却厌倦复杂操作的你",
		"为喜欢可视化操作的用户打造自动化工具",
		"轻松驯服容器，不影响你的工作效率",
		"让工作流告别复杂容器操作",
		"从现在开始，让容器规范运行",
		"每个 DevOps 都值得拥有休息时间",
		"专注容器，拒绝繁琐煎熬",
		"聪明工作，轻松管理 Docker",
		"为负责任部署生产环境的你打造",
		"把 Docker 管理变成一门艺术",
		"轻松部署的快捷方式",
		"零门槛，管理无限容器",
		"减少无用操作，专注镜像拉取",
		"因为脚本只会越来越难维护",
		"CLI 复杂操作早已过时",
		"容器有序，开发者开心",
		"终于有一款尊重你时间与终端的工具"
	];

	interface SystemInfo {
		docker: {
			version: string;
			apiVersion: string;
			os: string;
			arch: string;
			kernelVersion: string;
			serverVersion: string;
			connection: {
				type: 'socket' | 'http' | 'https';
				socketPath?: string;
				host?: string;
				port?: number;
			};
		} | null;
		host: {
			name: string;
			cpus: number;
			memory: number;
			storageDriver: string;
		} | null;
		runtime: {
			runtimeName: string;
			runtimeVersion: string;
			nodeVersion: string;
			platform: string;
			arch: string;
			kernel: string;
			memory: {
				heapUsed: number;
				heapTotal: number;
				rss: number;
				external: number;
			};
			container: {
				inContainer: boolean;
				runtime?: string;
				containerId?: string;
			};
			ownContainer?: {
				id: string;
				name: string;
				image: string;
				imageId: string;
				created: string;
				status: string;
				restartCount: number;
				labels?: {
					version?: string;
					revision?: string;
				};
			} | null;
		};
		database: {
			type: string;
			schemaVersion: string | null;
			schemaDate: string | null;
			host?: string;
			port?: string;
		};
		stats: {
			containers: { total: number; running: number; stopped: number };
			images: number;
			volumes: number;
			networks: number;
			stacks: number;
		};
	}

	let systemInfo: SystemInfo | null = $state(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let isJumping = $state(false);
	let hasClicked = $state(false);
	let clickCount = $state(0);
	let totalClicks = $state(0);
	let showEasterEgg = $state(false);
	let taglineIndex = $state(0);
	let serverUptime = $state<number | null>(null);
	let showLicenseModal = $state(false);
	let showPrivacyModal = $state(false);

	// Self-update state
	let checkingUpdate = $state(false);
	let updateCheckDone = $state(false);
	let updateAvailable = $state(false);
	let updateInfo = $state<{
		currentImage: string;
		newImage: string;
		currentDigest: string;
		newDigest: string;
		containerName: string;
		isComposeManaged: boolean;
		latestVersion?: string;
		error?: string;
	} | null>(null);
	let updateCheckError = $state<string | null>(null);
	let showSelfUpdateDialog = $state(false);

	async function checkForUpdates() {
		checkingUpdate = true;
		updateCheckDone = false;
		updateAvailable = false;
		updateInfo = null;
		updateCheckError = null;

		try {
			const response = await fetch('/api/self-update/check');
			if (!response.ok) {
				updateCheckError = '检查更新失败';
				return;
			}

			const data = await response.json();

			if (data.error && !data.updateAvailable) {
				// Not in Docker or other non-critical issue
				updateCheckError = data.error;
				return;
			}

			updateAvailable = data.updateAvailable;
			updateCheckDone = true;

			if (data.updateAvailable) {
				updateInfo = {
					currentImage: data.currentImage,
					newImage: data.newImage || data.currentImage,
					currentDigest: data.currentDigest || '',
					newDigest: data.newDigest || '',
					containerName: data.containerName,
					isComposeManaged: data.isComposeManaged,
					latestVersion: data.latestVersion
				};
			}
		} catch (err) {
			updateCheckError = '检查失败：' + String(err);
		} finally {
			checkingUpdate = false;
		}
	}

	function formatUptime(seconds: number): string {
		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = Math.floor(seconds % 60);

		// Always show full format for layout stability
		const pad = (n: number) => n.toString().padStart(2, '0');
		if (days > 0) {
			return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
		} else {
			return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
		}
	}

	function formatBuildDate(dateStr: string | null): string {
		if (!dateStr) return '开发版';
		try {
			const date = new Date(dateStr);
			return date.toLocaleDateString('zh-CN', {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			});
		} catch {
			return dateStr;
		}
	}

	function loadTaglineIndex() {
		if (browser) {
			const saved = localStorage.getItem('dockhand-tagline-index');
			if (saved !== null) {
				taglineIndex = parseInt(saved, 10) % TAGLINES.length;
			}
		}
	}

	function saveTaglineIndex() {
		if (browser) {
			localStorage.setItem('dockhand-tagline-index', String(taglineIndex));
		}
	}

	let jumpLevel = $state(0); // 0, 1, 2 for small, medium, big jump
	let taglineAnimating = $state(false);

	function handleLogoClick() {
		if (isJumping) return;
		hasClicked = true;
		clickCount++;
		totalClicks++;
		jumpLevel = (totalClicks - 1) % 3; // 0, 1, 2 cycle
		isJumping = true;

		// Change tagline every 3 clicks (after the big jump)
		if (totalClicks % 3 === 0) {
			taglineAnimating = true;
			taglineIndex = (taglineIndex + 1) % TAGLINES.length;
			saveTaglineIndex();
			setTimeout(() => {
				taglineAnimating = false;
			}, 400);
		}

		if (clickCount >= 10) {
			showEasterEgg = true;
			setTimeout(() => {
				showEasterEgg = false;
				clickCount = 0;
				totalClicks = 0; // Reset the tagline cycle too
			}, 5000);
		}

		setTimeout(() => {
			isJumping = false;
		}, 800);
	}

	function formatBytes(bytes: number): string {
		const gb = bytes / (1024 * 1024 * 1024);
		return `${gb.toFixed(1)} GB`;
	}

	async function fetchSystemInfo() {
		try {
			const [systemRes, hostRes] = await Promise.all([
				fetch('/api/system'),
				fetch('/api/host')
			]);
			if (!systemRes.ok) throw new Error('获取系统信息失败');
			systemInfo = await systemRes.json();

			if (hostRes.ok) {
				const hostData = await hostRes.json();
				serverUptime = hostData.uptime;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '未知错误';
		} finally {
			loading = false;
		}
	}

	let uptimeInterval: ReturnType<typeof setInterval>;

	onMount(() => {
		loadTaglineIndex();
		fetchSystemInfo();
		fetchDependencies();
		fetchChangelog();
		checkForUpdates();
		// Increment uptime every second for real-time display
		uptimeInterval = setInterval(() => {
			if (serverUptime !== null) {
				serverUptime++;
			}
		}, 1000);
	});

	onDestroy(() => {
		if (uptimeInterval) {
			clearInterval(uptimeInterval);
		}
	});
</script>

<div class="flex flex-col items-center py-4 px-4 max-w-5xl mx-auto">
	<!-- Two Column Layout -->
	<div class="w-full grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
		<!-- App Info Card (Left) -->
		<Card.Root class="w-full flex flex-col">
			<Card.Content class="pt-8 pb-6 flex-1 flex items-center">
				<div class="flex flex-col items-center text-center space-y-4 w-full">
					<!-- Logo -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="animate-speedy {isJumping ? (clickCount >= 10 ? 'crazy-jumping' : `jumping-${jumpLevel}`) : ''} {hasClicked && !isJumping ? 'clicked' : ''}" onclick={handleLogoClick}>
						<img
							src="/logo-light.webp"
							alt="Dockhand 图标"
							class="h-36 w-auto object-contain dark:hidden"
							style="filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.3)) drop-shadow(-1px -1px 1px rgba(255,255,255,0.9));"
						/>
						<img
							src="/logo-dark.webp"
							alt="Dockhand 图标"
							class="h-36 w-auto object-contain hidden dark:block"
							style="filter: drop-shadow(2px 2px 3px rgba(0,0,0,0.6)) drop-shadow(-1px -1px 1px rgba(255,255,255,0.2));"
						/>
						<!-- Sparkles on DOCKHAND text area (bottom half) -->
						<span class="sparkle sparkle-1">✦</span>
						<span class="sparkle sparkle-2">✦</span>
						<span class="sparkle sparkle-3">✦</span>
						<span class="sparkle sparkle-4">✦</span>
						<span class="sparkle sparkle-5">✦</span>
						<span class="sparkle sparkle-6">✦</span>
						<span class="sparkle sparkle-7">✦</span>
						<span class="sparkle sparkle-8">✦</span>
						<!-- Easter Egg Popup -->
						{#if showEasterEgg}
							<div class="easter-egg-popup">
								别点啦，来自 r/selfhosted 的朋友？
							</div>
						{/if}
					</div>

					<!-- Version Badge + Update Check -->
					<div class="flex flex-col items-center gap-1">
						<Badge variant="secondary" class="text-xs">版本 {currentVersion}</Badge>
						{#if checkingUpdate}
							<span class="flex items-center gap-1 text-xs text-muted-foreground">
								<Loader2 class="w-3.5 h-3.5 animate-spin" />
								正在检查更新...
							</span>
						{:else if updateAvailable && updateInfo}
							<button class="flex items-center gap-1 text-xs text-amber-500 hover:text-amber-400 transition-colors" onclick={() => showSelfUpdateDialog = true}>
								<CircleArrowUp class="w-3.5 h-3.5" />
								有可用更新 — 点击查看更新内容
							</button>
						{:else if updateCheckDone && !updateAvailable}
							<button class="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 dark:hover:text-emerald-300 transition-colors" onclick={checkForUpdates}>
								<CheckCircle2 class="w-3.5 h-3.5" />
								已是最新版本
							</button>
						{:else if updateCheckError}
							<button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" onclick={checkForUpdates} title={updateCheckError}>
								检查更新
							</button>
						{/if}
					</div>

					<!-- Build & Uptime Info -->
					<div class="flex items-center gap-4 text-xs text-muted-foreground">
						{#if BUILD_BRANCH}
							<div class="flex items-center gap-1">
								<GitBranch class="w-3 h-3" />
								<span>{BUILD_BRANCH}</span>
							</div>
						{/if}
						{#if BUILD_COMMIT}
							<div class="flex items-center gap-1">
								<Code class="w-3 h-3" />
								<span>{BUILD_COMMIT.slice(0, 7)}{#if BUILD_DATE}&nbsp;({formatBuildDate(BUILD_DATE)}){/if}</span>
							</div>
						{/if}
						{#if serverUptime !== null}
							<div class="flex items-center gap-1 min-w-[8.5rem]">
								<Clock class="w-3 h-3 shrink-0" />
								<span class="tabular-nums">运行时长 {formatUptime(serverUptime)}</span>
							</div>
						{/if}
					</div>

					<!-- Description -->
					<p class="text-sm text-muted-foreground tagline-text {taglineAnimating ? 'tagline-zoom' : ''}">
						{TAGLINES[taglineIndex]}
					</p>

					<!-- Website Link -->
					<a href="https://dockhand.pro" target="_blank" rel="noopener noreferrer" class="text-sm text-primary hover:underline">
						https://dockhand.pro
					</a>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- System Stats Card (Right) -->
		<Card.Root class="w-full h-full">
			<Card.Header class="pb-2">
				<Card.Title class="text-sm font-medium">系统信息</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if loading}
					<div class="flex items-center justify-center py-6">
						<div class="text-sm text-muted-foreground">加载中...</div>
					</div>
				{:else if error}
					<div class="flex items-center justify-center py-6">
						<div class="text-sm text-destructive">{error}</div>
					</div>
				{:else if systemInfo}
					<div class="space-y-3">
						{#if systemInfo.docker}
						<!-- Docker Info -->
						<div class="space-y-1.5">
							<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
								<Server class="w-3.5 h-3.5" />
								Docker
							</div>
							<div class="text-sm pl-5 space-y-0.5">
								<div class="flex items-center gap-2">
									<span class="text-muted-foreground">版本</span>
									<span>{systemInfo.docker.version}</span>
									<span class="text-muted-foreground/50">|</span>
									<span class="text-muted-foreground">API</span>
									<span>{systemInfo.docker.apiVersion}</span>
									<span class="text-muted-foreground/50">|</span>
									<span class="text-muted-foreground">系统/架构</span>
									<span>{systemInfo.docker.os}/{systemInfo.docker.arch}</span>
								</div>
							</div>
						</div>

						<!-- Connection Info -->
						<div class="space-y-1.5">
							<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
								<Plug class="w-3.5 h-3.5" />
								连接方式
							</div>
							<div class="text-sm pl-5">
								<div class="flex items-center gap-2 flex-wrap">
									{#if systemInfo.docker.connection.type === 'socket'}
										<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/15 text-violet-600 dark:text-violet-400 shadow-sm ring-1 ring-violet-500/20">
											Unix Socket
										</span>
										<span class="text-xs font-mono text-muted-foreground">{systemInfo.docker.connection.socketPath}</span>
									{:else if systemInfo.docker.connection.type === 'https'}
										<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400 shadow-sm ring-1 ring-green-500/20">
											HTTPS (TLS)
										</span>
										<span class="text-xs font-mono text-muted-foreground">{systemInfo.docker.connection.host}:{systemInfo.docker.connection.port}</span>
									{:else}
										<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 shadow-sm ring-1 ring-amber-500/20">
											HTTP
										</span>
										<span class="text-xs font-mono text-muted-foreground">{systemInfo.docker.connection.host}:{systemInfo.docker.connection.port}</span>
									{/if}
								</div>
							</div>
						</div>

						<!-- Host Info -->
						<div class="space-y-1.5">
							<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
								<Cpu class="w-3.5 h-3.5" />
								主机
							</div>
							<div class="text-sm pl-5">
								<div class="flex items-center gap-2">
									<span class="text-muted-foreground">名称</span>
									<span>{systemInfo.host.name}</span>
									<span class="text-muted-foreground/50">|</span>
									<span class="text-muted-foreground">CPU 核心数</span>
									<span>{systemInfo.host.cpus}</span>
									<span class="text-muted-foreground/50">|</span>
									<span class="text-muted-foreground">内存</span>
									<span>{formatBytes(systemInfo.host.memory)}</span>
								</div>
							</div>
						</div>
						{/if}

						<!-- Runtime Info -->
						<div class="space-y-1.5">
							<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
								<Cpu class="w-3.5 h-3.5" />
								运行环境
							</div>
							<div class="text-sm pl-5">
								<div class="flex items-center gap-2 flex-wrap">
									{#if systemInfo.runtime.runtimeVersion}
										<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400 shadow-sm ring-1 ring-green-500/20">
											{systemInfo.runtime.runtimeName} {systemInfo.runtime.runtimeVersion}
										</span>
									{/if}
									<span class="text-muted-foreground/50">|</span>
									<Server class="w-3 h-3 text-muted-foreground" />
									<span>{systemInfo.runtime.platform}/{systemInfo.runtime.arch}</span>
									<span class="text-muted-foreground/50">|</span>
									<Cpu class="w-3 h-3 text-muted-foreground" />
									<span>{systemInfo.runtime.kernel}</span>
									<span class="text-muted-foreground/50">|</span>
									<MemoryStick class="w-3 h-3 text-muted-foreground" />
									<span>{formatBytes(systemInfo.runtime.memory.rss)}</span>
								</div>
								{#if systemInfo.runtime.container.inContainer}
								<div class="flex items-center gap-2 flex-wrap mt-1">
									<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 shadow-sm ring-1 ring-blue-500/20">
										{systemInfo.runtime.container.runtime || '容器'}
									</span>
									{#if systemInfo.runtime.ownContainer}
										<span class="text-xs font-mono text-muted-foreground">{systemInfo.runtime.ownContainer.image}</span>
									{/if}
									{#if systemInfo.docker}
										<span class="text-muted-foreground/50">|</span>
										<span class="text-muted-foreground">Docker</span>
										<span>{systemInfo.docker.version}</span>
									{/if}
								</div>
								{/if}
							</div>
						</div>

						<!-- Database Info -->
						<div class="space-y-1.5">
							<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
								<Database class="w-3.5 h-3.5" />
								数据库
							</div>
							<div class="text-sm pl-5 space-y-1">
								<div class="flex items-center gap-2 flex-wrap">
									{#if systemInfo.database.type === 'PostgreSQL'}
										<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 shadow-sm ring-1 ring-blue-500/20">
											PostgreSQL
										</span>
										{#if systemInfo.database.host}
											<span class="text-muted-foreground/50">|</span>
											<span class="text-xs">{systemInfo.database.host}:{systemInfo.database.port}</span>
										{/if}
									{:else}
										<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shadow-sm ring-1 ring-emerald-500/20">
											SQLite
										</span>
									{/if}
								</div>
								{#if systemInfo.database.schemaVersion}
									<div class="flex items-center gap-2">
										<span class="text-muted-foreground">数据表版本</span>
										<span class="font-mono text-xs">{systemInfo.database.schemaVersion}</span>
										{#if systemInfo.database.schemaDate}
											<span class="text-muted-foreground/60 text-xs">({systemInfo.database.schemaDate})</span>
										{/if}
									</div>
								{/if}
							</div>
						</div>

						<!-- License Info -->
						<div class="space-y-1.5">
							<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
								{#if $licenseStore.licenseType === 'enterprise'}
									<Crown class="w-3.5 h-3.5" />
								{:else if $licenseStore.licenseType === 'smb'}
									<Building2 class="w-3.5 h-3.5" />
								{:else}
									<Crown class="w-3.5 h-3.5" />
								{/if}
								许可证
							</div>
							<div class="text-sm pl-5">
								<div class="flex items-center gap-2 flex-wrap">
									<span class="text-muted-foreground">版本</span>
									{#if $licenseStore.licenseType === 'enterprise'}
										<span class="text-amber-500 font-medium flex items-center gap-1">
											<Crown class="w-3.5 h-3.5 fill-current" />
											企业版
										</span>
									{:else if $licenseStore.licenseType === 'smb'}
										<span class="text-blue-500 font-medium flex items-center gap-1">
											<Building2 class="w-3.5 h-3.5" />
											中小企业版
										</span>
									{:else}
										<span>社区版</span>
									{/if}
									{#if $licenseStore.isLicensed && $licenseStore.licensedTo}
										<span class="text-muted-foreground/50">|</span>
										<span class="text-muted-foreground">授权给</span>
										<span>{$licenseStore.licensedTo}</span>
									{/if}
									<span class="text-muted-foreground/50">|</span>
									<button class="text-primary hover:underline cursor-pointer" onclick={() => showLicenseModal = true}>服务条款</button>
									<span class="text-muted-foreground/50">|</span>
									<button class="text-primary hover:underline cursor-pointer" onclick={() => showPrivacyModal = true}>隐私政策</button>
								</div>
								<div class="flex items-center gap-2 flex-wrap mt-3 pt-2 border-t border-border/50">
									<a href="https://github.com/Finsys/dockhand/issues" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline inline-flex items-center gap-1.5 font-medium">
										<MessageSquarePlus class="w-4 h-4" />
										提交问题或建议
									</a>
									<span class="text-muted-foreground/50">|</span>
									<a href="https://discord.gg/rMxW9Y5cQw" target="_blank" rel="noopener noreferrer" class="hover:underline inline-flex items-center gap-1.5 font-medium text-indigo-500 dark:text-indigo-400">
										<svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
										Discord
									</a>
									{#if !$licenseStore.isLicensed}
										<span class="text-muted-foreground/50">|</span>
										<a href="https://buymeacoffee.com/dockhand" target="_blank" rel="noopener noreferrer" class="hover:underline inline-flex items-center gap-1.5 font-medium text-amber-600 dark:text-yellow-400">
											<Coffee class="w-4 h-4" />
											请我喝杯咖啡
										</a>
									{/if}
								</div>
								{#if !$licenseStore.isLicensed}
									<p class="text-xs text-muted-foreground mt-2">Dockhand 社区版永久免费，无任何附加条件。喜欢它？支持开发者继续更新！</p>
								{/if}
							</div>
						</div>

						{#if systemInfo.docker}
						<!-- Resource Stats -->
						<div class="grid grid-cols-5 gap-2 pt-3">
							<div class="stat-box stat-box-blue">
								<div class="stat-icon-wrapper bg-blue-500/10">
									<Box class="w-4 h-4 text-blue-500" />
								</div>
								<div class="text-lg font-bold">{systemInfo.stats.containers.total}</div>
								<div class="text-2xs text-muted-foreground font-medium">容器</div>
							</div>
							<div class="stat-box stat-box-cyan">
								<div class="stat-icon-wrapper bg-cyan-500/10">
									<Layers class="w-4 h-4 text-cyan-500" />
								</div>
								<div class="text-lg font-bold">{systemInfo.stats.stacks}</div>
								<div class="text-2xs text-muted-foreground font-medium">堆栈</div>
							</div>
							<div class="stat-box stat-box-purple">
								<div class="stat-icon-wrapper bg-purple-500/10">
									<Images class="w-4 h-4 text-purple-500" />
								</div>
								<div class="text-lg font-bold">{systemInfo.stats.images}</div>
								<div class="text-2xs text-muted-foreground font-medium">镜像</div>
							</div>
							<div class="stat-box stat-box-green">
								<div class="stat-icon-wrapper bg-green-500/10">
									<HardDrive class="w-4 h-4 text-green-500" />
								</div>
								<div class="text-lg font-bold">{systemInfo.stats.volumes}</div>
								<div class="text-2xs text-muted-foreground font-medium">数据卷</div>
							</div>
							<div class="stat-box stat-box-orange">
								<div class="stat-icon-wrapper bg-orange-500/10">
									<Network class="w-4 h-4 text-orange-500" />
								</div>
								<div class="text-lg font-bold">{systemInfo.stats.networks}</div>
								<div class="text-2xs text-muted-foreground font-medium">网络</div>
							</div>
						</div>
						{/if}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Releases & Dependencies Card with Tabs -->
	<Card.Root class="w-full mt-4">
		<Tabs.Root bind:value={activeTab} class="w-full">
			<div class="px-4 pt-4">
				<Tabs.List class="w-full grid grid-cols-2">
					<Tabs.Trigger value="releases" class="flex items-center gap-2">
						<FileText class="w-4 h-4" />
						<span>更新日志</span>
						<Badge variant="secondary" class="text-2xs">{changelog.length}</Badge>
					</Tabs.Trigger>
					<Tabs.Trigger value="dependencies" class="flex items-center gap-2">
						<Package class="w-4 h-4" />
						<span>依赖项</span>
						<Badge variant="secondary" class="text-2xs">{dependencies.length}</Badge>
					</Tabs.Trigger>
				</Tabs.List>
			</div>

			<Tabs.Content value="releases" class="px-4 pb-4">
				{#if loadingChangelog}
					<div class="flex items-center justify-center py-8">
						<div class="text-sm text-muted-foreground">正在加载版本信息...</div>
					</div>
				{:else if changelogError}
					<div class="flex items-center justify-center py-8">
						<div class="text-sm text-destructive">{changelogError}</div>
					</div>
				{:else}
					<div class="space-y-2 max-h-[400px] overflow-y-auto">
						{#each changelog as release, index}
							{@const isExpanded = expandedReleases.has(index)}
							<div class="border rounded-lg {index === 0 ? 'border-primary/30 bg-primary/5' : ''}">
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 rounded-lg transition-colors"
									onclick={() => toggleRelease(index)}
								>
									<div class="flex items-center gap-2">
										{#if isExpanded}
											<ChevronDown class="w-4 h-4 text-muted-foreground" />
										{:else}
											<ChevronRight class="w-4 h-4 text-muted-foreground" />
										{/if}
										<Tag class="w-4 h-4 text-primary" />
										<span class="font-semibold">v{release.version}</span>
										{#if index === 0}
											<Badge variant="default" class="text-2xs">最新</Badge>
										{/if}
										<Badge variant="secondary" class="text-2xs">{release.changes.length} 项更新</Badge>
									</div>
									<span class="text-xs text-muted-foreground">{formatChangelogDate(release.date)}</span>
								</div>
								{#if isExpanded}
									<div class="px-4 pb-4">
										<ul class="space-y-1.5 text-sm text-muted-foreground mb-3">
											{#each release.changes as change}
												<li class="flex items-start gap-2">
													{#if change.type === 'feature'}
														<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
															<Sparkles class="w-3 h-3" />
															新增
														</span>
													{:else if change.type === 'fix'}
														<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
															<Bug class="w-3 h-3" />
															修复
														</span>
													{/if}
													<span>{change.text}</span>
												</li>
											{/each}
										</ul>
										<div class="flex items-center gap-2 pt-2 border-t">
											<Badge variant="outline" class="text-2xs font-mono">{release.imageTag}</Badge>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</Tabs.Content>

			<Tabs.Content value="dependencies" class="px-4 pb-4">
				<div class="mb-3">
					<div class="relative w-full max-w-xs">
						<Search class="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
						<Input
							type="text"
							placeholder="搜索包名称或许可协议..."
							class="h-7 text-xs pl-7"
							bind:value={depsSearch}
						/>
					</div>
				</div>
				{#if loadingDeps}
					<div class="flex items-center justify-center py-8">
						<div class="text-sm text-muted-foreground">正在加载依赖项...</div>
					</div>
				{:else if depsError}
					<div class="flex items-center justify-center py-8">
						<div class="text-sm text-destructive">{depsError}</div>
					</div>
				{:else}
					<div class="space-y-1">
						<div class="grid grid-cols-[1fr_auto_auto_auto] gap-2 text-2xs font-medium text-muted-foreground px-2 py-1 border-b">
							<div>Package</div>
							<div class="w-20 text-center">版本</div>
							<div class="w-24 text-center">许可协议</div>
							<div class="w-8"></div>
						</div>
						<div class="max-h-[300px] overflow-y-auto">
							{#each filteredDeps as dep}
								<div class="grid grid-cols-[1fr_auto_auto_auto] gap-2 text-xs px-2 py-1.5 hover:bg-muted/50 rounded items-center">
									<div class="font-mono text-[11px] truncate" title={dep.name}>{dep.name}</div>
									<div class="w-20 text-center">
										<Badge variant="outline" class="text-2xs px-1 py-0 h-4 font-mono">{dep.version}</Badge>
									</div>
									<div class="w-24 text-center">
										<Badge variant="secondary" class="text-2xs px-1.5 py-0 h-4">{dep.license}</Badge>
									</div>
									<div class="w-8 flex justify-center">
										{#if dep.repository}
											<a
												href={dep.repository}
												target="_blank"
												rel="noopener noreferrer"
												class="text-muted-foreground hover:text-foreground transition-colors"
												title="在 GitHub 上查看"
											>
												<ExternalLink class="w-3.5 h-3.5" />
											</a>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</Tabs.Content>
		</Tabs.Root>
	</Card.Root>

</div>

<LicenseModal bind:open={showLicenseModal} />
<PrivacyModal bind:open={showPrivacyModal} />

{#if updateInfo}
	<SelfUpdateDialog
		bind:open={showSelfUpdateDialog}
		currentImage={updateInfo.currentImage}
		newImage={updateInfo.newImage}
		currentDigest={updateInfo.currentDigest}
		newDigest={updateInfo.newDigest}
		containerName={updateInfo.containerName}
		isComposeManaged={updateInfo.isComposeManaged}
		latestVersion={updateInfo.latestVersion}
		onclose={() => showSelfUpdateDialog = false}
	/>
{/if}
