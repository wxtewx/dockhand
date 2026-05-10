<svelte:head>
	<title>镜像仓库 - Dockhand</title>
</svelte:head>

<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Search, Download, Star, RefreshCw, Settings2, List, Play, Copy, Clipboard, Check, Server, Icon, ChevronRight, ChevronDown, Loader2, Tag, Calendar, HardDrive, Trash2 } from 'lucide-svelte';
	import ConfirmPopover from '$lib/components/ConfirmPopover.svelte';
	import { toast } from 'svelte-sonner';
	import { whale } from '@lucide/lab';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import CreateContainerModal from '../containers/CreateContainerModal.svelte';
	import ImagePullModal from '$lib/components/ImagePullModal.svelte';
	import CopyToRegistryModal from './CopyToRegistryModal.svelte';
	import { canAccess } from '$lib/stores/auth';
	import { currentEnvironment, appendEnvParam } from '$lib/stores/environment';
	import PageHeader from '$lib/components/PageHeader.svelte';

	interface Registry {
		id: number;
		name: string;
		url: string;
		username?: string;
		hasCredentials: boolean;
		is_default: boolean;
	}

	interface SearchResult {
		name: string;
		description: string;
		star_count: number;
		is_official: boolean;
		is_automated: boolean;
	}

	interface TagInfo {
		name: string;
		size?: number;
		lastUpdated?: string;
		digest?: string;
	}

	interface ExpandedImageState {
		loading: boolean;
		loadingMore: boolean;
		error: string;
		tags: TagInfo[];
		total: number;
		page: number;
		pageSize: number;
		hasNext: boolean;
	}

	let registries = $state<Registry[]>([]);
	let expandedImages = $state<Record<string, ExpandedImageState>>({});
	let selectedRegistryId = $state<number | null>(null);

	let searchTerm = $state('');
	let browseFilter = $state('');
	let results = $state<SearchResult[]>([]);
	let loading = $state(false);
	let browsing = $state(false);
	let loadingMore = $state(false);
	let searched = $state(false);
	let browseMode = $state(false);
	let errorMessage = $state('');

	// Pagination state for browse mode
	let hasMoreResults = $state(false);
	let nextPageCursor = $state<string | null>(null);

	// Filtered results for browse mode
	let filteredResults = $derived(
		browseMode && browseFilter.trim()
			? results.filter(r => r.name.toLowerCase().includes(browseFilter.toLowerCase()))
			: results
	);

	// Copy to registry modal state
	let showCopyModal = $state(false);
	let copyImageName = $state('');
	let copyImageTag = $state('latest');

	// Run modal state
	let showRunModal = $state(false);
	let runImageName = $state('');

	// Pull modal state
	let showPullModal = $state(false);
	let pullImageName = $state('');

	// Scanner settings - scanning enabled if scanner is configured
	let envHasScanning = $state(false);

	// Delete confirmation state
	let confirmDeleteKey = $state<string | null>(null);
	let deleting = $state(false);


	let scrollContainer: HTMLDivElement | undefined;

	let selectedRegistry = $derived(registries.find(r => r.id === selectedRegistryId));

	// Check if a registry is Docker Hub
	function isDockerHub(registry: Registry): boolean {
		const url = registry.url.toLowerCase();
		return url.includes('docker.io') ||
			   url.includes('hub.docker.com') ||
			   url.includes('registry.hub.docker.com');
	}

	// Check if registry supports browsing (not Docker Hub)
	let supportsBrowsing = $derived(() => {
		if (!selectedRegistry) return false;
		return !isDockerHub(selectedRegistry);
	});

	// Get registries that can be pushed to (exclude Docker Hub and source registry)
	let pushableRegistries = $derived(registries.filter(r => {
		return !isDockerHub(r) && r.id !== selectedRegistryId;
	}));

	async function fetchRegistries() {
		try {
			const response = await fetch('/api/registries');
			registries = await response.json();
			if (!selectedRegistryId && registries.length > 0) {
				const defaultRegistry = registries.find(r => r.is_default);
				selectedRegistryId = defaultRegistry?.id ?? registries[0].id;
			}
		} catch (error) {
			console.error('获取镜像仓库失败:', error);
		}
	}

	async function fetchScannerSettings(envId?: number | null) {
		try {
			const url = envId ? `/api/settings/scanner?env=${envId}&settingsOnly=true` : '/api/settings/scanner?settingsOnly=true';
			const response = await fetch(url);
			if (response.ok) {
				const data = await response.json();
				const scanner = data.settings?.scanner ?? 'none';
				// Scanning is enabled if a scanner is configured
				envHasScanning = scanner !== 'none';
			}
		} catch (error) {
			console.error('获取扫描器设置失败:', error);
		}
	}

	// Re-fetch scanner settings when environment changes
	$effect(() => {
		const envId = $currentEnvironment?.id;
		fetchScannerSettings(envId);
	});

	async function search() {
		if (!searchTerm.trim()) return;

		loading = true;
		searched = true;
		browseMode = false;
		errorMessage = '';
		try {
			let url = `/api/registry/search?term=${encodeURIComponent(searchTerm)}`;
			if (selectedRegistryId) {
				url += `&registry=${selectedRegistryId}`;
			}
			if ($currentEnvironment?.id) {
				url += `&env=${$currentEnvironment.id}`;
			}
			const response = await fetch(url);
			if (response.ok) {
				results = await response.json();
			} else {
				const data = await response.json();
				errorMessage = data.error || '搜索失败';
				results = [];
			}
		} catch (error) {
			console.error('搜索镜像失败:', error);
			errorMessage = '搜索镜像失败';
			results = [];
		} finally {
			loading = false;
		}
	}

	async function browse(loadMore = false) {
		if (!selectedRegistryId) return;

		if (loadMore) {
			loadingMore = true;
		} else {
			browsing = true;
			searched = true;
			browseMode = true;
			results = [];
			hasMoreResults = false;
			nextPageCursor = null;
		}
		errorMessage = '';

		try {
			let url = `/api/registry/catalog?registry=${selectedRegistryId}`;
			if (loadMore && nextPageCursor) {
				url += `&last=${encodeURIComponent(nextPageCursor)}`;
			}

			const response = await fetch(url);
			if (response.ok) {
				const data = await response.json();

				// Handle both old array format and new paginated format
				if (Array.isArray(data)) {
					// Old format (backwards compat)
					results = loadMore ? [...results, ...data] : data;
					hasMoreResults = false;
					nextPageCursor = null;
				} else {
					// New paginated format
					const newResults = data.repositories || [];
					results = loadMore ? [...results, ...newResults] : newResults;
					hasMoreResults = data.pagination?.hasMore || false;
					nextPageCursor = data.pagination?.nextLast || null;
				}
			} else {
				const data = await response.json();
				errorMessage = data.error || '浏览仓库失败';
				if (!loadMore) {
					results = [];
				}
			}
		} catch (error) {
			console.error('浏览镜像仓库失败:', error);
			errorMessage = '浏览仓库失败';
			if (!loadMore) {
				results = [];
			}
		} finally {
			browsing = false;
			loadingMore = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			search();
		}
	}


	function buildFullImageName(name: string): string {
		// Build full image name with registry prefix if applicable
		if (selectedRegistry && supportsBrowsing()) {
			// Extract host from URL (e.g., "https://registry.example.com" -> "registry.example.com")
			const urlObj = new URL(selectedRegistry.url);
			return `${urlObj.host}/${name}`;
		}
		return name;
	}

	function handleRegistryChange() {
		// Clear results when registry changes
		results = [];
		searched = false;
		browseMode = false;
		browseFilter = '';
		errorMessage = '';
		expandedImages = {};
		hasMoreResults = false;
		nextPageCursor = null;
	}

	async function toggleImageExpansion(imageName: string) {
		if (expandedImages[imageName]) {
			// Collapse
			const { [imageName]: _, ...rest } = expandedImages;
			expandedImages = rest;
		} else {
			// Expand and fetch first page
			await fetchTagsPage(imageName, 1, true);
		}
	}

	async function loadMoreTags(imageName: string) {
		const state = expandedImages[imageName];
		if (!state || state.loading || state.loadingMore || !state.hasNext) return;
		await fetchTagsPage(imageName, state.page + 1, false);
	}

	async function fetchTagsPage(imageName: string, page: number, isFirstLoad: boolean) {
		const currentState = expandedImages[imageName];

		expandedImages = {
			...expandedImages,
			[imageName]: {
				loading: isFirstLoad,
				loadingMore: !isFirstLoad,
				error: '',
				tags: currentState?.tags || [],
				total: currentState?.total || 0,
				page: currentState?.page || 0,
				pageSize: 20,
				hasNext: currentState?.hasNext || false
			}
		};

		try {
			let url = `/api/registry/tags?image=${encodeURIComponent(imageName)}&page=${page}&pageSize=20`;
			if (selectedRegistryId) {
				url += `&registry=${selectedRegistryId}`;
			}

			const response = await fetch(url);
			if (response.ok) {
				const data = await response.json();
				const prevState = expandedImages[imageName];
				const existingTags = isFirstLoad ? [] : (prevState?.tags || []);
				expandedImages = {
					...expandedImages,
					[imageName]: {
						loading: false,
						loadingMore: false,
						error: '',
						tags: [...existingTags, ...data.tags],
						total: data.total,
						page: data.page,
						pageSize: data.pageSize,
						hasNext: data.hasNext
					}
				};
			} else {
				const data = await response.json();
				expandedImages = {
					...expandedImages,
					[imageName]: {
						...expandedImages[imageName],
						loading: false,
						loadingMore: false,
						error: data.error || '获取标签失败'
					}
				};
			}
		} catch (error: any) {
			expandedImages = {
				...expandedImages,
				[imageName]: {
					...expandedImages[imageName],
					loading: false,
					loadingMore: false,
					error: error.message || '获取标签失败'
				}
			};
		}
	}

	function handleTagsWheel(event: WheelEvent, imageName: string) {
		const target = event.currentTarget as HTMLElement;

		// Prevent page scroll when at top/bottom of tags list
		const atTop = target.scrollTop === 0;
		const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 1;

		if ((atTop && event.deltaY < 0) || (atBottom && event.deltaY > 0)) {
			event.preventDefault();
		}

		// Load more when near bottom
		const state = expandedImages[imageName];
		if (!state || !state.hasNext || state.loading || state.loadingMore) return;

		if (target.scrollHeight - target.scrollTop - target.clientHeight < 50) {
			loadMoreTags(imageName);
		}
	}

	function formatBytes(bytes?: number): string {
		if (!bytes) return '-';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
	}

	function formatDate(dateStr?: string): string {
		if (!dateStr) return '-';
		const date = new Date(dateStr);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return '今天';
		if (diffDays === 1) return '昨天';
		if (diffDays < 7) return `${diffDays} 天前`;
		if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;
		if (diffDays < 365) return `${Math.floor(diffDays / 30)} 个月前`;
		return `${Math.floor(diffDays / 365)} 年前`;
	}

	function openCopyModal(imageName: string, tag?: string) {
		// Build full image name with registry prefix (no tag - modal handles that)
		copyImageName = buildFullImageName(imageName);
		copyImageTag = tag || 'latest';
		showCopyModal = true;
	}

	function openRunModal(imageName: string, tag?: string) {
		// Build full image name with registry prefix if applicable
		const imageWithTag = tag ? `${imageName}:${tag}` : imageName;
		if (selectedRegistry && supportsBrowsing()) {
			const urlObj = new URL(selectedRegistry.url);
			runImageName = `${urlObj.host}/${imageWithTag}`;
		} else {
			runImageName = imageWithTag;
		}
		showRunModal = true;
	}

	function openPullModal(imageName: string, tag?: string) {
		// Build full image name with registry prefix if applicable
		const imageWithTag = tag ? `${imageName}:${tag}` : imageName;
		pullImageName = buildFullImageName(imageWithTag);
		showPullModal = true;
	}

	async function deleteTag(imageName: string, tag: string) {
		if (!selectedRegistryId) return;

		deleting = true;
		try {
			const response = await fetch(`/api/registry/image?registry=${selectedRegistryId}&image=${encodeURIComponent(imageName)}&tag=${encodeURIComponent(tag)}`, {
				method: 'DELETE'
			});

			if (response.ok) {
				toast.success(`已删除 ${imageName}:${tag}`);
				// Refresh tags for this image
				const state = expandedImages[imageName];
				if (state) {
					expandedImages = {
						...expandedImages,
						[imageName]: {
							...state,
							tags: state.tags.filter(t => t.name !== tag),
							total: Math.max(0, state.total - 1)
						}
					};
				}
			} else {
				const data = await response.json();
				toast.error(data.error || '删除镜像失败');
			}
		} catch (error: any) {
			toast.error(error.message || '删除镜像失败');
		} finally {
			deleting = false;
			confirmDeleteKey = null;
		}
	}

	function getTypeClasses(type: string): string {
		const base = 'text-xs px-1.5 py-0.5 rounded-sm font-medium inline-block w-14 text-center';
		switch (type) {
			case 'official':
				return `${base} bg-emerald-200 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100`;
			case 'automated':
				return `${base} bg-sky-200 dark:bg-sky-800 text-sky-900 dark:text-sky-100`;
			default:
				return `${base} bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300`;
		}
	}

	onMount(() => {
		// Only fetch registries if user has permission
		if ($canAccess('registries', 'view')) {
			fetchRegistries();
		}
	});
