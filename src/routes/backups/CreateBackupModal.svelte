<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import CronEditor from '$lib/components/cron-editor.svelte';
	import { Package, Box, Layers, Search, Loader2, CheckCircle2, XCircle, ArrowBigRight, Settings, Clock, Play } from 'lucide-svelte';
	import EnvironmentIcon from '$lib/components/EnvironmentIcon.svelte';
	import { getRepoTypeIcon, formatCron, runBackupAction, isRemoteEnvironment, tagLogLine, type BackupFormState } from '$lib/utils/backup';
	import { toast } from 'svelte-sonner';
	import VolumePicker from '$lib/components/backup/VolumePicker.svelte';
	import DestinationPicker from '$lib/components/backup/DestinationPicker.svelte';
	import LogConsole from '$lib/components/LogConsole.svelte';
	import { normalizeMounts, volumesForStack, type VolumeInfo } from '$lib/utils/mounts';
	import { getLabelText } from '$lib/types';

	interface Props {
		open: boolean;
		onCreated?: () => void;
	}

	let { open = $bindable(), onCreated }: Props = $props();

	interface Environment { id: number; name: string; icon?: string; connectionType?: string; host?: string | null; }
	interface Destination { id: number; name: string; repository: string; }
	interface ContainerItem { name: string; type: 'container' | 'stack'; envId: number; envName: string; envIcon?: string; volumes: VolumeInfo[]; }

	// Step state (4 = running/complete)
	let step = $state<1 | 2 | 3 | 4>(1);

	// Step 1: Select source
	let environments = $state<Environment[]>([]);
	let selectedEnvId = $state<number | undefined>(undefined);
	let containers = $state<ContainerItem[]>([]);
	let loadingContainers = $state(false);
	let searchQuery = $state('');
	let selectedItem = $state<ContainerItem | null>(null);

	// Step 2: Configure
	let destinations = $state<Destination[]>([]);
	let selectedDestId = $state(0);
	let stopBeforeBackup = $state(false);
	let allVolumes = $state(true);
	let selectedVolumes = $state<string[]>([]);

	// Step 3: Schedule & Run
	let saveSchedule = $state(false);
	let schedule = $state('0 2 * * *');
	let scheduleInvalid = $state(false);
	let running = $state(false);

	// Step 4: Running log
	let logs = $state<string[]>([]);
	let backupStatus = $state<'idle' | 'running' | 'success' | 'error'>('idle');
	let backupError = $state('');

	$effect(() => {
		if (open) {
			step = 1;
			selectedItem = null;
			searchQuery = '';
			selectedEnvId = undefined;
			selectedDestId = 0;
			stopBeforeBackup = false;
			allVolumes = true;
			selectedVolumes = [];
			saveSchedule = false;
			schedule = '0 2 * * *';
			running = false;
			logs = [];
			backupStatus = 'idle';
			backupError = '';
			fetchEnvironments();
			fetchDestinations();
		}
	});

	async function fetchEnvironments() {
		try {
			const res = await fetch('/api/environments');
			environments = await res.json();
			if (environments.length === 1) {
				selectedEnvId = environments[0].id;
				fetchContainers(environments[0].id);
			}
		} catch {}
	}

	async function fetchDestinations() {
		try {
			const res = await fetch('/api/backup/destinations');
			destinations = await res.json();
			if (destinations.length === 1) selectedDestId = destinations[0].id;
		} catch {}
	}

	async function fetchContainers(envId: number) {
		loadingContainers = true;
		containers = [];
		try {
			const [contRes, stackRes] = await Promise.all([
				fetch(`/api/containers?env=${envId}`),
				fetch(`/api/stacks?env=${envId}`)
			]);
			const contData = await contRes.json();
			const stackData = await stackRes.json();
			const env = environments.find(e => e.id === envId);
			const items: ContainerItem[] = [];

			if (Array.isArray(contData)) {
				for (const c of contData) {
					items.push({ name: c.name || c.Names?.[0]?.replace(/^\//, ''), type: 'container', envId, envName: env?.name || '', envIcon: env?.icon, volumes: normalizeMounts(c.mounts || c.Mounts) });
				}
			}
			if (Array.isArray(stackData)) {
				for (const s of stackData) {
					// Only internal/git stacks are backup-able — Dockhand knows their compose
					// file location. External/untracked stacks (unknown compose path) would
					// produce an incomplete artifact, and the backend refuses them
					// (assertStackBackupable), so don't offer them as targets here.
					if (s.sourceType !== 'internal' && s.sourceType !== 'git') continue;
					items.push({ name: s.name, type: 'stack', envId, envName: env?.name || '', envIcon: env?.icon, volumes: volumesForStack(contData, s.name) });
				}
			}
			containers = items.sort((a, b) => a.name.localeCompare(b.name));
		} catch {}
		loadingContainers = false;
	}

	function selectSource(item: ContainerItem) {
		selectedItem = item;
		step = 2;
	}

	async function runBackup() {
		if (!selectedItem || !selectedDestId) return;
		running = true;
		logs = [];
		backupStatus = 'running';
		backupError = '';

		// Wizard exposes two intents: "run and save the schedule" or
		// "run once and discard". Both map cleanly onto the shared action
		// orchestrator — same code path as BackupPanel's Save & run / Run once.
		const form: BackupFormState = {
			targetName: selectedItem.name,
			type: selectedItem.type,
			environmentId: selectedItem.envId,
			destinationId: selectedDestId,
			stopBeforeBackup,
			allVolumes,
			selectedVolumes
		};

		try {
			const result = await runBackupAction({
				form,
				action: saveSchedule ? 'save-run' : 'run-once',
				schedule,
				enabled: true,
				onProgress: (line) => {
					if (line.event === 'progress') {
						const msg = (line.data as { message?: string } | null)?.message;
						if (msg) logs = [...logs, tagLogLine(msg)];
					}
				}
			});

			if (!result.ok) {
				backupStatus = 'error';
				backupError = result.error || '备份失败';
			} else {
				backupStatus = 'success';
				toast.success(saveSchedule ? '备份完成，计划任务已保存' : '备份完成');
			}
			onCreated?.();
		} catch (err: any) {
			backupStatus = 'error';
			backupError = err?.message || '备份失败';
		} finally {
			running = false;
		}
	}

	const filteredContainers = $derived(
		searchQuery.trim()
			? containers.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
			: containers
	);

	const getDestIcon = getRepoTypeIcon;
	const selectedDest = $derived(destinations.find(d => d.id === selectedDestId));
	// Used by the DestinationPicker to disable local-path destinations when
	// the chosen environment is remote (helper container on the remote host
	// can't read Dockhand's local filesystem).
	const selectedEnv = $derived(environments.find((e) => e.id === selectedItem?.envId));
	const isSelectedEnvRemote = $derived(isRemoteEnvironment(selectedEnv));
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => { if (!isOpen && running) return; open = isOpen; }}>
	<Dialog.Content class="max-w-3xl h-[70vh] flex flex-col">
		<Dialog.Header class="pb-0">
			<Dialog.Title class="flex items-center gap-2 text-base">
				<Package class="w-4 h-4" />新建备份
			</Dialog.Title>
			{#if selectedItem}
				<Dialog.Description class="flex items-center gap-2 text-sm flex-wrap">
					{#if selectedItem.type === 'container'}<Box class="w-4 h-4 text-blue-500" />{:else}<Layers class="w-4 h-4 text-purple-500" />{/if}
					{selectedItem.name}
					<span class="text-muted-foreground">位于</span>
					<EnvironmentIcon icon={selectedItem.envIcon || 'globe'} envId={selectedItem.envId} class="w-4 h-4 text-muted-foreground" />
					<span class="text-muted-foreground">{selectedItem.envName}</span>
					{#if selectedDest}
						<span class="text-muted-foreground">→</span>
						<svelte:component this={getDestIcon(selectedDest.repository)} class="w-4 h-4" />
						<span class="text-muted-foreground">{selectedDest.name}</span>
					{/if}
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		<!-- Stepper tabs -->
		<div class="flex items-center border-b shrink-0 px-1 bg-muted/10">
			<button
				class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-2 {step === 1 ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
				onclick={() => step = 1}
			>
				<Box class="w-4 h-4" />
				数据源
				{#if selectedItem}
					<CheckCircle2 class="w-3.5 h-3.5 text-green-500" />
				{/if}
			</button>
			<ArrowBigRight class="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
			<button
				class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 {step === 2 ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'} {selectedItem ? 'cursor-pointer hover:text-foreground' : 'cursor-not-allowed'}"
				disabled={!selectedItem}
				onclick={() => { if (selectedItem) step = 2; }}
			>
				<Settings class="w-4 h-4" />
				配置参数
				{#if selectedDestId}
					<CheckCircle2 class="w-3.5 h-3.5 text-green-500" />
				{/if}
			</button>
			<ArrowBigRight class="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
			<button
				class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 {step === 3 ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'} {selectedItem && selectedDestId ? 'cursor-pointer hover:text-foreground' : 'cursor-not-allowed'}"
				disabled={!selectedItem || !selectedDestId}
				onclick={() => { if (selectedItem && selectedDestId) step = 3; }}
			>
				<Clock class="w-4 h-4" />
				计划与执行
			</button>
		</div>

		<!-- Step content -->
		{#if step === 1}
			<!-- Sticky env selector + search -->
			<div class="shrink-0 flex gap-2 px-3 pt-3 pb-2">
				<Select.Root type="single" value={selectedEnvId ? String(selectedEnvId) : undefined} onValueChange={(v) => { selectedEnvId = Number(v); selectedItem = null; fetchContainers(Number(v)); }}>
					<Select.Trigger class="h-8 w-48 text-xs">
						{@const env = environments.find(e => e.id === selectedEnvId)}
						{#if env}
							<EnvironmentIcon icon={env.icon || 'globe'} envId={env.id} class="w-3 h-3 mr-1 text-muted-foreground" />{env.name}
						{:else}选择环境{/if}
					</Select.Trigger>
					<Select.Content>
						{#each environments as env}
							<Select.Item value={String(env.id)}>
								<EnvironmentIcon icon={env.icon || 'globe'} envId={env.id} class="w-3 h-3 mr-1.5 inline text-muted-foreground" />{env.name}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if selectedEnvId}
					<div class="relative flex-1">
						<Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
						<Input bind:value={searchQuery} placeholder="搜索容器和堆栈..." class="pl-8 h-8 text-xs" />
					</div>
				{/if}
			</div>
		{/if}
		<div class="flex-1 min-h-0 flex flex-col overflow-y-auto px-3 pb-3">
			{#if step === 1}
				<!-- Step 1: Select source -->
				<div class="space-y-3">

					{#if loadingContainers}
						<div class="flex items-center justify-center py-8"><Loader2 class="w-5 h-5 animate-spin text-muted-foreground" /></div>
					{:else if selectedEnvId && filteredContainers.length > 0}
						<div class="flex-1 overflow-y-auto border rounded">
							{#each filteredContainers as item}
								<button
									type="button"
									class="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors text-left border-b last:border-0 {selectedItem?.name === item.name && selectedItem?.envId === item.envId ? 'bg-primary/10' : ''}"
									onclick={() => selectSource(item)}
								>
									{#if item.type === 'container'}<Box class="w-3.5 h-3.5 text-muted-foreground shrink-0" />{:else}<Layers class="w-3.5 h-3.5 text-muted-foreground shrink-0" />{/if}
									<span class="font-medium truncate">{item.name}</span>
									<Badge variant="outline" class="text-xs ml-auto shrink-0">{getLabelText(item.type)}</Badge>
									{#if item.volumes.length > 0}
										<span class="text-xs text-muted-foreground shrink-0">{item.volumes.length} 个数据卷</span>
									{/if}
								</button>
							{/each}
						</div>
					{:else if selectedEnvId}
						<p class="text-xs text-muted-foreground py-4 text-center">未找到容器或堆栈</p>
					{:else}
						<p class="text-xs text-muted-foreground py-4 text-center">选择环境以查看可用数据源</p>
					{/if}
				</div>

			{:else if step === 2}
				<!-- Step 2: Configure -->
				<div class="space-y-4">
					<div class="space-y-1">
						<Label class="text-xs">备份仓库</Label>
						<DestinationPicker
							destinations={destinations}
							bind:value={selectedDestId}
							disableLocalForRemoteEnv={isSelectedEnvRemote}
						/>
					</div>

					<div class="flex items-center gap-3">
						<TogglePill bind:checked={stopBeforeBackup} />
						<div>
							<Label class="text-xs">备份期间停止{selectedItem ? getLabelText(selectedItem.type) : '容器'}</Label>
							<p class="text-xs text-muted-foreground">保证数据一致性 (备份完成后自动重启)</p>
						</div>
					</div>

					{#if selectedItem}
						<VolumePicker
							volumes={selectedItem.volumes}
							bind:allVolumes
							bind:selectedVolumes
							emptyLabel="该 {getLabelText(selectedItem.type)} 未检测到数据卷"
							showBindWarning={true}
						/>
					{/if}

					<div class="flex justify-end pt-2">
						<Button size="sm" onclick={() => step = 3} disabled={!selectedDestId}>
							下一步 <ArrowBigRight class="w-3.5 h-3.5 ml-1" />
						</Button>
					</div>
				</div>

			{:else if step === 3}
				<!-- Step 3: Schedule & Run -->
				<div class="flex flex-col gap-4 h-full">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground pb-2 border-b">
						{#if allVolumes}
							<span>全部数据卷</span>
						{:else}
							<span>{selectedVolumes.length} 个数据卷{selectedVolumes.length !== 1 ? '' : ''}</span>
						{/if}
						{#if stopBeforeBackup}
							<span class="text-muted-foreground">·</span>
							<span>备份时暂停服务</span>
						{/if}
					</div>

					<div class="flex items-center gap-2">
						<Checkbox checked={saveSchedule} onCheckedChange={() => { saveSchedule = !saveSchedule; }} />
						<span class="text-xs">保存为周期性计划任务</span>
					</div>

					{#if saveSchedule}
						<div class="pl-6">
							<CronEditor bind:value={schedule} bind:invalid={scheduleInvalid} />
						</div>
					{:else}
						<p class="pl-6 text-[11px] text-muted-foreground">
							仅立即执行一次。备份记录会保留在列表中，你可以后续重新执行或移除，不会自动定时运行。
						</p>
					{/if}

					{#if backupStatus === 'idle'}
						<!-- Not started yet -->
					{/if}

					<div class="flex items-center gap-2 pt-2">
						{#if backupStatus === 'idle' || (backupStatus !== 'running' && logs.length === 0)}
							<Button variant="outline" size="sm" onclick={() => step = 2} disabled={running}>返回</Button>
						{/if}
						<div class="flex-1"></div>
						{#if backupStatus === 'success'}
							<Button size="sm" onclick={() => { open = false; }}>
								<CheckCircle2 class="w-3.5 h-3.5 mr-1.5 text-green-500" />完成
							</Button>
						{:else if backupStatus === 'error' && !running}
							<Button size="sm" variant="outline" onclick={() => { backupStatus = 'idle'; logs = []; }}>
								重试
							</Button>
							<Button size="sm" onclick={() => { open = false; }}>关闭</Button>
						{:else}
							<Button size="sm" onclick={runBackup} disabled={running || (saveSchedule && scheduleInvalid)}>
								{#if running}<Loader2 class="w-3.5 h-3.5 mr-1.5 animate-spin" />{:else}<Play class="w-3.5 h-3.5 mr-1.5" />{/if}
								{saveSchedule ? '执行并保存计划' : '立即执行备份'}
							</Button>
						{/if}
					</div>

				<!-- Backup log — same shared renderer (pills, auto-scroll) as the backup
				     panel and restore modal, with the wizard's own status line below. -->
				{#if logs.length > 0 || running}
					<div class="mt-3 flex min-h-0 flex-1 flex-col">
						<LogConsole lines={logs} class="flex-1 min-h-0" />
						{#if backupStatus === 'running'}
							<div class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
								<Loader2 class="h-3 w-3 animate-spin" />正在备份…
							</div>
						{:else if backupStatus === 'success'}
							<div class="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-green-500">
								<CheckCircle2 class="h-3.5 w-3.5" />备份已完成
							</div>
						{:else if backupStatus === 'error'}
							<div class="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-red-400">
								<XCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" /><span class="break-all">{backupError || '执行失败'}</span>
							</div>
						{/if}
					</div>
				{/if}
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
