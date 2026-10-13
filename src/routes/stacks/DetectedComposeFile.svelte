<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Loader2, MapPin } from 'lucide-svelte';

	interface Props {
		stackName: string;
		envId: number;
		disabled?: boolean;
		onSelect: (path: string, name: string) => Promise<void>;
	}
	let { stackName, envId, disabled = false, onSelect }: Props = $props();
	let path = $state<string | null>(null);
	let error = $state<string | null>(null);
	let checking = $state(false);
	let selecting = $state(false);

	$effect(() => {
		const target = `/api/stacks/path-hints?name=${encodeURIComponent(stackName)}&env=${envId}`;
		const controller = new AbortController();
		path = null;
		error = null;
		checking = true;
		async function check() {
			try {
				const response = await fetch(target, { signal: controller.signal });
				const data = await response.json();
				if (controller.signal.aborted) { return; }
				if (!response.ok) { throw new Error(data.error || '无法检测到 Compose 文件。'); }
				const files = data.configFiles;
				if (files === null) { return; }
				if (!Array.isArray(files) || files.length != 1 || typeof files[0] != 'string' || !/^\/.*\.ya?ml$/i.test(files[0])) {
					throw new Error('标签必须仅指定一个 YAML 文件的绝对路径。');
				}
				path = files[0];
			} catch (cause) {
				if (!controller.signal.aborted) { error = cause instanceof Error ? cause.message : '无法检测到 Compose 文件。'; }
			} finally {
				if (!controller.signal.aborted) { checking = false; }
			}
		}
		void check();
		return () => controller.abort();
	});

	async function select() {
		if (!path || disabled || selecting) { return; }
		selecting = true;
		try {
			await onSelect(path, path.slice(path.lastIndexOf('/') + 1));
		} finally {
			selecting = false;
		}
	}
</script>

<div class="mb-4 w-full max-w-sm space-y-2 text-xs">
	{#if checking}
		<p class="flex items-center justify-center gap-2 text-muted-foreground"><Loader2 class="h-3.5 w-3.5 animate-spin" />正在检查 Compose 路径标签...</p>
	{:else if path}
		<p class="text-muted-foreground">从容器标签检测到:</p>
		<code class="block break-all">{path}</code>
		<p class="text-muted-foreground">使用 Dockhand 文件系统上的文件。对于远程环境，这些必须是同一套共享文件。</p>
		<Button variant="outline" size="sm" onclick={select} disabled={disabled || selecting}>
			{#if selecting}<Loader2 class="h-4 w-4 animate-spin" />{:else}<MapPin class="h-4 w-4" />{/if}
			使用检测到的文件
		</Button>
		<p class="text-muted-foreground">将文件加载至编辑器，和浏览文件功能一致。点击保存以确认此关联。</p>
	{:else if !error}
		<p role="status" class="text-muted-foreground">未检测到 Compose 文件。你可以手动浏览选择文件。</p>
	{/if}
	{#if error}<p role="status" class="break-words text-amber-700 dark:text-amber-400">{error} 你仍然可以手动浏览选择文件。</p>{/if}
</div>
