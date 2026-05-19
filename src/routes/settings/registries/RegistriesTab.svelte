<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Plus, Trash2, Pencil, Star, Key, Download, Icon } from 'lucide-svelte';
	import { whale } from '@lucide/lab';
	import ConfirmPopover from '$lib/components/ConfirmPopover.svelte';
	import { canAccess } from '$lib/stores/auth';
	import RegistryModal from './RegistryModal.svelte';
	import { EmptyState } from '$lib/components/ui/empty-state';

	// Registry types
	interface Registry {
		id: number;
		name: string;
		url: string;
		username?: string;
		hasCredentials: boolean;
		isDefault: boolean;
		createdAt: string;
		updatedAt: string;
	}

	// Check if a registry is Docker Hub
	function isDockerHub(registry: Registry): boolean {
		const url = registry.url.toLowerCase();
		return url.includes('docker.io') ||
			   url.includes('hub.docker.com') ||
			   url.includes('registry.hub.docker.com');
	}

	// Registry state
	let registries = $state<Registry[]>([]);
	let regLoading = $state(true);
	let showRegModal = $state(false);
	let editingReg = $state<Registry | null>(null);
	let confirmDeleteRegistryId = $state<number | null>(null);

	async function fetchRegistries() {
		regLoading = true;
		try {
			const response = await fetch('/api/registries');
			registries = await response.json();
		} catch (error) {
			console.error('获取镜像仓库失败:', error);
			toast.error('获取镜像仓库失败');
		} finally {
			regLoading = false;
		}
	}

	function openRegModal(registry?: Registry) {
		editingReg = registry || null;
		showRegModal = true;
	}

	async function deleteRegistry(id: number) {
		try {
			const response = await fetch(`/api/registries/${id}`, {
				method: 'DELETE'
			});

			if (response.ok) {
				await fetchRegistries();
				toast.success('镜像仓库已删除');
			} else {
				const data = await response.json();
				toast.error(data.error || '删除镜像仓库失败');
			}
		} catch (error) {
			toast.error('删除镜像仓库失败');
		}
	}

	async function setRegDefault(id: number) {
		try {
			const response = await fetch(`/api/registries/${id}/default`, {
				method: 'POST'
			});

			if (response.ok) {
				await fetchRegistries();
				toast.success('默认镜像仓库已更新');
			} else {
				toast.error('设置默认镜像仓库失败');
			}
		} catch (error) {
			console.error('设置默认镜像仓库失败:', error);
			toast.error('设置默认镜像仓库失败');
		}
	}

	onMount(() => {
		fetchRegistries();
	});
</script>

<div class="space-y-4">
	<div class="flex justify-between items-center">
		<div class="flex items-center gap-3">
			<Badge variant="secondary" class="text-xs">共 {registries.length} 个</Badge>
		</div>
		<div class="flex gap-2">
			{#if $canAccess('registries', 'create')}
				<Button size="sm" onclick={() => openRegModal()}>
					<Plus class="w-4 h-4" />
					添加仓库
				</Button>
			{/if}
			<Button size="sm" variant="outline" onclick={fetchRegistries}>刷新</Button>
		</div>
	</div>

	{#if regLoading && registries.length === 0}
		<p class="text-muted-foreground text-sm">正在加载镜像仓库...</p>
	{:else if registries.length === 0}
		<EmptyState
			icon={Download}
			title="未找到任何镜像仓库"
			description="添加 Docker 镜像仓库以拉取和推送镜像"
		/>
	{:else}
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{#each registries as registry (registry.id)}
				<div out:fade={{ duration: 200 }}>
				<Card.Root class={registry.isDefault ? 'border-primary' : ''}>
					<Card.Header class="pb-2">
						<div class="flex items-start justify-between">
							<div class="flex items-center gap-2">
								{#if isDockerHub(registry)}
									<Icon iconNode={whale} class="w-5 h-5 text-muted-foreground" />
								{:else}
									<Download class="w-5 h-5 text-muted-foreground" />
								{/if}
								<Card.Title class="text-base">{registry.name}</Card.Title>
							</div>
							<div class="flex items-center gap-1">
								{#if registry.isDefault}
									<Badge variant="default" class="text-xs">默认</Badge>
								{/if}
								{#if registry.hasCredentials}
									<Badge variant="secondary" class="text-xs">认证</Badge>
								{/if}
							</div>
						</div>
					</Card.Header>
					<Card.Content class="space-y-3">
						<div class="text-sm text-muted-foreground truncate" title={registry.url}>
							{registry.url}
						</div>

						<!-- Always reserve space for username row -->
						<div class="flex items-center gap-2 text-xs text-muted-foreground h-4">
							{#if registry.username}
								<Key class="w-3 h-3" />
								<span>{registry.username}</span>
							{/if}
						</div>

						<div class="flex gap-2 pt-2 min-h-[32px]">
							{#if !registry.isDefault && $canAccess('registries', 'edit')}
								<Button
									variant="outline"
									size="sm"
									onclick={() => setRegDefault(registry.id)}
								>
									<Star class="w-3 h-3" />
									设为默认
								</Button>
							{/if}
							{#if $canAccess('registries', 'edit')}
								<Button
									variant="outline"
									size="sm"
									onclick={() => openRegModal(registry)}
								>
									<Pencil class="w-3 h-3" />
								</Button>
							{/if}
							{#if $canAccess('registries', 'delete')}
								<ConfirmPopover
									open={confirmDeleteRegistryId === registry.id}
									action="删除"
									itemType="仓库"
									itemName={registry.name}
									title="移除"
									position="left"
									onConfirm={() => deleteRegistry(registry.id)}
									onOpenChange={(open) => confirmDeleteRegistryId = open ? registry.id : null}
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

<RegistryModal
	bind:open={showRegModal}
	registry={editingReg}
	onClose={() => { showRegModal = false; editingReg = null; }}
	onSaved={fetchRegistries}
/>
