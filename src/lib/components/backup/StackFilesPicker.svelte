<script lang="ts">
	/**
	 * "Stack files on the host" — probes the target host at backup-config time, shows the
	 * resolved HOST path of the stack folder, and lets the user pick which entries to back up.
	 * Load-bearing files (compose, .env) are always kept (non-deselectable). When the folder
	 * can't be located on the host, an info callout tells the user to set the env's stack path
	 * and re-configure. Mirrors VolumePicker's list + BackupPanel's host-path callout.
	 */
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import { FolderOpen, Folder, FileText, Info, Loader2, AlertTriangle, HelpCircle, Unplug, Route, UndoDot, Icon } from 'lucide-svelte';
	import { whale } from '@lucide/lab';
	import EnvironmentIcon from '$lib/components/EnvironmentIcon.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	type Entry = { name: string; type: 'dir' | 'file'; size: number; capturedAs?: 'bind' | 'volume' };
	type Listing =
		| { kind: 'listed'; hostPath: string; entries: Entry[] }
		| { kind: 'tar'; localStackDir: string; entries: Entry[] }
		| { kind: 'helper-failed'; reason: string }
		| { kind: 'unknown'; reason: string }
		| null;

	interface Props {
		listing: Listing;
		loading?: boolean;
		/** Names of stack-dir entries the user has DEselected (excluded from the backup). */
		excludedStackFiles: string[];
		/** Environment connection type - the tooltip explains the host path differently per type. */
		connectionType?: string;
		/** Environment name, shown in the tooltip ("<name> is a socket environment"). */
		envName?: string;
		/** Environment icon (Lucide name or custom) + its id, for the env glyph in the tooltip. */
		envIcon?: string;
		envId?: number;
		/** The user-set "Remote stack path (for backup)" for direct/hawser envs (empty if unset). */
		configuredStackPath?: string;
	}

	let { listing, loading = false, excludedStackFiles = $bindable(), connectionType, envName, envIcon, envId, configuredStackPath = '' }: Props = $props();

	// Falls back to a generic subject when the env name isn't available.
	const envLabel = $derived(envName || 'This environment');

	// The stack folder resolves to a host path by a DIFFERENT route per environment type, so the
	// "where this path comes from" help must differ too (undefined = socket, the default).
	const envKind = $derived(
		connectionType === 'direct' ? 'direct'
		: connectionType === 'hawser-standard' || connectionType === 'hawser-edge' ? 'hawser'
		: 'socket'
	);

	// A stack always needs its compose + env files - never deselectable (matches the server
	// isLoadBearingStackFile guard, which refuses to exclude them even if the config lists them).
	function isLoadBearing(name: string): boolean {
		const n = name.toLowerCase();
		return (
			n === 'compose.yaml' || n === 'compose.yml' ||
			n === 'docker-compose.yml' || n === 'docker-compose.yaml' ||
			n === '.env' || n.startsWith('.env.')
		);
	}

	// An entry the user cannot deselect HERE: either load-bearing (always kept) or captured via
	// its own bind/volume channel (controlled in the Volumes section, not here).
	function isLocked(e: Entry): boolean {
		return isLoadBearing(e.name) || e.capturedAs != null;
	}

	const entries = $derived(listing?.kind === 'listed' || listing?.kind === 'tar' ? listing.entries : []);
	const selectable = $derived(entries.filter((e) => !isLocked(e)));
	// "All files" is on when nothing selectable is excluded.
	const allFiles = $derived(excludedStackFiles.length === 0);

	function toggleAll(on: boolean) {
		excludedStackFiles = on ? [] : selectable.map((e) => e.name);
	}

	function toggleEntry(e: Entry) {
		if (isLocked(e)) return;
		excludedStackFiles = excludedStackFiles.includes(e.name)
			? excludedStackFiles.filter((n) => n !== e.name)
			: [...excludedStackFiles, e.name];
	}

	function fmtSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<div class="space-y-2">
	<div class="text-sm font-medium">宿主机上的堆栈文件</div>

	{#if loading}
		<div class="flex items-center gap-2 rounded-md border bg-muted/30 p-2.5 text-xs text-muted-foreground">
			<Loader2 class="h-4 w-4 shrink-0 animate-spin" />
			正在探测宿主机的堆栈文件夹...
		</div>
	{:else if listing?.kind === 'listed' || listing?.kind === 'tar'}
		{#if listing.kind === 'listed'}
			<!-- Resolved host path callout (copied from BackupPanel's stack-path candidate). -->
			<div class="flex items-start gap-2 rounded-md border bg-muted/30 p-2.5 text-xs">
				<FolderOpen class="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1.5">
						<span class="font-medium text-foreground">从宿主机以下路径采集</span>
						<Tooltip.Root>
							<Tooltip.Trigger type="button" class="text-muted-foreground hover:text-foreground">
								<HelpCircle class="h-3.5 w-3.5" />
							</Tooltip.Trigger>
							<Tooltip.Content class="w-80 z-[200]" side="right">
								<div class="space-y-2">
									<p class="font-medium">该路径来源说明</p>
									{#if envKind === 'socket'}
										<p class="flex items-center gap-1.5 text-muted-foreground">
											{#if envIcon && envId != null}<EnvironmentIcon icon={envIcon} {envId} class="h-3.5 w-3.5 shrink-0" />{/if}
											<Unplug class="h-3.5 w-3.5 shrink-0 text-cyan-500" />
											<span><span class="font-medium text-foreground">{envLabel}</span> 属于套接字类型环境。备份程序将从 Dockhand 自身在宿主机的堆栈目录读取堆栈文件夹。</span>
										</p>
										<p class="text-muted-foreground">
											若路径显示有误，请在容器运行 Dockhand 时配置 <code class="bg-muted px-1 rounded">HOST_DATA_DIR</code>，使其指向宿主机上数据卷的实际挂载位置。
										</p>
									{:else if envKind === 'direct'}
										<p class="flex items-center gap-1.5 text-muted-foreground">
											{#if envIcon && envId != null}<EnvironmentIcon icon={envIcon} {envId} class="h-3.5 w-3.5 shrink-0" />{/if}
											<Icon iconNode={whale} class="h-3.5 w-3.5 shrink-0 text-blue-500" />
											<span><span class="font-medium text-foreground">{envLabel}</span> 属于直连类型环境。备份程序将从远程 Docker 宿主机的此路径读取堆栈文件夹。</span>
										</p>
										{#if configuredStackPath}
											<p class="text-muted-foreground">
												当前环境已配置远程堆栈路径:
												<code class="bg-muted px-1 rounded break-all">{configuredStackPath}</code>
											</p>
										{:else}
											<p class="text-muted-foreground">
												该路径由堆栈绑定挂载自动推导。如需手动指定，请前往
												<span class="font-medium text-foreground">环境管理 > 编辑 > 备份用远程堆栈路径</span>
												配置后重新打开此弹窗。
											</p>
										{/if}
									{:else}
										<p class="flex items-center gap-1.5 text-muted-foreground">
											{#if envIcon && envId != null}<EnvironmentIcon icon={envIcon} {envId} class="h-3.5 w-3.5 shrink-0" />{/if}
											{#if connectionType === 'hawser-edge'}
												<UndoDot class="h-3.5 w-3.5 shrink-0 text-green-500" />
											{:else}
												<Route class="h-3.5 w-3.5 shrink-0 text-purple-500" />
											{/if}
											<span><span class="font-medium text-foreground">{envLabel}</span> 属于 Hawser 环境。备份程序将从 Hawser 代理所在宿主机的堆栈目录读取文件夹。</span>
										</p>
										{#if configuredStackPath}
											<p class="text-muted-foreground">
												当前环境已配置远程堆栈路径:
												<code class="bg-muted px-1 rounded break-all">{configuredStackPath}</code>
											</p>
										{:else}
											<p class="text-muted-foreground">
												默认路径为 <code class="bg-muted px-1 rounded">/data/stacks</code>。若代理使用自定义 <code class="bg-muted px-1 rounded">STACKS_DIR</code>，请在
												<span class="font-medium text-foreground">环境管理 > 编辑 > 备份用远程堆栈路径</span>
												设置后重新打开弹窗。
											</p>
										{/if}
									{/if}
								</div>
							</Tooltip.Content>
						</Tooltip.Root>
					</div>
					<div class="mt-0.5 break-all font-mono text-muted-foreground">{listing.hostPath}</div>
				</div>
			</div>
		{:else}
			<!-- TAR mode: no host folder to read (direct-remote, no stack path set). Only Dockhand's
			     own copy of the compose/config is captured; bind-mount DATA on the remote host is NOT. -->
			<div class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
				<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
				<div class="min-w-0">
					<div class="font-medium text-amber-600 dark:text-amber-400">仅会备份以下编排与配置文件</div>
					<div class="mt-0.5 text-muted-foreground">当前环境未设置堆栈路径，无法读取远程宿主机文件夹。Dockhand 仅备份自身留存的配置文件，<strong>远程宿主机上绑定挂载的数据不会被包含在内</strong>。请为该环境配置堆栈路径以执行完整备份。</div>
				</div>
			</div>
		{/if}

		<div class="border rounded-md overflow-hidden">
			<div class="flex items-center gap-3 px-3 py-2 bg-muted/30 border-b">
				<Label class="text-xs">备份全部文件 (共 {selectable.length} 项可选择)</Label>
				<TogglePill checked={allFiles} onLabel="是" offLabel="否" onchange={() => toggleAll(!allFiles)} />
			</div>
			<div class="divide-y max-h-40 overflow-y-auto">
				{#each entries as entry}
					{@const locked = isLocked(entry)}
					<label class="flex items-center gap-2 px-3 py-1.5 text-xs" class:cursor-pointer={!allFiles && !locked} class:opacity-60={locked}>
						<Checkbox
							checked={!excludedStackFiles.includes(entry.name)}
							disabled={allFiles || locked}
							onCheckedChange={() => toggleEntry(entry)}
							class="h-3.5 w-3.5"
						/>
						{#if entry.type === 'dir'}
							<Folder class="h-3.5 w-3.5 shrink-0 text-sky-500" />
						{:else}
							<FileText class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						{/if}
						<span class="font-mono truncate">{entry.name}</span>
						{#if entry.capturedAs}
							<span class="text-muted-foreground ml-auto shrink-0 italic">在下方作为 {entry.capturedAs} 类型采集</span>
						{:else if isLoadBearing(entry.name)}
							<span class="text-muted-foreground ml-auto shrink-0 italic">强制保留</span>
						{:else if entry.type === 'file'}
							<span class="text-muted-foreground ml-auto shrink-0">{fmtSize(entry.size)}</span>
						{/if}
					</label>
				{/each}
			</div>
		</div>
	{:else if listing?.kind === 'helper-failed'}
		<!-- The probe helper container couldn't run on the target. A backup can't run either (it
		     uses the same helper), so this is a hard block, not a soft warning. -->
		<div class="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-xs">
			<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
			<div class="min-w-0">
				<div class="font-medium text-destructive">备份辅助容器无法在该环境运行</div>
				<div class="mt-0.5 break-all text-muted-foreground">{listing.reason}</div>
				<div class="mt-1 text-muted-foreground">无法创建备份，堆栈文件依赖同一辅助容器进行采集，请先修复该问题再重试。</div>
			</div>
		</div>
	{:else if listing?.kind === 'unknown'}
		<div class="flex items-start gap-2 rounded-md border bg-muted/30 p-2.5 text-xs">
			<Info class="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
			<div class="min-w-0">
				<div class="font-medium text-foreground">未在宿主机找到堆栈文件夹</div>
				<div class="mt-0.5 text-muted-foreground">{listing.reason}</div>
				{#if envKind === 'socket'}
					<div class="mt-1 text-muted-foreground">Socket 环境下通常是 <code class="bg-muted px-1 rounded">HOST_DATA_DIR</code> 与宿主机数据卷挂载路径不匹配，修正后取消并重配备份即可。</div>
				{:else if envKind === 'direct'}
					<div class="mt-1 text-muted-foreground">前往环境编辑页面填写 (备份用远程堆栈路径)，保存后取消并重配本次备份。</div>
				{:else}
					<div class="mt-1 text-muted-foreground">Hawser 环境大概率使用了自定义 <code class="bg-muted px-1 rounded">STACKS_DIR</code> (非默认 <code class="bg-muted px-1 rounded">/data/stacks</code>)，在环境编辑中填写远程堆栈路径后重新配置备份。</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
