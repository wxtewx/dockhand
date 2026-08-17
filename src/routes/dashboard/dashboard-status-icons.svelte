<script lang="ts">
	import {
		ShieldCheck,
		Activity,
		WifiOff,
		CircleArrowUp,
		CircleFadingArrowUp
	} from 'lucide-svelte';

	interface Props {
		online: boolean;
		scannerEnabled: boolean;
		collectActivity: boolean;
		updateCheckEnabled?: boolean;
		updateCheckAutoUpdate?: boolean;
		compact?: boolean;
	}

	let { online, scannerEnabled, collectActivity, updateCheckEnabled = false, updateCheckAutoUpdate = false, compact = false }: Props = $props();
</script>

<div class="{compact ? 'flex items-center gap-1 shrink-0' : 'flex items-center gap-1.5 shrink-0'}">
	{#if updateCheckEnabled}
		<span title={updateCheckAutoUpdate ? "已启用自动更新" : "已启用更新检查 (仅通知)"}>
			{#if updateCheckAutoUpdate}
				<CircleArrowUp class="{compact ? 'w-3.5 h-3.5 glow-green-sm' : 'w-4 h-4 glow-green'} text-green-500" />
			{:else}
				<CircleFadingArrowUp class="{compact ? 'w-3.5 h-3.5 glow-green-sm' : 'w-4 h-4 glow-green'} text-green-500" />
			{/if}
		</span>
	{/if}
	{#if scannerEnabled}
		<span title="已启用漏洞扫描">
			<ShieldCheck class="{compact ? 'w-3.5 h-3.5 glow-green-sm' : 'w-4 h-4 glow-green'} text-green-500" />
		</span>
	{/if}
	{#if collectActivity}
		<span title="已启用活动收集">
			<Activity class="{compact ? 'w-3.5 h-3.5 glow-amber-sm' : 'w-4 h-4 glow-amber'} text-amber-500" />
		</span>
	{/if}
	{#if !online && compact}
		<span title="离线">
			<WifiOff class="w-3.5 h-3.5 text-red-500 shrink-0" />
		</span>
	{/if}
</div>
