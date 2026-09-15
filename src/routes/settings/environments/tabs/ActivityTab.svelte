<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import * as Select from '$lib/components/ui/select';
	import { Percent, HardDrive } from 'lucide-svelte';

	interface Props {
		collectActivity: boolean;
		collectMetrics: boolean;
		highlightChanges: boolean;
		diskWarningEnabled: boolean;
		diskWarningMode: 'percentage' | 'absolute';
		diskWarningThreshold: number;
		diskWarningThresholdGb: number;
	}

	let {
		collectActivity = $bindable(),
		collectMetrics = $bindable(),
		highlightChanges = $bindable(),
		diskWarningEnabled = $bindable(),
		diskWarningMode = $bindable(),
		diskWarningThreshold = $bindable(),
		diskWarningThresholdGb = $bindable()
	}: Props = $props();
</script>

<div class="flex items-start gap-3">
	<div class="flex-1">
		<Label>收集容器活动</Label>
		<p class="text-xs text-muted-foreground">实时跟踪该环境中的容器事件 (启动、停止、重启等)</p>
	</div>
	<TogglePill bind:checked={collectActivity} />
</div>
<div class="flex items-start gap-3">
	<div class="flex-1">
		<Label>收集系统指标</Label>
		<p class="text-xs text-muted-foreground">收集该环境的 CPU 和内存使用统计数据</p>
	</div>
	<TogglePill bind:checked={collectMetrics} />
</div>
<div class="flex items-start gap-3">
	<div class="flex-1">
		<Label>高亮显示值变化</Label>
		<p class="text-xs text-muted-foreground">当容器列表中的容器值发生变化时显示琥珀色高亮效果</p>
	</div>
	<TogglePill bind:checked={highlightChanges} />
</div>

<div class="border-t pt-4 mt-2 space-y-3">
	<div class="flex items-start gap-3">
		<div class="flex-1">
			<Label>磁盘空间警告</Label>
			<p class="text-xs text-muted-foreground">当 Docker 磁盘使用率超过阈值时发送通知</p>
		</div>
		<TogglePill bind:checked={diskWarningEnabled} />
	</div>

	{#if diskWarningEnabled}
		<div class="flex items-center gap-3">
			<Select.Root type="single" value={diskWarningMode} onValueChange={(v) => { if (v) diskWarningMode = v as 'percentage' | 'absolute'; }}>
				<Select.Trigger class="w-48">
					<div class="flex items-center gap-2">
						{#if diskWarningMode === 'percentage'}
							<Percent class="w-3.5 h-3.5" />
							<span>百分比</span>
						{:else}
							<HardDrive class="w-3.5 h-3.5" />
							<span>绝对值 (GB)</span>
						{/if}
					</div>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="percentage">
						<div class="flex items-center gap-2">
							<Percent class="w-3.5 h-3.5" />
							百分比
						</div>
					</Select.Item>
					<Select.Item value="absolute">
						<div class="flex items-center gap-2">
							<HardDrive class="w-3.5 h-3.5" />
							绝对值 (GB)
						</div>
					</Select.Item>
				</Select.Content>
			</Select.Root>

			{#if diskWarningMode === 'percentage'}
				<Input
					type="number"
					min={1}
					max={100}
					bind:value={diskWarningThreshold}
					class="w-24"
				/>
				<span class="text-sm text-muted-foreground">%</span>
			{:else}
				<Input
					type="number"
					min={1}
					bind:value={diskWarningThresholdGb}
					class="w-24"
				/>
				<span class="text-sm text-muted-foreground">GB</span>
			{/if}
		</div>
	{/if}
</div>
