<svelte:head>
	<title>模板库 - Dockhand</title>
</svelte:head>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import {
		LibraryBig,
		Search,
		RefreshCw,
		Loader2,
		Package,
		Settings2
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import type { TemplateItem } from '../api/templates/+server';
	import TemplateCard from './TemplateCard.svelte';
	import TemplateSourcesTab from './TemplateSourcesTab.svelte';
	import StackModal from '../stacks/StackModal.svelte';

	// State
	let templates = $state<TemplateItem[]>([]);
	let loading = $state(true);
	let searchQuery = $state('');
	let debouncedQuery = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let selectedCategories = $state<string[]>([]);
	let selectedSources = $state<string[]>([]);
	let activeTab = $state<'browse' | 'sources'>('browse');
	let loadingTemplateId = $state<string | null>(null);

	// Debounce search input
	$effect(() => {
		const q = searchQuery;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => { debouncedQuery = q; }, 200);
	});
	onDestroy(() => { if (debounceTimer) clearTimeout(debounceTimer); });

	// StackModal state
	let showStackModal = $state(false);
	let stackModalCompose = $state('');
	let stackModalName = $state('');

	// Client-side cache
	let cacheTimestamp = 0;
	const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

	// Derived
	let allCategories = $derived(
		[...new Set(templates.flatMap(t => t.categories))].sort()
	);
	let allSources = $derived(
		[...new Set(templates.map(t => t.source))]
	);

	let filteredTemplates = $derived(templates.filter(t => {
		const q = debouncedQuery.toLowerCase();
		const matchesSearch = !q ||
			t.title.toLowerCase().includes(q) ||
			t.description.toLowerCase().includes(q);
		const matchesCategory = selectedCategories.length === 0 ||
			t.categories.some(c => selectedCategories.includes(c));
		const matchesSource = selectedSources.length === 0 ||
			selectedSources.includes(t.source);
		return matchesSearch && matchesCategory && matchesSource;
	}));

	async function fetchTemplates(force = false) {
		if (!force && templates.length > 0 && Date.now() - cacheTimestamp < CACHE_TTL) {
			return;
		}

		loading = true;
		try {
			const response = await fetch('/api/templates');
			if (!response.ok) throw new Error('Failed to fetch');
			templates = await response.json();
			cacheTimestamp = Date.now();
		} catch {
			toast.error('加载模板库失败');
		} finally {
			loading = false;
		}
	}

	async function handleCardClick(template: TemplateItem) {
		loadingTemplateId = template.id;
		try {
			const response = await fetch('/api/templates/compose', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ template })
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || '生成 Compose 配置失败');
			}

			const { compose } = await response.json();
			stackModalName = template.title.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
			stackModalCompose = compose;
			showStackModal = true;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '加载模板失败');
		} finally {
			loadingTemplateId = null;
		}
	}

	function handleSourcesChanged() {
		fetchTemplates(true);
	}

	onMount(() => {
		fetchTemplates();
	});
</script>

