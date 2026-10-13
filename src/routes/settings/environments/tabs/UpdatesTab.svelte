<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import CronEditor from '$lib/components/cron-editor.svelte';
	import TimezoneSelector from '$lib/components/TimezoneSelector.svelte';
	import VulnerabilityCriteriaSelector, { type VulnerabilityCriteria } from '$lib/components/VulnerabilityCriteriaSelector.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { CircleFadingArrowUp, CircleArrowUp, RefreshCw, Info, Trash2, HelpCircle } from 'lucide-svelte';
	import { formatDateTime } from '$lib/stores/settings';
	import { formatBytes } from '$lib/utils/format';

	interface Props {
		// Update check settings
		updateCheckLoading: boolean;
		updateCheckEnabled: boolean;
		updateCheckCron: string;
		updateCheckAutoUpdate: boolean;
		updateCheckVulnerabilityCriteria: VulnerabilityCriteria;
		minimumReleaseAgeHours: number;
		minimumReleaseAgeOverridden: boolean;
		minimumReleaseAgeOverride: boolean;
		scannerEnabled: boolean;
		// Image prune settings
		imagePruneLoading: boolean;
		imagePruneEnabled: boolean;
		imagePruneCron: string;
		imagePruneMode: 'dangling' | 'all';
		imagePruneLastPruned?: string;
		imagePruneLastResult?: { spaceReclaimed: number; imagesRemoved: number };
		// Timezone
		timezone: string;
	}

	let {
		updateCheckLoading,
		updateCheckEnabled = $bindable(),
		updateCheckCron = $bindable(),
		updateCheckAutoUpdate = $bindable(),
		updateCheckVulnerabilityCriteria = $bindable(),
		minimumReleaseAgeHours = $bindable(),
		minimumReleaseAgeOverridden,
		minimumReleaseAgeOverride = $bindable(),
		scannerEnabled,
		imagePruneLoading,
		imagePruneEnabled = $bindable(),
		imagePruneCron = $bindable(),
		imagePruneMode = $bindable(),
		imagePruneLastPruned,
		imagePruneLastResult,
		timezone = $bindable()
	}: Props = $props();

</script>

