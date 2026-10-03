<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { AlertTriangle, Loader2, Trash2 } from 'lucide-svelte';

	interface Props {
		open: boolean;
		/** How many snapshots the confirm will delete. */
		count: number;
		/** Deletion in progress (disables the button, shows a spinner). */
		busy?: boolean;
		onConfirm: () => void;
	}
	let { open = $bindable(), count, busy = false, onConfirm }: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-destructive">
				<AlertTriangle class="h-5 w-5" />
				是否删除 {count} 个快照？
			</Dialog.Title>
		</Dialog.Header>
		<p class="text-sm text-muted-foreground">
			此操作将从备份仓库中永久移除选中的快照，该操作无法撤销。
		</p>
		<Dialog.Footer class="gap-2 sm:justify-end">
			<Button variant="outline" onclick={() => (open = false)} disabled={busy}>取消</Button>
			<Button variant="destructive" onclick={onConfirm} disabled={busy}>
				{#if busy}<Loader2 class="mr-1 h-4 w-4 animate-spin" />{:else}<Trash2 class="mr-1 h-4 w-4" />{/if}
				删除
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