</script>

<div class="h-full flex flex-col gap-3 overflow-hidden">
	<div class="shrink-0 flex flex-wrap justify-between items-center gap-3 min-h-8">
		<PageHeader icon={Download} title="镜像仓库" showConnection={false} />
		{#if $canAccess('registries', 'edit')}
		<a href="/settings?tab=registries" class="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-8 rounded-md px-3 text-xs">
			<Settings2 class="w-4 h-4" />
			管理仓库
		</a>
		{/if}
	</div>

	<!-- Registry Selector + Search Bar -->
	<div class="shrink-0 flex gap-2">
		<Select.Root type="single" value={selectedRegistryId ? String(selectedRegistryId) : undefined} onValueChange={(v) => { selectedRegistryId = Number(v); handleRegistryChange(); }}>
			<Select.Trigger class="h-9 min-w-48 max-w-64 shrink-0">
				{@const selected = registries.find(r => r.id === selectedRegistryId)}
				{#if selected && isDockerHub(selected)}
					<Icon iconNode={whale} class="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
				{:else}
					<Server class="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
				{/if}
				<span class="truncate">{selected ? selected.name : '选择仓库'}</span>
				{#if selected?.hasCredentials}
					<Badge variant="outline" class="ml-1.5 text-xs shrink-0">已认证</Badge>
				{/if}
			</Select.Trigger>
			<Select.Content>
				{#each registries as registry}
					<Select.Item value={String(registry.id)} label={registry.name}>
						{#if isDockerHub(registry)}
							<Icon iconNode={whale} class="w-4 h-4 mr-2 text-muted-foreground" />
						{:else}
							<Server class="w-4 h-4 mr-2 text-muted-foreground" />
						{/if}
						{registry.name}
						{#if registry.hasCredentials}
							<Badge variant="outline" class="ml-2 text-xs">已认证</Badge>
						{/if}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		<div class="relative flex-1">
			<Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
			<Input
				type="text"
				placeholder={selectedRegistry ? `在 ${selectedRegistry.name} 中搜索镜像...` : '搜索镜像...'}
				bind:value={searchTerm}
				onkeydown={handleKeydown}
				class="pl-10"
			/>
		</div>
		<Button onclick={search} disabled={loading || browsing || !searchTerm.trim()}>
			{#if loading}
				<RefreshCw class="w-4 h-4 mr-1 animate-spin" />
			{:else}
				<Search class="w-4 h-4" />
			{/if}
			搜索
		</Button>
		{#if supportsBrowsing()}
			<Button variant="outline" onclick={() => browse()} disabled={loading || browsing}>
				{#if browsing}
					<RefreshCw class="w-4 h-4 mr-1 animate-spin" />
				{:else}
					<List class="w-4 h-4" />
				{/if}
				浏览
			</Button>
		{/if}
	</div>

	<!-- Results -->
	{#if loading || browsing}
		<p class="text-muted-foreground text-sm">{browsing ? '正在加载目录...' : '正在搜索...'}</p>
	{:else if errorMessage}
		<p class="text-red-600 dark:text-red-400 text-sm">{errorMessage}</p>
	{:else if searched && results.length === 0}
		<div class="text-sm">
			<p class="text-muted-foreground">
				{browseMode ? '该仓库中未找到镜像' : `未找到 "${searchTerm}" 相关镜像`}
			</p>
			{#if !browseMode && supportsBrowsing()}
				<p class="text-muted-foreground mt-2">
					提示：大型仓库不支持搜索。请尝试 <button class="text-primary underline" onclick={() => browse()}>浏览</button> 并使用筛选器查找镜像。
				</p>
			{/if}
		</div>
	{:else if results.length > 0}
		<!-- Browse mode filter -->
		{#if browseMode}
			<div class="shrink-0 flex items-center gap-2 text-sm">
				<div class="relative flex-1 max-w-xs">
					<Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
					<Input
						type="text"
						placeholder="筛选结果..."
						bind:value={browseFilter}
						class="h-8 pl-8 text-xs"
					/>
				</div>
				<span class="text-muted-foreground text-xs">
					{filteredResults.length === results.length
						? `${results.length} 个镜像`
						: `共 ${results.length} 个，显示 ${filteredResults.length} 个`}
				</span>
			</div>
		{/if}
		<div
			bind:this={scrollContainer}
			class="flex-1 min-h-0 rounded-lg overflow-auto"
		>
			<table class="w-full text-sm">
				<thead class="bg-muted sticky top-0 z-10">
					<tr class="border-b">
						<th class="text-left py-1.5 px-2 font-medium">名称</th>
						{#if !browseMode}
							<th class="text-left py-1.5 px-2 font-medium">描述</th>
							<th class="text-center py-1.5 px-2 font-medium w-16">星标</th>
							<th class="text-center py-1.5 px-2 font-medium w-20">类型</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each filteredResults as result (result.name)}
						{@const isExpanded = !!expandedImages[result.name]}
						{@const expandState = expandedImages[result.name]}
						<!-- Main row -->
						<tr
							class="border-b border-muted hover:bg-muted/30 transition-colors cursor-pointer"
							onclick={() => toggleImageExpansion(result.name)}
						>
							<td class="py-1.5 px-2">
								<div class="flex items-center gap-1.5">
									{#if isExpanded}
										<ChevronDown class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
									{:else}
										<ChevronRight class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
									{/if}
									<code class="text-xs">{result.name}</code>
								</div>
							</td>
							{#if !browseMode}
								<td class="py-1.5 px-2">
									<span class="text-xs text-muted-foreground line-clamp-1" title={result.description}>
										{result.description || '-'}
									</span>
								</td>
								<td class="py-1.5 px-2 text-center">
									<div class="flex items-center justify-center gap-1">
										<Star class="w-3 h-3 text-yellow-500" />
										<span class="text-xs">{result.star_count.toLocaleString()}</span>
									</div>
								</td>
								<td class="py-1.5 px-2 text-center">
									{#if result.is_official}
										<span class={getTypeClasses('official')}>官方</span>
									{:else if result.is_automated}
										<span class={getTypeClasses('automated')}>自动</span>
									{:else}
										<span class="text-muted-foreground text-xs">-</span>
									{/if}
								</td>
							{/if}
						</tr>
						<!-- Expanded tags row -->
						{#if isExpanded}
							<tr class="border-b border-muted bg-muted/20">
								<td colspan={browseMode ? 1 : 4} class="py-2 px-2 pl-8">
									{#if expandState?.loading}
										<div class="flex items-center gap-2 text-xs text-muted-foreground py-2">
											<Loader2 class="w-3.5 h-3.5 animate-spin" />
											<span>正在加载标签...</span>
										</div>
									{:else if expandState?.error}
										<div class="text-xs text-red-500 py-2">
											{expandState.error}
										</div>
									{:else if expandState?.tags && expandState.tags.length > 0}
										<div class="max-h-64 overflow-y-auto overscroll-contain" onwheel={(e) => handleTagsWheel(e, result.name)}>
											<table class="text-xs">
												<thead class="text-muted-foreground sticky top-0 bg-background z-10">
													<tr>
														<th class="text-left py-1 px-2 pr-4 font-medium">标签</th>
														<th class="text-left py-1 px-2 pr-4 font-medium">大小</th>
														<th class="text-left py-1 px-2 pr-4 font-medium">更新时间</th>
														<th class="text-left py-1 px-2 font-medium">操作</th>
													</tr>
												</thead>
												<tbody>
													{#each expandState.tags as tag}
														<tr class="hover:bg-muted/30 transition-colors">
															<td class="py-1 px-2 pr-4">
																<div class="flex items-center gap-1.5">
																	<Tag class="w-3 h-3 text-muted-foreground shrink-0" />
																	<code class="font-medium">{tag.name}</code>
																</div>
															</td>
															<td class="py-1 px-2 pr-4 text-muted-foreground whitespace-nowrap">
																{formatBytes(tag.size)}
															</td>
															<td class="py-1 px-2 pr-4 text-muted-foreground whitespace-nowrap">
																{formatDate(tag.lastUpdated)}
															</td>
															<td class="py-1 px-2">
																<div class="flex items-center gap-1">
																	<button
																		onclick={() => openPullModal(result.name, tag.name)}
																		title={envHasScanning ? "拉取并扫描此标签" : "拉取此标签"}
																		class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted transition-colors whitespace-nowrap"
																	>
																		<Download class="w-3 h-3 text-muted-foreground" />
																		<span class="text-muted-foreground">{envHasScanning ? '拉取并扫描' : '拉取'}</span>
																	</button>
																	<button
																		onclick={() => openRunModal(result.name, tag.name)}
																		title="使用此标签运行容器"
																		class="p-1 rounded hover:bg-muted transition-colors"
																	>
																		<Play class="w-3 h-3 text-muted-foreground hover:text-foreground" />
																	</button>
																	{#if pushableRegistries.length > 0}
																		<button
																			onclick={() => openCopyModal(result.name, tag.name)}
																			title="复制到其他仓库"
																			class="p-1 rounded hover:bg-muted transition-colors"
																		>
																			<Copy class="w-3 h-3 text-muted-foreground hover:text-foreground" />
																		</button>
																	{/if}
																	{#if supportsBrowsing()}
																		{@const deleteKey = `${result.name}:${tag.name}`}
																		<ConfirmPopover
																			title="删除标签"
																			description="确定要删除 {result.name}:{tag.name} 吗？此操作无法撤销。"
																			confirmText="删除"
																			open={confirmDeleteKey === deleteKey}
																			onConfirm={() => deleteTag(result.name, tag.name)}
																			onOpenChange={(open) => confirmDeleteKey = open ? deleteKey : null}
																		>
																			<button
																				title="删除此标签"
																				class="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
																				disabled={deleting}
																			>
																				<Trash2 class="w-3 h-3 text-muted-foreground hover:text-red-600 dark:hover:text-red-400" />
																			</button>
																		</ConfirmPopover>
																	{/if}
																</div>
															</td>
														</tr>
													{/each}
												</tbody>
											</table>
											<!-- Loading more indicator -->
											{#if expandState.loadingMore}
												<div class="flex items-center justify-center py-2 text-xs text-muted-foreground">
													<Loader2 class="w-3 h-3 animate-spin mr-2" />
													正在加载更多...
												</div>
											{/if}
										</div>
										<!-- Tags count -->
										{#if expandState.total > 0}
											<div class="text-xs text-muted-foreground pt-1">
												已加载 {expandState.tags.length} / {expandState.total} 个标签
											</div>
										{/if}
									{:else}
										<div class="text-xs text-muted-foreground py-2">
											未找到标签
										</div>
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
		<!-- Load More button for pagination (outside scroll container so always visible) -->
		{#if browseMode && hasMoreResults}
			<div class="shrink-0 flex justify-center py-3 border-t border-muted">
				<Button
					variant="outline"
					size="sm"
					onclick={() => browse(true)}
					disabled={loadingMore}
				>
					{#if loadingMore}
						<Loader2 class="w-4 h-4 mr-2 animate-spin" />
						加载中...
					{:else}
						加载更多镜像
					{/if}
				</Button>
			</div>
		{/if}
	{:else}
		<div class="text-center py-12 text-muted-foreground">
			<Download class="w-12 h-12 mx-auto mb-4 opacity-50" />
			<p class="text-sm">
				{#if supportsBrowsing()}
					搜索或浏览 {selectedRegistry?.name || '镜像仓库'} 以查找镜像
				{:else}
					搜索 {selectedRegistry?.name || '镜像仓库'} 以查找和拉取镜像
				{/if}
			</p>
		</div>
	{/if}
</div>

<!-- Copy to Registry Modal -->
<CopyToRegistryModal
	bind:open={showCopyModal}
	imageName={copyImageName}
	initialTag={copyImageTag}
	registries={registries}
	sourceRegistryId={selectedRegistryId}
/>

<!-- Create Container Modal -->
<CreateContainerModal bind:open={showRunModal} prefilledImage={runImageName} autoPull={true} />

<!-- Pull/Scan Modal -->
<ImagePullModal
	bind:open={showPullModal}
	imageName={pullImageName}
	envId={$currentEnvironment?.id}
	envHasScanning={envHasScanning}
	showDeleteButton={true}
/>