<!-- Scheduled Update Check Section -->
<div class="space-y-4">
	<div class="text-sm font-medium">
		定时更新检查
	</div>
	<p class="text-xs text-muted-foreground">
		定期检查该环境中的所有容器是否有可用的镜像更新。
	</p>

	{#if updateCheckLoading}
		<div class="flex items-center justify-center py-4">
			<RefreshCw class="w-5 h-5 animate-spin text-muted-foreground" />
		</div>
	{:else}
		<div class="flex items-start gap-2">
			<CircleFadingArrowUp class="w-4 h-4 text-green-500 glow-green mt-0.5 shrink-0" />
			<div class="flex-1">
				<Label>启用定时更新检查</Label>
				<p class="text-xs text-muted-foreground">按计划自动检查容器更新</p>
			</div>
			<TogglePill bind:checked={updateCheckEnabled} />
		</div>

		{#if updateCheckEnabled}
			<div class="flex items-start gap-2">
				<div class="w-4 shrink-0"></div>
				<div class="flex-1 space-y-2">
					<Label>计划任务</Label>
					<CronEditor value={updateCheckCron} onchange={(cron) => updateCheckCron = cron} />
				</div>
			</div>

			<div class="flex items-start gap-2">
				<CircleArrowUp class="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
				<div class="flex-1">
					<Label>自动更新容器</Label>
					<p class="text-xs text-muted-foreground">
						启用后，当发现新镜像时将自动更新容器。
						禁用后，仅发送可用更新的通知。
					</p>
				</div>
				<TogglePill bind:checked={updateCheckAutoUpdate} />
			</div>

			{#if updateCheckAutoUpdate && scannerEnabled}
				<div class="flex items-start gap-2">
					<div class="w-4 shrink-0"></div>
					<div class="flex-1">
						<Label>阻止存在漏洞的更新</Label>
						<p class="text-xs text-muted-foreground">
							如果新镜像的漏洞超过此标准，则阻止自动更新
						</p>
					</div>
					<VulnerabilityCriteriaSelector
						bind:value={updateCheckVulnerabilityCriteria}
						class="w-[200px]"
					/>
				</div>
			{/if}

			<div class="text-xs text-muted-foreground bg-muted/50 rounded-md p-2 flex items-start gap-2">
				<Info class="w-3 h-3 mt-0.5 shrink-0" />
				{#if updateCheckAutoUpdate}
					{#if scannerEnabled && updateCheckVulnerabilityCriteria !== 'never'}
						<span>新镜像将拉取到临时标签，进行漏洞扫描，若通过检查则部署。被阻止的镜像会自动删除。</span>
					{:else}
						<span>当有可用的新镜像时，容器将自动更新。</span>
					{/if}
				{:else}
					<span>当有可用更新时你将收到通知，容器不会被修改。</span>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<!-- Minimum image age -->
<div class="space-y-3 pt-4 border-t">
	<div class="text-sm font-medium flex items-center gap-2">
		镜像最小存放时长
		<Tooltip.Provider delayDuration={100}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<HelpCircle class="w-3.5 h-3.5 text-muted-foreground cursor-help" />
				</Tooltip.Trigger>
				<Tooltip.Portal>
					<Tooltip.Content side="right" sideOffset={8} class="!w-96 space-y-2">
						<p>该时长取自镜像仓库内记录的镜像创建时间，记录的是构建时间而非发布时间。当仓库无法提供可用时间时，Dockhand 将从首次观测到该摘要的时刻开始计时。</p>
                        <p>手动拉取会弹出警告并继续执行；堆栈部署 (包括定时 Git 部署) 不受此限制。</p>
                        <p>新镜像会重置自身等待计时，因此如果项目发布速度短于该时长，则永远不会自动更新。</p>
					</Tooltip.Content>
				</Tooltip.Portal>
			</Tooltip.Root>
		</Tooltip.Provider>
	</div>
	<p class="text-xs text-muted-foreground">延迟自动容器更新，等待新镜像发布一段时间后再执行。</p>
	<div class="flex items-center justify-between gap-3">
		<div>
			<Label>覆盖全局冷却配置</Label>
			<p class="text-xs text-muted-foreground">关闭时，此环境将使用全局配置。</p>
		</div>
		<TogglePill bind:checked={minimumReleaseAgeOverride} disabled={minimumReleaseAgeOverridden} />
	</div>
	{#if minimumReleaseAgeOverride}
		<div class="flex items-center gap-3">
			<Label for="env-minimum-release-age" class="shrink-0">小时</Label>
			<Input id="env-minimum-release-age" type="number" min="0" max="720" step="1" class="w-28" bind:value={minimumReleaseAgeHours} disabled={minimumReleaseAgeOverridden} />
			<span class="text-xs text-muted-foreground">0 代表禁用冷却</span>
		</div>
	{/if}
	{#if minimumReleaseAgeOverridden}
		<p class="text-xs text-muted-foreground">由 Dockhand 服务器上的 MINIMUM_RELEASE_AGE_HOURS 环境变量设定。</p>
	{/if}
</div>

<!-- Image Pruning Section -->
<div class="space-y-4 pt-4 border-t">
	<div class="text-sm font-medium">
		自动清理镜像
	</div>
	<p class="text-xs text-muted-foreground">
		按计划自动删除未使用的 Docker 镜像以释放磁盘空间。
	</p>

	{#if imagePruneLoading}
		<div class="flex items-center justify-center py-4">
			<RefreshCw class="w-5 h-5 animate-spin text-muted-foreground" />
		</div>
	{:else}
		<div class="flex items-start gap-2">
			<Trash2 class="w-4 h-4 text-amber-500 glow-amber mt-0.5 shrink-0" />
			<div class="flex-1">
				<Label>启用自动清理镜像</Label>
				<p class="text-xs text-muted-foreground">按计划自动删除未使用的镜像</p>
			</div>
			<TogglePill bind:checked={imagePruneEnabled} />
		</div>

		{#if imagePruneEnabled}
			<div class="flex items-start gap-2">
				<div class="w-4 shrink-0"></div>
				<div class="flex-1 space-y-2">
					<Label>计划任务</Label>
					<CronEditor value={imagePruneCron} onchange={(cron) => imagePruneCron = cron} />
				</div>
			</div>

			<div class="flex items-start gap-2">
				<div class="w-4 shrink-0"></div>
				<div class="flex-1 space-y-2">
					<Label>清理模式</Label>
					<Select.Root type="single" bind:value={imagePruneMode}>
						<Select.Trigger class="w-full">
							{imagePruneMode === 'dangling' ? '仅悬空镜像' : '所有未使用镜像'}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="dangling">仅悬空镜像</Select.Item>
							<Select.Item value="all">所有未使用镜像</Select.Item>
						</Select.Content>
					</Select.Root>
					<p class="text-xs text-muted-foreground">
						{#if imagePruneMode === 'dangling'}
							仅删除无标签的镜像层 (最安全选项)
						{:else}
							删除所有未被任何容器使用的镜像 (清理更彻底)
						{/if}
					</p>
				</div>
			</div>

			{#if imagePruneLastPruned}
				<div class="flex items-start gap-2">
					<div class="w-4 shrink-0"></div>
					<div class="flex-1">
						<p class="text-xs text-muted-foreground">
							上次清理时间：{formatDateTime(imagePruneLastPruned)}
							{#if imagePruneLastResult}
								- 已移除 {imagePruneLastResult.imagesRemoved} 个镜像，回收 {formatBytes(imagePruneLastResult.spaceReclaimed)} 空间
							{/if}
						</p>
					</div>
				</div>
			{/if}

			<div class="text-xs text-muted-foreground bg-muted/50 rounded-md p-2 flex items-start gap-2">
				<Info class="w-3 h-3 mt-0.5 shrink-0" />
				<span>正在运行或已停止的容器所使用的镜像永远不会被删除。</span>
			</div>
		{/if}
	{/if}
</div>

<!-- Timezone selector -->
<div class="space-y-2">
	<Label>时区</Label>
	<TimezoneSelector
		bind:value={timezone}
		id="edit-env-timezone"
	/>
	<p class="text-xs text-muted-foreground">
		用于计划自动更新、Git 同步和镜像清理任务
	</p>
</div>
