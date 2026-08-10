<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Copy, Loader2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { appendEnvParam } from '$lib/stores/environment';
	import { focusFirstInput } from '$lib/utils';

	interface Props {
		open: boolean;
		volumeName: string;
		envId?: number | null;
		onclose: () => void;
		onsuccess: () => void;
	}

	let { open = $bindable(), volumeName, envId, onclose, onsuccess }: Props = $props();

	let newName = $state('');
	let cloning = $state(false);
	let error = $state<string | null>(null);

	// Generate a default name when opening
	$effect(() => {
		if (open) {
			newName = `${volumeName}-copy`;
			error = null;
		}
	});

	function handleOpenChange(isOpen: boolean) {
		if (!isOpen) {
			onclose();
		}
	}

	async function handleClone() {
		if (!newName.trim()) {
			error = '请输入新数据卷的名称';
			return;
		}

		cloning = true;
		error = null;

		try {
			const url = appendEnvParam(`/api/volumes/${encodeURIComponent(volumeName)}/clone`, envId);
			const response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newName.trim() })
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.details || data.error || '克隆数据卷失败');
			}

			toast.success(`数据卷已克隆为 "${newName}"`);
			onsuccess();
			open = false;
		} catch (e: any) {
			error = e.message || '克隆数据卷失败';
		} finally {
			cloning = false;
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => { if (isOpen) focusFirstInput(); handleOpenChange(isOpen); }}>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Copy class="w-5 h-5" />
				克隆数据卷
			</Dialog.Title>
			<Dialog.Description>
				创建一个与 "{volumeName}" 拥有相同驱动和配置的新数据卷。
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<Label for="new-name">新数据卷名称</Label>
				<Input
					id="new-name"
					bind:value={newName}
					placeholder="请输入新数据卷名称"
					disabled={cloning}
					onkeydown={(e) => e.key === 'Enter' && handleClone()}
				/>
			</div>

			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}

			<p class="text-xs text-muted-foreground">
				注意：此操作会创建一个具有相同配置的空数据卷。如需复制数据，请在源数据卷上使用导出功能，再导入到新数据卷中。
			</p>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={cloning}>
				取消
			</Button>
			<Button onclick={handleClone} disabled={cloning || !newName.trim()}>
				{#if cloning}
					<Loader2 class="w-4 h-4 animate-spin" />
				{:else}
					<Copy class="w-4 h-4" />
				{/if}
				克隆
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
