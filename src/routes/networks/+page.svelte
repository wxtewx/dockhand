<svelte:head>
	<title>网络 - Dockhand</title>
</svelte:head>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import MultiSelectFilter from '$lib/components/MultiSelectFilter.svelte';
	import { Trash2, Search, Plus, Eye, Check, XCircle, RefreshCw, Icon, AlertTriangle, X, Network, Link, Copy, CopyPlus, Share2, Server, Globe, MonitorSmartphone, Cpu, CircleOff } from 'lucide-svelte';
	import { broom } from '@lucide/lab';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import ConfirmPopover from '$lib/components/ConfirmPopover.svelte';
	import BatchOperationModal from '$lib/components/BatchOperationModal.svelte';
	import NetworkInspectModal from './NetworkInspectModal.svelte';
	import ConnectContainerModal from './ConnectContainerModal.svelte';
	import type { NetworkInfo } from '$lib/types';
	import { currentEnvironment, environments, appendEnvParam, clearStaleEnvironment } from '$lib/stores/environment';
	import { onDockerEvent, isNetworkListChange } from '$lib/stores/events';
	import CreateNetworkModal from './CreateNetworkModal.svelte';
	import { canAccess } from '$lib/stores/auth';
	import { EmptyState, NoEnvironment } from '$lib/components/ui/empty-state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { DataGrid } from '$lib/components/data-grid';
	import { ipToNumber } from '$lib/utils/ip';
	import { getLabelText } from '$lib/types';

	type SortField = 'name' | 'driver' | 'containers' | 'subnet' | 'gateway';
	type SortDirection = 'asc' | 'desc';

	let networks = $state<NetworkInfo[]>([]);
	let loading = $state(true);
	let envId = $state<number | null>(null);

	// Polling interval - module scope for cleanup in onDestroy
	let refreshInterval: ReturnType<typeof setInterval> | null = null;
	let unsubscribeDockerEvent: (() => void) | null = null;

	// Search and sort state - with debounce
	let searchInput = $state('');
	let searchQuery = $state('');
	let sortField = $state<SortField>('name');
	let sortDirection = $state<SortDirection>('asc');

	// Filter state
	let selectedDrivers = $state<string[]>([]);
	let selectedScopes = $state<string[]>([]);

	// Icon and color mappings for drivers
	const driverIconMap: Record<string, { icon: any; color: string }> = {
		bridge: { icon: Share2, color: 'text-emerald-500' },
		host: { icon: Server, color: 'text-sky-500' },
		overlay: { icon: Globe, color: 'text-violet-500' },
		macvlan: { icon: MonitorSmartphone, color: 'text-amber-500' },
		ipvlan: { icon: Cpu, color: 'text-orange-500' },
		none: { icon: CircleOff, color: 'text-muted-foreground' },
		null: { icon: CircleOff, color: 'text-muted-foreground' }
	};

	// Icon and color mappings for scopes
	const scopeIconMap: Record<string, { icon: any; color: string }> = {
		local: { icon: Server, color: 'text-sky-500' },
		swarm: { icon: Globe, color: 'text-violet-500' },
		global: { icon: Globe, color: 'text-violet-500' }
	};

	// Available filter options (derived from current networks) - with icons
	const driverOptions = $derived(
		[...new Set(networks.map(n => n.driver))].sort().map(d => {
			const mapping = driverIconMap[d] || { icon: Network, color: 'text-muted-foreground' };
			return { value: d, label: d, icon: mapping.icon, color: mapping.color };
		})
	);
	const scopeOptions = $derived(
		[...new Set(networks.map(n => n.scope))].sort().map(s => {
			const mapping = scopeIconMap[s] || { icon: Network, color: 'text-muted-foreground' };
			return { value: s, label: s, icon: mapping.icon, color: mapping.color };
		})
	);

	// Modal state
	let showCreateModal = $state(false);
	let showInspectModal = $state(false);
	let showConnectModal = $state(false);
	let inspectNetworkId = $state('');
	let inspectNetworkName = $state('');
	let connectNetwork = $state<NetworkInfo | null>(null);

	// Disconnect confirmation state
	let confirmDisconnectId = $state<string | null>(null);
	let disconnectingContainerId = $state<string | null>(null);

	// Confirmation popover state
	let confirmDeleteId = $state<string | null>(null);

	// Operation error state
	let deleteError = $state<{ id: string; message: string } | null>(null);

	// Timeout tracking for cleanup
	let pendingTimeouts: ReturnType<typeof setTimeout>[] = [];

	function clearErrorAfterDelay(id: string) {
		const timeoutId = setTimeout(() => {
			if (deleteError?.id === id) deleteError = null;
		}, 5000);
		pendingTimeouts.push(timeoutId);
	}

	// Prune state
	let confirmPrune = $state(false);
	let pruneStatus = $state<'idle' | 'pruning' | 'success' | 'error'>('idle');

	// Multi-select state
	let selectedNetworks = $state<Set<string>>(new Set());
	let confirmBulkRemove = $state(false);

	// Row highlighting state
	let highlightedRowId = $state<string | null>(null);

	// Batch operation modal state
	let showBatchOpModal = $state(false);
	let batchOpTitle = $state('');
	let batchOpOperation = $state('');
	let batchOpItems = $state<Array<{ id: string; name: string }>>([]);

	function bulkRemove() {
		batchOpTitle = `Removing ${selectedInFilter.length} network${selectedInFilter.length !== 1 ? 's' : ''}`;
		batchOpOperation = 'remove';
		batchOpItems = selectedInFilter.map(n => ({ id: n.id, name: n.name }));
		showBatchOpModal = true;
	}

	function handleBatchComplete() {
		selectedNetworks = new Set();
		fetchNetworks();
	}

	// Debounce search input
	let searchTimeout: ReturnType<typeof setTimeout>;
	$effect(() => {
		const input = searchInput; // Track dependency
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			searchQuery = input;
		}, 200);
		return () => clearTimeout(searchTimeout);
	});

	// Track if initial fetch has been done
	let initialFetchDone = $state(false);

	// Subscribe to environment changes using $effect
	$effect(() => {
		const env = $currentEnvironment;
		const newEnvId = env?.id ?? null;

		// Only fetch if environment actually changed or this is initial load
		if (env && (newEnvId !== envId || !initialFetchDone)) {
			envId = newEnvId;
			initialFetchDone = true;
			fetchNetworks();
		} else if (!env) {
			// No environment - clear data and stop loading
			envId = null;
			networks = [];
			loading = false;
		}
	});

	// Built-in Docker networks that shouldn't be removed
	const protectedNetworks = ['bridge', 'host', 'none'];

	// Get subnet from network
	function getNetworkSubnet(net: NetworkInfo): string | undefined {
		return net.ipam?.config?.[0]?.subnet;
	}

	// Get gateway from network
	function getNetworkGateway(net: NetworkInfo): string | undefined {
		return net.ipam?.config?.[0]?.gateway;
	}

	// Filtered and sorted networks - use $derived.by for complex logic
	const filteredNetworks = $derived.by(() => {
		let result = networks;

		// Filter by driver
		if (selectedDrivers.length > 0) {
			result = result.filter(net => selectedDrivers.includes(net.driver));
		}

		// Filter by scope
		if (selectedScopes.length > 0) {
			result = result.filter(net => selectedScopes.includes(net.scope));
		}

		// Filter by search query (includes name, driver, and container names)
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(net => {
				// Search in network name
				if (net.name.toLowerCase().includes(query)) return true;
				// Search in driver
				if (net.driver.toLowerCase().includes(query)) return true;
				// Search in container names
				const containerNames = Object.values(net.containers || {}).map(c => c.Name?.toLowerCase() || '');
				if (containerNames.some(name => name.includes(query))) return true;
				return false;
			});
		}

		// Sort
		result = [...result].sort((a, b) => {
			let cmp = 0;
			switch (sortField) {
				case 'name':
					cmp = a.name.localeCompare(b.name);
					break;
				case 'driver':
					cmp = a.driver.localeCompare(b.driver);
					break;
				case 'containers':
					cmp = Object.keys(a.containers || {}).length - Object.keys(b.containers || {}).length;
					break;
				case 'subnet':
					cmp = ipToNumber(getNetworkSubnet(a)) - ipToNumber(getNetworkSubnet(b));
					break;
				case 'gateway':
					cmp = ipToNumber(getNetworkGateway(a)) - ipToNumber(getNetworkGateway(b));
					break;
			}
			// Secondary sort by name for stability when primary values are equal
			if (cmp === 0 && sortField !== 'name') {
				cmp = a.name.localeCompare(b.name);
			}
			return sortDirection === 'asc' ? cmp : -cmp;
		});

		return result;
	});

	// Selection helpers for the selection bar (must be after filteredNetworks)
	const selectableNetworks = $derived(filteredNetworks.filter(n => !protectedNetworks.includes(n.name)));
	const selectedInFilter = $derived(
		selectableNetworks.filter(n => selectedNetworks.has(n.id))
	);

	function selectNone() {
		selectedNetworks = new Set();
	}

	async function fetchNetworks() {
		loading = true;
		try {
			const response = await fetch(appendEnvParam('/api/networks', envId));
			if (!response.ok) {
				// Handle stale environment ID (e.g., after database reset)
				if (response.status === 404 && envId) {
					clearStaleEnvironment(envId);
					environments.refresh();
					return;
				}
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			networks = await response.json();
		} catch (error) {
			console.error('获取网络失败:', error);
			toast.error('加载网络失败');
		} finally {
			loading = false;
		}
	}

	async function removeNetwork(id: string, name: string) {
		deleteError = null;
		if (protectedNetworks.includes(name)) {
			deleteError = { id, message: `无法删除内置网络 "${name}"` };
			toast.error(`无法删除内置网络 "${name}"`);
			clearErrorAfterDelay(id);
			return;
		}
		try {
			const response = await fetch(appendEnvParam(`/api/networks/${id}`, envId), { method: 'DELETE' });
			if (!response.ok) {
				const data = await response.json();
				deleteError = { id, message: data.details || '删除网络失败' };
				toast.error(`删除 ${name} 失败`);
				clearErrorAfterDelay(id);
				return;
			}
			toast.success(`已删除 ${name}`);
			await fetchNetworks();
		} catch (error) {
			console.error('删除网络失败:', error);
			deleteError = { id, message: '删除网络失败' };
			toast.error(`删除 ${name} 失败`);
			clearErrorAfterDelay(id);
		}
	}

	function getSubnet(network: NetworkInfo): string {
		const config = network.ipam?.config?.[0];
		return config?.subnet || '-';
	}

	function getGateway(network: NetworkInfo): string {
		const config = network.ipam?.config?.[0];
		return config?.gateway || '-';
	}

	function getContainerCount(network: NetworkInfo): number {
		return Object.keys(network.containers || {}).length;
	}

	function getDriverClasses(driver: string): string {
		const base = 'text-xs px-1.5 py-0.5 rounded-sm text-black dark:text-white inline-block w-14 text-center shadow-sm';
		switch (driver.toLowerCase()) {
			case 'bridge':
				return `${base} bg-emerald-200 dark:bg-emerald-800`;
			case 'host':
				return `${base} bg-sky-200 dark:bg-sky-800`;
			case 'null':
				return `${base} bg-slate-200 dark:bg-slate-700`;
			case 'overlay':
				return `${base} bg-violet-200 dark:bg-violet-800`;
			case 'macvlan':
				return `${base} bg-amber-200 dark:bg-amber-800`;
			default:
				return `${base} bg-slate-200 dark:bg-slate-700`;
		}
	}

	function toggleSort(field: SortField) {
		if (sortField === field) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortField = field;
			sortDirection = field === 'containers' ? 'desc' : 'asc';
		}
	}

	function inspectNetwork(network: NetworkInfo) {
		inspectNetworkId = network.id;
		inspectNetworkName = network.name;
		showInspectModal = true;
	}

	function openConnectModal(network: NetworkInfo) {
		connectNetwork = network;
		showConnectModal = true;
	}

	async function disconnectContainer(networkId: string, networkName: string, containerId: string, containerName: string) {
		disconnectingContainerId = containerId;
		try {
			const response = await fetch(appendEnvParam(`/api/networks/${networkId}/disconnect`, envId), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ containerId, containerName })
			});
			if (response.ok) {
				toast.success(`已将 ${containerName} 从 ${networkName} 断开`);
				await fetchNetworks();
			} else {
				const data = await response.json();
				toast.error(data.details || '断开容器失败');
			}
		} catch (error) {
			console.error('断开容器失败:', error);
			toast.error('断开容器失败');
		} finally {
			disconnectingContainerId = null;
			confirmDisconnectId = null;
		}
	}

	async function copyNetworkId(id: string) {
		const ok = await copyToClipboard(id);
		if (ok) {
			toast.success('网络 ID 已复制到剪贴板');
		} else {
			toast.error('复制 ID 失败');
		}
	}

	async function duplicateNetwork(network: NetworkInfo) {
		try {
			const newName = `${network.name}-copy`;
			const body: any = {
				name: newName,
				driver: network.driver,
				internal: network.internal,
				attachable: true,
				options: network.options || {}
			};

			// Copy IPAM config if available (but not subnet/gateway to avoid conflicts)
			if (network.ipam?.driver && network.ipam.driver !== 'default') {
				body.ipam = {
					driver: network.ipam.driver,
					options: network.ipam.options || {}
				};
			}

			const response = await fetch(appendEnvParam('/api/networks', envId), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (response.ok) {
				toast.success(`已创建 ${newName}`);
				await fetchNetworks();
			} else {
				const data = await response.json();
				toast.error(data.details || '复制网络失败');
			}
		} catch (error) {
			console.error('复制网络失败:', error);
			toast.error('复制网络失败');
		}
	}

	async function pruneNetworks() {
		pruneStatus = 'pruning';
		confirmPrune = false;
		try {
			const response = await fetch(appendEnvParam('/api/prune/networks', envId), {
				method: 'POST'
			});
			if (response.ok) {
				pruneStatus = 'success';
				toast.success('已清理未使用的网络');
				await fetchNetworks();
			} else {
				pruneStatus = 'error';
				toast.error('清理网络失败');
			}
		} catch (error) {
			pruneStatus = 'error';
			toast.error('清理网络失败');
		}
		pendingTimeouts.push(setTimeout(() => {
			pruneStatus = 'idle';
		}, 3000));
	}

	// Handle tab visibility changes (e.g., user switches back from another tab)
	function handleVisibilityChange() {
		if (document.visibilityState === 'visible' && envId) {
			fetchNetworks();
		}
	}

	onMount(() => {
		// Initial fetch is handled by $effect - no need to duplicate here

		// Listen for tab visibility changes to refresh when user returns
		document.addEventListener('visibilitychange', handleVisibilityChange);
		document.addEventListener('resume', handleVisibilityChange);

		// Subscribe to network events (SSE connection is global in layout)
		unsubscribeDockerEvent = onDockerEvent((event) => {
			if (envId && isNetworkListChange(event)) {
				fetchNetworks();
			}
		});

		refreshInterval = setInterval(() => {
			if (envId) fetchNetworks();
		}, 30000);

		// Note: In Svelte 5, cleanup must be in onDestroy, not returned from onMount
	});

	// Cleanup on component destroy
	onDestroy(() => {
		// Clear polling interval
		if (refreshInterval) {
			clearInterval(refreshInterval);
			refreshInterval = null;
		}

		// Unsubscribe from Docker events
		if (unsubscribeDockerEvent) {
			unsubscribeDockerEvent();
			unsubscribeDockerEvent = null;
		}

		document.removeEventListener('visibilitychange', handleVisibilityChange);
		document.removeEventListener('resume', handleVisibilityChange);
		pendingTimeouts.forEach(id => clearTimeout(id));
		pendingTimeouts = [];
	});
</script>

<div class="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
	<div class="shrink-0 flex flex-wrap justify-between items-center gap-3 min-h-8">
		<PageHeader icon={Network} title="网络" count={networks.length} />
		<div class="flex flex-wrap items-center gap-2">
			<div class="relative">
				<Search class="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
				<Input
					type="text"
					placeholder="搜索网络..."
					bind:value={searchInput}
					onkeydown={(e) => e.key === 'Escape' && (searchInput = '')}
					class="pl-8 h-8 w-48 text-sm"
				/>
			</div>
			<!-- Driver filter -->
			<MultiSelectFilter
				bind:value={selectedDrivers}
				options={driverOptions}
				placeholder="驱动"
				pluralLabel="驱动"
			/>
			<!-- Scope filter -->
			<MultiSelectFilter
				bind:value={selectedScopes}
				options={scopeOptions}
				placeholder="作用域"
				pluralLabel="作用域"
			/>
			{#if $canAccess('networks', 'remove')}
			<ConfirmPopover
				open={confirmPrune}
				action="清理"
				itemType="未使用网络"
				title="清理网络"
				position="left"
				onConfirm={pruneNetworks}
				onOpenChange={(open) => confirmPrune = open}
				unstyled
			>
				{#snippet children({ open })}
					<span class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm bg-background shadow-xs border hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 {pruneStatus === 'pruning' ? 'opacity-50 pointer-events-none' : ''}">
						{#if pruneStatus === 'pruning'}
							<RefreshCw class="w-3.5 h-3.5 animate-spin" />
						{:else if pruneStatus === 'success'}
							<Check class="w-3.5 h-3.5 text-green-600" />
						{:else if pruneStatus === 'error'}
							<XCircle class="w-3.5 h-3.5 text-destructive" />
						{:else}
							<Icon iconNode={broom} class="w-3.5 h-3.5" />
						{/if}
						清理
					</span>
				{/snippet}
			</ConfirmPopover>
			{/if}
			<Button size="sm" variant="outline" onclick={fetchNetworks}>
				<RefreshCw class="w-3.5 h-3.5" />
				刷新
			</Button>
			{#if $canAccess('networks', 'create')}
			<Button size="sm" variant="secondary" onclick={() => showCreateModal = true}>
				<Plus class="w-3.5 h-3.5" />
				创建
			</Button>
			{/if}
		</div>
	</div>

	<!-- Selection bar - always reserve space to prevent layout shift -->
	<div class="h-4 shrink-0">
		{#if selectedNetworks.size > 0}
			<div class="flex items-center gap-1 text-xs text-muted-foreground h-full">
			<span>已选择 {selectedInFilter.length} 项</span>
			<button
				type="button"
				class="inline-flex items-center gap-1 px-1.5 py-0 rounded border border-border hover:border-foreground/30 hover:shadow transition-all"
				onclick={selectNone}
			>
				清除
			</button>
			{#if $canAccess('networks', 'remove')}
			<ConfirmPopover
				open={confirmBulkRemove}
				action="删除"
				itemType="{selectedInFilter.length} 个网络}"
				title="删除 {selectedInFilter.length} 项"
				unstyled
				onConfirm={bulkRemove}
				onOpenChange={(open) => confirmBulkRemove = open}
			>
				{#snippet children({ open })}
					<span class="inline-flex items-center gap-1 px-1.5 py-0 rounded border border-border hover:text-destructive hover:border-destructive/40 hover:shadow transition-all cursor-pointer">
						<Trash2 class="w-3 h-3" />
						删除
					</span>
				{/snippet}
			</ConfirmPopover>
			{/if}
			</div>
		{/if}
	</div>

	{#if !loading && ($environments.length === 0 || !$currentEnvironment)}
		<NoEnvironment />
	{:else if !loading && networks.length === 0}
		<EmptyState
			icon={Network}
			title="未找到任何网络"
			description="创建网络以连接容器"
		/>
	{:else}
		<DataGrid
			data={filteredNetworks}
			keyField="id"
			gridId="networks"
			loading={loading}
			selectable
			bind:selectedKeys={selectedNetworks}
			selectableFilter={(n) => !protectedNetworks.includes(n.name)}
			sortState={{ field: sortField, direction: sortDirection }}
			onSortChange={(state) => { sortField = state.field as SortField; sortDirection = state.direction; }}
			highlightedKey={highlightedRowId}
			onRowClick={(network) => { highlightedRowId = highlightedRowId === network.id ? null : network.id; }}
		>
			{#snippet cell(column, network, rowState)}
				{@const containerCount = Object.keys(network.containers || {}).length}
				{@const isProtected = protectedNetworks.includes(network.name)}
				{#if column.id === 'name'}
					<div class="flex items-center gap-2 min-w-0">
						<span class="text-xs truncate" title={network.name}>{network.name}</span>
						{#if isProtected}
							<span class="text-2xs py-0 px-1.5 rounded-sm bg-muted text-muted-foreground shadow-sm shrink-0">内置</span>
						{/if}
						{#if network.internal}
							<Badge variant="outline" class="text-xs py-0 px-1.5 shrink-0">内部</Badge>
						{/if}
					</div>
				{:else if column.id === 'driver'}
					<span class={getDriverClasses(network.driver)}>{getLabelText(network.driver)}</span>
				{:else if column.id === 'scope'}
					<span class="text-xs">{getLabelText(network.scope)}</span>
				{:else if column.id === 'subnet'}
					<code class="text-xs">{getSubnet(network)}</code>
				{:else if column.id === 'gateway'}
					<code class="text-xs">{getGateway(network)}</code>
				{:else if column.id === 'containers'}
					<span class="text-xs {containerCount > 0 ? '' : 'text-muted-foreground'}">{containerCount}</span>
				{:else if column.id === 'actions'}
					<div class="flex items-center justify-end gap-1">
						{#if deleteError?.id === network.id}
							<div class="absolute bottom-full right-0 mb-1 z-50 bg-destructive text-destructive-foreground rounded-md shadow-lg p-2 text-xs flex items-start gap-2 max-w-lg w-max">
								<AlertTriangle class="w-3 h-3 flex-shrink-0 mt-0.5" />
								<span class="break-words">{deleteError.message}</span>
								<button onclick={() => deleteError = null} class="flex-shrink-0 hover:bg-white/20 rounded p-0.5">
									<X class="w-3 h-3" />
								</button>
							</div>
						{/if}
						{#if $canAccess('networks', 'inspect')}
						<button
							type="button"
							onclick={() => inspectNetwork(network)}
							title="查看详情"
							class="p-1 rounded hover:bg-muted transition-colors opacity-70 hover:opacity-100 cursor-pointer"
						>
							<Eye class="w-3 h-3 text-muted-foreground hover:text-foreground" />
						</button>
						{/if}
						{#if !isProtected && $canAccess('networks', 'connect')}
						<button
							type="button"
							onclick={() => openConnectModal(network)}
							title="连接容器"
							class="p-1 rounded hover:bg-muted transition-colors opacity-70 hover:opacity-100 cursor-pointer"
						>
							<Link class="w-3 h-3 text-muted-foreground hover:text-green-600" />
						</button>
						{/if}
						<button
							type="button"
							onclick={() => copyNetworkId(network.id)}
							title="复制网络 ID"
							class="p-1 rounded hover:bg-muted transition-colors opacity-70 hover:opacity-100 cursor-pointer"
						>
							<Copy class="w-3 h-3 text-muted-foreground hover:text-foreground" />
						</button>
						{#if !isProtected && $canAccess('networks', 'create')}
						<button
							type="button"
							onclick={() => duplicateNetwork(network)}
							title="复制网络"
							class="p-1 rounded hover:bg-muted transition-colors opacity-70 hover:opacity-100 cursor-pointer"
						>
							<CopyPlus class="w-3 h-3 text-muted-foreground hover:text-foreground" />
						</button>
						{/if}
						{#if !isProtected && $canAccess('networks', 'remove')}
						<ConfirmPopover
							open={confirmDeleteId === network.id}
							action="删除"
							itemType="网络"
							itemName={network.name}
							title="删除"
							onConfirm={() => removeNetwork(network.id, network.name)}
							onOpenChange={(open) => confirmDeleteId = open ? network.id : null}
						>
							{#snippet children({ open })}
								<Trash2 class="w-3 h-3 {open ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}" />
							{/snippet}
						</ConfirmPopover>
						{/if}
					</div>
				{/if}
			{/snippet}
		</DataGrid>
	{/if}
</div>

<CreateNetworkModal
	bind:open={showCreateModal}
	onClose={() => showCreateModal = false}
	onSuccess={fetchNetworks}
/>

<NetworkInspectModal
	bind:open={showInspectModal}
	networkId={inspectNetworkId}
	networkName={inspectNetworkName}
/>

<ConnectContainerModal
	bind:open={showConnectModal}
	network={connectNetwork}
	{envId}
	onSuccess={fetchNetworks}
/>

<BatchOperationModal
	bind:open={showBatchOpModal}
	title={batchOpTitle}
	operation={batchOpOperation}
	entityType="networks"
	items={batchOpItems}
	envId={envId ?? undefined}
	onClose={() => showBatchOpModal = false}
	onComplete={handleBatchComplete}
/>
