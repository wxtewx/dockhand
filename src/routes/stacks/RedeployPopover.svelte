<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { Loader2 } from 'lucide-svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		stackName: string;
		envId: number | null;
		disabled?: boolean;
		onDeploy: (options: { pull: boolean; build: boolean; forceRecreate: boolean }) => Promise<void>;
		children: Snippet;
	}

	let {
		stackName,
		envId,
		disabled = false,
		onDeploy,
		children
	}: Props = $props();

	let open = $state(false);
	let pull = $state(true);
	let build = $state(false);
	let forceRecreate = $state(false);
	let deploying = $state(false);

	async function handleDeploy() {
		deploying = true;
		try {
			await onDeploy({ pull, build, forceRecreate });
		} finally {
			deploying = false;
			open = false;
		}
	}

	function handleTriggerClick(e: MouseEvent) {
		e.stopPropagation();
		if (disabled) return;
		open = !open;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger asChild>
		{#snippet child({ props })}
			<button
				type="button"
				title="重新部署"
				{...props}
				onclick={handleTriggerClick}
				class="p-1 rounded hover:bg-muted transition-colors opacity-70 hover:opacity-100 cursor-pointer inline-flex items-center"
			>
				{@render children()}
			</button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		class="w-56 p-3 z-[200]"
		side="top"
		align="end"
		sideOffset={8}
	>
		<div class="space-y-3">
			<p class="text-xs font-medium">重新部署堆栈</p>
			<div class="space-y-2">
				<label class="flex items-center gap-2 cursor-pointer">
					<Checkbox bind:checked={pull} disabled={deploying} />
					<span class="text-xs">拉取镜像</span>
				</label>
				<label class="flex items-center gap-2 cursor-pointer">
					<Checkbox bind:checked={build} disabled={deploying} />
					<span class="text-xs">构建镜像</span>
				</label>
				<label class="flex items-center gap-2 cursor-pointer">
					<Checkbox bind:checked={forceRecreate} disabled={deploying} />
					<span class="text-xs">强制重新创建</span>
				</label>
			</div>
			<Button
				size="sm"
				class="w-full h-7 text-xs"
				onclick={handleDeploy}
				disabled={deploying}
			>
				{#if deploying}
					<Loader2 class="w-3 h-3 mr-1 animate-spin" />
					部署中...
				{:else}
					部署
				{/if}
			</Button>
		</div>
	</Popover.Content>
</Popover.Root>
