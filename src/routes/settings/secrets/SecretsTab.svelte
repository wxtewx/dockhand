<script lang='ts'>
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Plus,
		Trash2,
		Pencil,
		KeyRound,
		PlugZap,
		RefreshCw,
		Check,
	} from 'lucide-svelte';
	import { scale } from 'svelte/transition';
	import { backOut, cubicIn } from 'svelte/easing';
	import ConfirmPopover from '$lib/components/ConfirmPopover.svelte';
	import { canAccess } from '$lib/stores/auth';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import ProviderModal, {
		type SecretProvider,
		providerTypeLabel,
	} from './ProviderModal.svelte';
	import { getProviderIcon } from '$lib/components/provider-icons';

	let providers = $state<SecretProvider[]>([]);
	let loading = $state(true);
	let showModal = $state(false);
	let editing = $state<SecretProvider | null>(null);
	let confirmDeleteId = $state<number | null>(null);
	let testingId = $state<number | null>(null);
	// Brief green tick on the tile's Test button right after a successful test.
	let testOkId = $state<number | null>(null);
	let testOkTimer: ReturnType<typeof setTimeout> | undefined;

	async function fetchProviders() {
		loading = true;
		try {
			const response = await fetch('/api/secret-providers');
			providers = await response.json();
		} catch (e) {
			console.error('获取密钥提供程序失败:', e);
			toast.error('获取密钥提供程序失败');
		} finally {
			loading = false;
		}
	}

	function openModal(provider?: SecretProvider) {
		editing = provider || null;
		showModal = true;
	}

	async function deleteProvider(id: number) {
		try {
			const response = await fetch(`/api/secret-providers/${id}`, {
				method: 'DELETE',
			});
			if (response.ok) {
				await fetchProviders();
				toast.success('密钥提供程序已删除');
			} else {
				const data = await response.json();
				toast.error(data.error || '删除密钥提供程序失败');
			}
		} catch {
			toast.error('删除密钥提供程序失败');
		}
	}

	async function testProvider(provider: SecretProvider) {
		testingId = provider.id;
		try {
			const response = await fetch(
				`/api/secret-providers/${provider.id}/test`,
				{ method: 'POST' },
			);
			const data = await response.json();
			if (data.ok) {
				toast.success(`${provider.name}: 连接正常`);
				clearTimeout(testOkTimer);
				testOkId = provider.id;
				testOkTimer = setTimeout(() => (testOkId = null), 2000);
			} else {
				toast.error(
					`${provider.name}: ${data.error || '连接失败'}`,
				);
			}
		} catch {
			toast.error('连接测试失败');
		} finally {
			testingId = null;
		}
	}

	onMount(() => {
		fetchProviders();
	});
</script>

<div class="space-y-4">
	<div class="flex justify-between items-center">
		<div class="flex items-center gap-3">
			<Badge variant="secondary" class="text-xs"
				>{providers.length} 个总计</Badge
			>
		</div>
		<div class="flex gap-2">
			{#if $canAccess("secrets", "create")}
				<Button size="sm" onclick={() => openModal()}>
					<Plus class="w-4 h-4" />
					添加密钥提供程序
				</Button>
			{/if}
			<Button size="sm" variant="outline" onclick={fetchProviders}
				>刷新</Button
			>
		</div>
	</div>

	{#if loading && providers.length === 0}
		<p class="text-muted-foreground text-sm">正在加载密钥提供程序...</p>
	{:else if providers.length === 0}
		<EmptyState
			icon={KeyRound}
			title="暂无密钥提供程序"
			description="添加提供程序 (1Password、Infisical、HashiCorp Vault、...)，用于在部署时加载密钥"
		/>
	{:else}
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{#each providers as provider (provider.id)}
				{@const ProviderIcon = getProviderIcon(provider.type)}
				<div out:fade={{ duration: 200 }}>
					<Card.Root>
						<Card.Header class="pb-2">
							<div class="flex items-start justify-between">
								<div class="flex items-center gap-2">
									<ProviderIcon class="w-5 h-5 text-muted-foreground" />
									<Card.Title class="text-base"
										>{provider.name}</Card.Title
									>
								</div>
								<Badge variant="secondary" class="text-xs"
									>{providerTypeLabel(provider.type)}</Badge
								>
							</div>
						</Card.Header>
						<Card.Content class="space-y-3">
							<div class="text-xs text-muted-foreground">
								添加于 {new Date(
									provider.createdAt,
								).toLocaleDateString()}
							</div>
							<div class="flex gap-2 pt-2 min-h-[32px]">
								{#if $canAccess("secrets", "view")}
									<Button
										variant="outline"
										size="sm"
										onclick={() => testProvider(provider)}
										disabled={testingId === provider.id}
										class={`transition-colors duration-300 ${testOkId === provider.id ? 'border-green-500/60 text-green-600 dark:text-green-400' : ''}`}
									>
										<span class="inline-flex w-3 h-3 mr-1 items-center justify-center shrink-0">
											{#if testingId === provider.id}
												<RefreshCw class="w-3 h-3 animate-spin" />
											{:else if testOkId === provider.id}
												<span in:scale={{ duration: 260, start: 0.4, easing: backOut }} out:scale={{ duration: 150, start: 0.6, easing: cubicIn }}>
													<Check class="w-3 h-3 text-green-600 dark:text-green-400" />
												</span>
											{:else}
												<PlugZap class="w-3 h-3" />
											{/if}
										</span>
										测试
									</Button>
								{/if}
								{#if $canAccess("secrets", "edit")}
									<Button
										variant="outline"
										size="sm"
										onclick={() => openModal(provider)}
									>
										<Pencil class="w-3 h-3" />
									</Button>
								{/if}
								{#if $canAccess("secrets", "delete")}
									<ConfirmPopover
										open={confirmDeleteId === provider.id}
										action="删除"
										itemType="密钥提供程序"
										itemName={provider.name}
										title="移除"
										position="left"
										onConfirm={() =>
											deleteProvider(provider.id)}
										onOpenChange={(open) =>
											(confirmDeleteId = open
												? provider.id
												: null)}
									>
										{#snippet children({ open })}
											<Trash2
												class="w-3 h-3 {open
													? 'text-destructive'
													: 'text-muted-foreground hover:text-destructive'}"
											/>
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

<ProviderModal
	bind:open={showModal}
	provider={editing}
	onClose={() => {
		showModal = false;
		editing = null;
	}}
	onSaved={fetchProviders}
/>
