<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import * as Select from '$lib/components/ui/select';
	import { Percent, HardDrive, TriangleAlert } from 'lucide-svelte';
	import {
		percentageUnsupportedNote,
		percentageOptionDisabled
	} from '$lib/utils/disk-percentage-support';

	interface Props {
		collectActivity: boolean;
		collectMetrics: boolean;
		highlightChanges: boolean;
		diskWarningEnabled: boolean;
		diskWarningMode: 'percentage' | 'absolute';
		diskWarningThreshold: number;
		diskWarningThresholdGb: number;
		/** Whether this host reports a total to measure against; null = could not ask. */
		percentageSupported?: boolean | null;
		storageDriver?: string | null;
		/** The mode as loaded from the server, so switching away cannot lock it out. */
		storedDiskWarningMode?: 'percentage' | 'absolute' | null;
	}

	let {
		collectActivity = $bindable(),
		collectMetrics = $bindable(),
		highlightChanges = $bindable(),
		diskWarningEnabled = $bindable(),
		diskWarningMode = $bindable(),
		diskWarningThreshold = $bindable(),
		diskWarningThresholdGb = $bindable(),
		percentageSupported = null,
		storageDriver = null,
		storedDiskWarningMode = null
	}: Props = $props();

	// Only a definite "no" disables the option. An unreachable host stays unknown, so a
	// momentary outage never takes the setting away from somebody.
	const percentageDead = $derived(percentageSupported === false);
	const percentageNote = $derived(percentageUnsupportedNote(storageDriver));
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
		<Label>采集系统指标</Label>
		<p class="text-xs text-muted-foreground">为仪表盘卡片与图表采集CPU和内存历史数据。容器页面上的实时单容器统计数据始终显示，不受此项影响。</p>
	</div>
	<TogglePill bind:checked={collectMetrics} />
</div>
<div class="flex items-start gap-3">
	<div class="flex-1">
		<Label>高亮数值变动</Label>
		<p class="text-xs text-muted-foreground">当容器统计单元格内数值发生变化时闪烁琥珀色光晕。无论该项是否开启，数字都会持续更新；此选项仅控制高亮动画。</p>
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
							{#if percentageDead}
								<TriangleAlert class="w-3.5 h-3.5 text-[hsl(39_67%_69%)]" />
							{:else}
								<Percent class="w-3.5 h-3.5" />
							{/if}
							<span>百分比</span>
						{:else}
							<HardDrive class="w-3.5 h-3.5" />
							<span>绝对值 (GB)</span>
						{/if}
					</div>
				</Select.Trigger>
				<Select.Content>
					<Select.Item
						value="percentage"
						disabled={percentageOptionDisabled(percentageSupported, storedDiskWarningMode)}
					>
						<div class="flex flex-col gap-0.5">
							<div class="flex items-center gap-2">
								<Percent class="w-3.5 h-3.5" />
								百分比
							</div>
							{#if percentageDead}
								<span class="text-xs text-muted-foreground">在此主机上无法生效</span>
							{/if}
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

		{#if percentageDead && diskWarningMode === 'percentage'}
			<!-- A stored mode that cannot fire is worse than no warning: the setting
			     looks on, so nobody goes looking. Say it where the setting is. -->
			<div
				class="flex items-start gap-2 rounded-md border border-[hsl(39_67%_69%_/_0.3)] bg-[hsl(39_67%_69%_/_0.08)] px-3 py-2"
			>
				<TriangleAlert class="mt-0.5 w-4 h-4 shrink-0 text-[hsl(39_67%_69%)]" />
				<div class="flex-1 text-xs">
					<p class="text-[hsl(39_67%_69%)]">{percentageNote}</p>
					<button
						class="mt-1 underline underline-offset-2 text-muted-foreground hover:text-foreground"
						onclick={() => (diskWarningMode = 'absolute')}
					>
						切换至绝对值 (GB)
					</button>
				</div>
			</div>
		{/if}
	{/if}
</div>
