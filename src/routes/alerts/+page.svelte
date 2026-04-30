<script lang="ts">
	import { Bell } from 'lucide-svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
</script>

<div class="flex flex-col gap-6 p-6">
	<PageHeader icon={Bell} title="警报" />

	<div class="flex flex-col items-center justify-center py-12 text-muted-foreground">
		<Bell class="h-12 w-12 mb-4 opacity-50" />
		<p class="text-lg">未配置任何警报</p>
		<p class="text-sm">警报配置功能即将推出</p>
	</div>
</div>
