<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { FolderOpen } from 'lucide-svelte';
	import FileBrowserPanel from './FileBrowserPanel.svelte';
	import { canAccess } from '$lib/stores/auth';

	interface Props {
		open: boolean;
		containerId: string;
		containerName: string;
		envId?: number;
		onclose: () => void;
	}

	let { open = $bindable(), containerId, containerName, envId, onclose }: Props = $props();

	function handleOpenChange(isOpen: boolean) {
		if (!isOpen) {
			onclose();
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-4xl h-[90vh] sm:h-[80vh] flex flex-col">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<FolderOpen class="w-5 h-5" />
				<span>浏览文件 - {containerName}</span>
			</Dialog.Title>
			<Dialog.Description>
				浏览、上传和下载容器文件系统中的文件。
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex-1 overflow-hidden border rounded-lg">
			<FileBrowserPanel {containerId} {envId} canEdit={$canAccess('containers', 'exec')} />
		</div>
	</Dialog.Content>
</Dialog.Root>