<div class="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
	<!-- Header -->
	<div class="shrink-0 flex flex-wrap justify-between items-center gap-3 min-h-8">
		<PageHeader icon={LibraryBig} title="模板库" count={loading ? undefined : filteredTemplates.length} showConnection={false}>
			<button
				class="p-1 rounded hover:bg-muted transition-colors"
				onclick={() => fetchTemplates(true)}
				disabled={loading}
				title="刷新模板列表"
			>
				{#if loading}
					<Loader2 class="w-3.5 h-3.5 animate-spin text-emerald-500" />
				{:else}
					<RefreshCw class="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
				{/if}
			</button>
		</PageHeader>
		<div class="flex items-center gap-2">
			<!-- Tab toggle -->
			<div class="flex items-center gap-0.5 bg-zinc-200 dark:bg-zinc-700 rounded-md p-0.5">
				<button
					class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors {activeTab === 'browse' ? 'bg-white dark:bg-zinc-900 shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
					onclick={() => activeTab = 'browse'}
				>
					<Package class="w-3.5 h-3.5" />
					浏览
				</button>
				<button
					class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors {activeTab === 'sources' ? 'bg-white dark:bg-zinc-900 shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
					onclick={() => activeTab = 'sources'}
				>
					<Settings2 class="w-3.5 h-3.5" />
					模板源
				</button>
			</div>
		</div>
	</div>

	{#if activeTab === 'browse'}
		<!-- Filter bar -->
		<div class="shrink-0 flex flex-wrap items-center gap-2">
			<div class="relative">
				<Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="text"
					placeholder="搜索模板..."
					class="pl-9 w-64 h-8 text-sm"
					bind:value={searchQuery}
					onkeydown={(e) => e.key === 'Escape' && (searchQuery = '')}
				/>
			</div>

			<!-- Category filter -->
			{#if allCategories.length > 0}
				<Select.Root type="multiple" bind:value={selectedCategories}>
					<Select.Trigger size="sm" class="w-44 text-sm">
						<span class="truncate">
							{#if selectedCategories.length === 0}
								全部分类
							{:else if selectedCategories.length === 1}
								{selectedCategories[0]}
							{:else}
								已选 {selectedCategories.length} 个分类
							{/if}
						</span>
					</Select.Trigger>
					<Select.Content class="max-h-64 overflow-y-auto">
						{#each allCategories as category}
							<Select.Item value={category}>{category}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}

			<!-- Source filter -->
			{#if allSources.length > 1}
				<Select.Root type="multiple" bind:value={selectedSources}>
					<Select.Trigger size="sm" class="w-48 text-sm">
						<span class="truncate">
							{#if selectedSources.length === 0}
								全部模板源
							{:else if selectedSources.length === 1}
								{selectedSources[0]}
							{:else}
								已选 {selectedSources.length} 个模板源
							{/if}
						</span>
					</Select.Trigger>
					<Select.Content>
						{#each allSources as source}
							<Select.Item value={source}>{source}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			{/if}

			<!-- Active filter badges -->
			{#if selectedCategories.length > 0 || selectedSources.length > 0 || searchQuery}
				<Button
					size="sm"
					variant="ghost"
					class="text-xs"
					onclick={() => { selectedCategories = []; selectedSources = []; searchQuery = ''; }}
				>
					清空筛选条件
				</Button>
			{/if}
		</div>

		<!-- Card grid -->
		<div class="flex-1 overflow-y-auto min-h-0">
			{#if loading}
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-1">
					{#each Array(12) as _}
						<div class="rounded-xl border bg-card p-4 space-y-3">
							<div class="flex items-start gap-3">
								<Skeleton class="w-10 h-10 rounded-lg" />
								<div class="flex-1 space-y-2">
									<Skeleton class="h-4 w-3/4" />
									<Skeleton class="h-3 w-1/3" />
								</div>
							</div>
							<div class="space-y-1.5">
								<Skeleton class="h-3 w-full" />
								<Skeleton class="h-3 w-full" />
								<Skeleton class="h-3 w-2/3" />
							</div>
							<div class="flex gap-1.5">
								<Skeleton class="h-4 w-14 rounded-full" />
								<Skeleton class="h-4 w-16 rounded-full" />
							</div>
						</div>
					{/each}
				</div>
			{:else if filteredTemplates.length === 0}
				<div class="flex items-center justify-center h-full">
					<EmptyState
						icon={Package}
						title={templates.length === 0 ? '未配置任何模板源' : '没有匹配筛选条件的模板'}
						description={templates.length === 0 ? '切换至「模板源」标签页启用模板仓库' : '尝试修改搜索关键词或筛选条件'}
					/>
				</div>
			{:else}
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-1">
					{#each filteredTemplates as template (template.id)}
						<TemplateCard
							{template}
							loading={loadingTemplateId === template.id}
							onclick={() => handleCardClick(template)}
						/>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<!-- Sources tab -->
		<div class="flex-1 overflow-y-auto min-h-0 p-1">
			<TemplateSourcesTab onSourcesChanged={handleSourcesChanged} />
		</div>
	{/if}
</div>

<!-- StackModal for deploying templates -->
<StackModal
	bind:open={showStackModal}
	mode="create"
	initialCompose={stackModalCompose}
	initialStackName={stackModalName}
	onClose={() => showStackModal = false}
	onSuccess={() => {
		showStackModal = false;
		toast.success('已通过模板库部署堆栈');
	}}
/>
