<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Plus, Trash2, Pencil, Layers } from 'lucide-svelte';
	import ConfirmPopover from '$lib/components/ConfirmPopover.svelte';
	import { canAccess } from '$lib/stores/auth';
	import ConfigSetModal from './ConfigSetModal.svelte';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { getLabelText } from '$lib/types';

	// Config set types
	interface ConfigSet {
		id: number;
		name: string;
		description?: string;
		envVars: { key: string; value: string }[];
		labels: { key: string; value: string }[];
		ports: { hostPort: string; containerPort: string; protocol: string }[];
		volumes: { hostPath: string; containerPath: string; mode: string }[];
		networkMode: string;
		restartPolicy: string;
		createdAt: string;
		updatedAt: string;
	}

	// Config set state
	let configSets = $state<ConfigSet[]>([]);
	let cfgLoading = $state(true);
	let showCfgModal = $state(false);
	let editingCfg = $state<ConfigSet | null>(null);
	let confirmDeleteConfigSetId = $state<number | null>(null);

	async function fetchConfigSets() {
		cfgLoading = true;
		try {
			const response = await fetch('/api/config-sets');
			configSets = await response.json();
		} catch (error) {
			console.error('获取配置集失败:', error);
			toast.error('获取配置集失败');
		} finally {
			cfgLoading = false;
		}
	}

	function openCfgModal(cfg?: ConfigSet) {
		editingCfg = cfg || null;
		showCfgModal = true;
	}

	async function deleteConfigSet(id: number) {
		try {
			const response = await fetch(`/api/config-sets/${id}`, {
				method: 'DELETE'
			});

			if (response.ok) {
				await fetchConfigSets();
				toast.success('配置集已删除');
			} else {
				const data = await response.json();
				toast.error(data.error || '删除配置集失败');
			}
		} catch (error) {
			toast.error('删除配置集失败');
		}
	}

	onMount(() => {
		fetchConfigSets();
	});
</script>

<div class="space-y-4">
	<Card.Root class="border-dashed">
		<Card.Content class="pt-4">
			<div class="flex items-start gap-3">
				<Layers class="w-5 h-5 text-muted-foreground mt-0.5" />
				<div>
					<p class="text-sm font-medium">什么是配置集？</p>
					<p class="text-xs text-muted-foreground mt-1">
						配置集是可复用的容器配置模板。您可以一次性定义通用的环境变量、标签、端口和数据卷，然后在创建或编辑容器时应用它们。在容器创建过程中，配置集中的值可以被覆盖。
					</p>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<div class="flex justify-between items-center">
		<div class="flex items-center gap-3">
			<Badge variant="secondary" class="text-xs">总计 {configSets.length} 个</Badge>
		</div>
		<div class="flex gap-2">
			{#if $canAccess('configsets', 'create')}
				<Button size="sm" onclick={() => openCfgModal()}>
					<Plus class="w-4 h-4" />
					添加配置集
				</Button>
			{/if}
			<Button size="sm" variant="outline" onclick={fetchConfigSets}>刷新</Button>
		</div>
	</div>

	{#if cfgLoading && configSets.length === 0}
		<p class="text-muted-foreground text-sm">正在加载配置集...</p>
	{:else if configSets.length === 0}
		<EmptyState
			icon={Layers}
			title="未找到任何配置集"
			description="创建一个可复用的配置集开始使用"
		/>
	{:else}
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{#each configSets as cfg (cfg.id)}
				<div out:fade={{ duration: 200 }}>
				<Card.Root>
					<Card.Header class="pb-2">
						<div class="flex items-start justify-between">
							<div class="flex items-center gap-2">
								<Layers class="w-5 h-5 text-muted-foreground" />
								<Card.Title class="text-base">{cfg.name}</Card.Title>
							</div>
						</div>
					</Card.Header>
					<Card.Content class="space-y-3">
						{#if cfg.description}
							<p class="text-sm text-muted-foreground">{cfg.description}</p>
						{/if}

						<div class="flex flex-wrap gap-1.5">
							{#if cfg.envVars && cfg.envVars.length > 0}
								<Badge variant="outline" class="text-xs">{cfg.envVars.length} 个环境变量</Badge>
							{/if}
							{#if cfg.labels && cfg.labels.length > 0}
								<Badge variant="outline" class="text-xs">{cfg.labels.length} 个标签</Badge>
							{/if}
							{#if cfg.ports && cfg.ports.length > 0}
								<Badge variant="outline" class="text-xs">{cfg.ports.length} 个端口</Badge>
							{/if}
							{#if cfg.volumes && cfg.volumes.length > 0}
								<Badge variant="outline" class="text-xs">{cfg.volumes.length} 个数据卷</Badge>
							{/if}
						</div>

						<div class="text-xs text-muted-foreground">
							<span>网络: {getLabelText(cfg.networkMode)}</span>
							<span class="mx-1">|</span>
							<span>重启策略: {getLabelText(cfg.restartPolicy)}</span>
						</div>

						<div class="flex gap-2 pt-2">
							{#if $canAccess('configsets', 'edit')}
								<Button
									variant="outline"
									size="sm"
									onclick={() => openCfgModal(cfg)}
								>
									<Pencil class="w-3 h-3" />
									编辑
								</Button>
							{/if}
							{#if $canAccess('configsets', 'delete')}
								<ConfirmPopover
									open={confirmDeleteConfigSetId === cfg.id}
									action="删除"
									itemType="配置集"
									itemName={cfg.name}
									title="移除"
									position="left"
									onConfirm={() => deleteConfigSet(cfg.id)}
									onOpenChange={(open) => confirmDeleteConfigSetId = open ? cfg.id : null}
								>
									{#snippet children({ open })}
										<Trash2 class="w-3 h-3 {open ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}" />
									{/snippet}
								</ConfirmPopover>
							{/if}
						</div>
					</Card.Content>
				</Card.Root>
				</div>
			{/each}
		</div>
	{/if}
</div>

<ConfigSetModal
	bind:open={showCfgModal}
	configSet={editingCfg}
	onClose={() => { showCfgModal = false; editingCfg = null; }}
	onSaved={fetchConfigSets}
/>
