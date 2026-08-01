<script lang="ts">
	/**
	 * Shared "all volumes / pick a subset" UI used by BackupPanel and
	 * CreateBackupModal. Both surfaces previously open-coded this — they
	 * drifted slightly (different toggle labels, different icon for bind
	 * mounts) and one of them silently omitted the bind-mount warning.
	 *
	 * mountType is optional per volume: when present, bind mounts get an
	 * amber warning callout and a per-row Folder icon; when absent, all
	 * rows render as named volumes with the neutral icon.
	 */
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import { AlertTriangle } from 'lucide-svelte';
	import MountTypeBadge from '$lib/components/MountTypeBadge.svelte';

	interface VolumeInfo {
		name: string;
		mountPoint: string;
		mountType?: 'volume' | 'bind';
		source?: string;
		/** Socket / host system bind the engine won't capture: listed but not selectable. */
		unbackupable?: boolean;
	}

	interface Props {
		volumes: VolumeInfo[];
		allVolumes: boolean;
		selectedVolumes: string[];
		/** Empty-state label, e.g. "No volumes detected on this container". */
		emptyLabel?: string;
		/** When true, surface the bind-mount-portability warning when binds are present. */
		showBindWarning?: boolean;
	}

	let {
		volumes,
		allVolumes = $bindable(),
		selectedVolumes = $bindable(),
		emptyLabel = '未检测到数据卷',
		showBindWarning = true
	}: Props = $props();

	// Unbackupable binds (docker.sock, host system paths) are listed for context but
	// never count as backup targets and can't be selected. The engine skips them too.
	const backupable = $derived(volumes.filter((v) => !v.unbackupable));
	const bindMounts = $derived(backupable.filter((v) => v.mountType === 'bind'));

	function toggleVolume(name: string) {
		if (selectedVolumes.includes(name)) {
			selectedVolumes = selectedVolumes.filter((v) => v !== name);
		} else {
			selectedVolumes = [...selectedVolumes, name];
		}
	}
</script>

{#if volumes.length > 0}
	<!-- One bordered section: the "all volumes" toggle heads the list it controls,
	     so the switch clearly belongs to the volumes below it. -->
	<div class="border rounded-md overflow-hidden">
		<div class="flex items-center justify-between gap-4 px-3 py-2 bg-muted/30 border-b">
			<Label class="text-xs">备份全部数据卷 ({backupable.length})</Label>
			<TogglePill bind:checked={allVolumes} onLabel="是" offLabel="否" />
		</div>

		{#if showBindWarning && bindMounts.length > 0}
			<div class="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/5 p-2 text-xs">
				<AlertTriangle class="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
				<div class="space-y-1">
					<p class="font-medium text-amber-600 dark:text-amber-400">检测到 {bindMounts.length} 个绑定挂载</p>
					<p class="text-muted-foreground">快照会保存目录内容，但绑定挂载源为宿主机路径。恢复至其他环境时，目标主机必须存在完全一致的路径，否则容器启动后挂载目录为空。</p>
				</div>
			</div>
		{/if}

		<!-- List always shown: informational when "all" is on, selectable when off. -->
		<div class="divide-y max-h-40 overflow-y-auto">
			{#each volumes as vol}
				<label class="flex items-center gap-2 px-3 py-1.5 text-xs" class:cursor-pointer={!allVolumes && !vol.unbackupable} class:opacity-50={vol.unbackupable}>
					<Checkbox
						checked={!vol.unbackupable && (allVolumes || selectedVolumes.includes(vol.name))}
						disabled={allVolumes || vol.unbackupable}
						onCheckedChange={() => !vol.unbackupable && toggleVolume(vol.name)}
						class="h-3.5 w-3.5"
					/>
					<MountTypeBadge type={vol.mountType} size="sm" />
						<span class="font-mono truncate">{vol.name}</span>
						{#if vol.source && vol.source !== vol.name}
							<span class="text-muted-foreground font-mono truncate">来源 {vol.source}</span>
						{/if}
						{#if vol.unbackupable}
							<span class="text-muted-foreground ml-auto shrink-0 italic">socket / system 路径 — 不进行备份</span>
						{:else if vol.mountPoint}
							<span class="text-muted-foreground ml-auto truncate">{vol.mountPoint}</span>
						{/if}
					</label>
				{/each}
			</div>
	</div>
{:else}
	<p class="text-xs text-muted-foreground">{emptyLabel}</p>
{/if}
