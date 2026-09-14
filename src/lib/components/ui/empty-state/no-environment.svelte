<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { EmptyState } from '$lib/components/ui/empty-state';
	import { Server, Settings } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { environments } from '$lib/stores/environment';

	const hasEnvironments = $derived($environments.length > 0);
</script>

{#if hasEnvironments}
	<EmptyState
		icon={Server}
		title="未选择环境"
		description="请从下拉列表中选择一个 Docker 环境以开始使用"
	/>
{:else}
	<EmptyState
		icon={Server}
		title="未配置环境"
		description="请在设置中添加 Docker 环境以开始使用"
	>
		<Button variant="secondary" onclick={() => goto('/settings?tab=environments')}>
			<Settings class="w-4 h-4" />
			前往设置
		</Button>
	</EmptyState>
{/if}
