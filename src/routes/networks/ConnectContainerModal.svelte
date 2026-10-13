<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { appendEnvParam } from '$lib/stores/environment';
	import { Link, Loader2, Box } from 'lucide-svelte';
	import { focusFirstInput } from '$lib/utils';
	import type { NetworkInfo } from '$lib/types';
	import { getLabelText } from '$lib/types';

	interface Container {
		id: string;
		name: string;
		state: string;
		networks: { [key: string]: { ipAddress: string } };
	}

	let {
		open = $bindable(false),
		network,
		envId,
		onSuccess
	}: {
		open: boolean;
		network: NetworkInfo | null;
		envId: number | null;
		onSuccess: () => void;
	} = $props();

	let containers = $state<Container[]>([]);
	let selectedContainer = $state<string | undefined>(undefined);
	let loading = $state(false);
	let submitting = $state(false);

	// Containers not already connected to this network
	const availableContainers = $derived(
		containers.filter(c => {
			if (!network) return true;
			// Check if container is already connected to this network
			return !Object.keys(c.networks || {}).includes(network.name);
		})
	);

	const selectedContainerInfo = $derived(
		containers.find(c => c.id === selectedContainer)
	);

	async function fetchContainers() {
		loading = true;
		try {
			const response = await fetch(appendEnvParam('/api/containers', envId));
			if (response.ok) {
				containers = await response.json();
			}
		} catch (error) {
			console.error('获取容器失败:', error);
		} finally {
			loading = false;
		}
	}

	async function handleConnect() {
		if (!selectedContainer || !network) return;

		submitting = true;
		try {
			const response = await fetch(appendEnvParam(`/api/networks/${network.id}/connect`, envId), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					containerId: selectedContainer,
					containerName: selectedContainerInfo?.name
				})
			});

			if (response.ok) {
				toast.success(`已将 ${selectedContainerInfo?.name || '容器'} 连接到 ${network.name}`);
				open = false;
				selectedContainer = undefined;
				onSuccess();
			} else {
				const data = await response.json();
				toast.error(data.details || '连接容器失败');
			}
		} catch (error) {
			console.error('连接容器失败:', error);
			toast.error('连接容器失败');
		} finally {
			submitting = false;
		}
	}

	$effect(() => {
		if (open) {
			fetchContainers();
			selectedContainer = undefined;
		}
	});
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => isOpen && focusFirstInput()}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Link class="w-4 h-4" />
				连接容器到 {network?.name}
			</Dialog.Title>
			<Dialog.Description>
				选择一个容器连接到该网络。
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-4">
			{#if loading}
				<div class="flex items-center justify-center py-8">
					<Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
				</div>
			{:else if availableContainers.length === 0}
				<div class="text-center py-8 text-muted-foreground">
					<Box class="w-8 h-8 mx-auto mb-2 opacity-50" />
					<p class="text-sm">暂无可用容器进行连接。</p>
					<p class="text-xs mt-1">所有容器已连接到该网络。</p>
				</div>
			{:else}
				<div class="space-y-2">
					<Label for="container">容器</Label>
					<Select.Root type="single" bind:value={selectedContainer}>
						<Select.Trigger id="container" class="w-full">
							{#if selectedContainerInfo}
								<span class="flex items-center gap-2">
									<span class="w-2 h-2 rounded-full {selectedContainerInfo.state === 'running' ? 'bg-green-500' : 'bg-gray-400'}"></span>
									{selectedContainerInfo.name}
								</span>
							{:else}
								<span class="text-muted-foreground">选择一个容器...</span>
							{/if}
						</Select.Trigger>
						<Select.Content>
							{#each availableContainers as container}
								<Select.Item value={container.id}>
									<span class="flex items-center gap-2">
										<span class="w-2 h-2 rounded-full {container.state === 'running' ? 'bg-green-500' : 'bg-gray-400'}"></span>
										{container.name}
										<span class="text-xs text-muted-foreground ml-auto">{getLabelText(container.state)}</span>
									</span>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => open = false} disabled={submitting}>
				取消
			</Button>
			<Button
				onclick={handleConnect}
				disabled={!selectedContainer || submitting || availableContainers.length === 0}
			>
				{#if submitting}
					<Loader2 class="w-4 h-4 mr-2 animate-spin" />
				{:else}
					<Link class="w-4 h-4" />
				{/if}
				连接
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
