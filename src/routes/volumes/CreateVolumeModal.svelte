<script lang="ts" module>
	type KeyValue = { key: string; value: string };
</script>

<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import { Plus, Trash2, HardDrive, Database, Server, ChevronDown } from 'lucide-svelte';

	const VOLUME_DRIVERS = [
		{ value: 'local', label: '本地', description: '默认本地驱动', icon: HardDrive },
		{ value: 'nfs', label: 'NFS', description: '网络文件系统', icon: Server },
		{ value: 'cifs', label: 'CIFS', description: 'Windows/SMB 共享', icon: Database }
	];

	const SMB_VERSIONS = [
		{ value: '2.0', label: 'SMB 2.0' },
		{ value: '2.1', label: 'SMB 2.1' },
		{ value: '3.0', label: 'SMB 3.0' },
		{ value: '3.1.1', label: 'SMB 3.1.1' }
	];

	const NFS_VERSIONS = [
		{ value: '3', label: 'NFSv3' },
		{ value: '4', label: 'NFSv4' },
		{ value: '4.1', label: 'NFSv4.1' },
		{ value: '4.2', label: 'NFSv4.2' }
	];

	import { currentEnvironment, appendEnvParam } from '$lib/stores/environment';
	import { focusFirstInput } from '$lib/utils';

	interface Props {
		open: boolean;
		onClose?: () => void;
		onSuccess?: () => void;
	}

	let { open = $bindable(), onClose, onSuccess }: Props = $props();

	// Form state
	let name = $state('');
	let driver = $state('local');
	let driverOpts = $state<KeyValue[]>([]);
	let labels = $state<KeyValue[]>([]);

	// CIFS fields
	let cifsServer = $state('');
	let cifsShare = $state('');
	let cifsUsername = $state('');
	let cifsPassword = $state('');
	let cifsVersion = $state('3.0');
	let cifsDomain = $state('');

	// NFS fields
	let nfsServer = $state('');
	let nfsPath = $state('');
	let nfsVersion = $state('4');
	let nfsSoft = $state(true);
	let nfsNolock = $state(true);
	let nfsReadOnly = $state(false);

	// Additional options visibility
	let showAdditionalOpts = $state(false);

	let creating = $state(false);
	let error = $state('');
	let errors = $state<{ name?: string; server?: string; share?: string; path?: string }>({});

	function addDriverOpt() {
		driverOpts = [...driverOpts, { key: '', value: '' }];
	}

	function removeDriverOpt(index: number) {
		driverOpts = driverOpts.filter((_, i) => i !== index);
	}

	function addLabel() {
		labels = [...labels, { key: '', value: '' }];
	}

	function removeLabel(index: number) {
		labels = labels.filter((_, i) => i !== index);
	}

	function resetForm() {
		name = '';
		driver = 'local';
		driverOpts = [];
		labels = [];
		cifsServer = '';
		cifsShare = '';
		cifsUsername = '';
		cifsPassword = '';
		cifsVersion = '3.0';
		cifsDomain = '';
		nfsServer = '';
		nfsPath = '';
		nfsVersion = '4';
		nfsSoft = true;
		nfsNolock = true;
		nfsReadOnly = false;
		showAdditionalOpts = false;
		error = '';
		errors = {};
	}

	async function handleCreate() {
		errors = {};

		if (!name.trim()) {
			errors.name = '数据卷名称为必填项';
		}

		// Validate driver-specific required fields
		if (driver === 'cifs') {
			if (!cifsServer.trim()) errors.server = '服务器地址为必填项';
			if (!cifsShare.trim()) errors.share = '共享路径为必填项';
		} else if (driver === 'nfs') {
			if (!nfsServer.trim()) errors.server = '服务器地址为必填项';
			if (!nfsPath.trim()) errors.path = '导出路径为必填项';
		}

		if (Object.keys(errors).length > 0) return;

		creating = true;
		error = '';

		try {
			const envId = $currentEnvironment?.id ?? null;

			// Build driverOpts based on driver type
			const driverOptsObj: Record<string, string> = {};

			if (driver === 'cifs') {
				driverOptsObj.type = 'cifs';
				const share = cifsShare.trim().replace(/^\/+/, '');
				driverOptsObj.device = `//${cifsServer.trim()}/${share}`;
				const opts = [`addr=${cifsServer.trim()}`, `username=${cifsUsername}`, `password=${cifsPassword}`, `vers=${cifsVersion}`];
				if (cifsDomain.trim()) opts.push(`domain=${cifsDomain.trim()}`);
				// Append additional options
				driverOpts.forEach(({ key, value }) => {
					if (key && value) opts.push(`${key}=${value}`);
					else if (key) opts.push(key);
				});
				driverOptsObj.o = opts.join(',');
			} else if (driver === 'nfs') {
				driverOptsObj.type = 'nfs';
				const path = nfsPath.trim().startsWith('/') ? nfsPath.trim() : `/${nfsPath.trim()}`;
				driverOptsObj.device = `:${path}`;
				const opts = [`addr=${nfsServer.trim()}`, `nfsvers=${nfsVersion}`];
				if (nfsSoft) opts.push('soft');
				if (nfsNolock) opts.push('nolock');
				if (nfsReadOnly) opts.push('ro');
				// Append additional options
				driverOpts.forEach(({ key, value }) => {
					if (key && value) opts.push(`${key}=${value}`);
					else if (key) opts.push(key);
				});
				driverOptsObj.o = opts.join(',');
			} else {
				// Local driver - use generic key-value pairs
				driverOpts.forEach(({ key, value }) => {
					if (key && value) {
						driverOptsObj[key] = value;
					}
				});
			}

			const labelsObj: Record<string, string> = {};
			labels.forEach(({ key, value }) => {
				if (key && value) {
					labelsObj[key] = value;
				}
			});

			const response = await fetch(appendEnvParam('/api/volumes', envId), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					driver: driver === 'nfs' || driver === 'cifs' ? 'local' : driver,
					driverOpts: driverOptsObj,
					labels: labelsObj
				})
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.details || data.error || '创建数据卷失败');
			}

			resetForm();
			open = false;
			onSuccess?.();
		} catch (err: any) {
			error = err.message || '创建数据卷失败';
			console.error('创建数据卷失败:', err);
		} finally {
			creating = false;
		}
	}

	function handleOpenChange(newOpen: boolean) {
		if (!newOpen && !creating) {
			resetForm();
		}
		open = newOpen;
	}
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => { if (isOpen) focusFirstInput(); handleOpenChange(isOpen); }}>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>创建数据卷</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-4">
			{#if error}
				<div class="text-sm text-red-600 dark:text-red-400 p-2 bg-red-50 dark:bg-red-950 rounded">
					{error}
				</div>
			{/if}

			<!-- Volume Name -->
			<div class="space-y-2">
				<Label for="volume-name">数据卷名称 *</Label>
				<Input
					id="volume-name"
					bind:value={name}
					placeholder="my-volume"
					disabled={creating}
					class={errors.name ? 'border-destructive focus-visible:ring-destructive' : ''}
					oninput={() => errors.name = undefined}
				/>
				{#if errors.name}
					<p class="text-xs text-destructive">{errors.name}</p>
				{/if}
			</div>

			<!-- Driver -->
			<div class="space-y-2">
				<Label for="driver">驱动程序</Label>
				<Select.Root type="single" bind:value={driver} disabled={creating}>
					<Select.Trigger class="w-full h-9">
						{@const selectedDriver = VOLUME_DRIVERS.find(d => d.value === driver)}
						<span class="flex items-center">
							{#if selectedDriver}
								<svelte:component this={selectedDriver.icon} class="w-4 h-4 mr-2 text-muted-foreground" />
								{selectedDriver.label}
							{:else}
								选择驱动程序
							{/if}
						</span>
					</Select.Trigger>
					<Select.Content>
						{#each VOLUME_DRIVERS as d}
							<Select.Item value={d.value} label={d.label}>
								<svelte:component this={d.icon} class="w-4 h-4 mr-2 text-muted-foreground" />
								<div class="flex flex-col">
									<span>{d.label}</span>
									<span class="text-xs text-muted-foreground">{d.description}</span>
								</div>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-xs text-muted-foreground">
					要使用的数据卷驱动 (本地为默认值)
				</p>
			</div>

			<!-- Driver-specific fields -->
			{#if driver === 'cifs'}
				<!-- CIFS fields -->
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="cifs-server">服务器 / IP 地址 *</Label>
						<Input
							id="cifs-server"
							bind:value={cifsServer}
							placeholder="192.168.1.100"
							disabled={creating}
							class={errors.server ? 'border-destructive focus-visible:ring-destructive' : ''}
							oninput={() => errors.server = undefined}
						/>
						{#if errors.server}
							<p class="text-xs text-destructive">{errors.server}</p>
						{/if}
					</div>
					<div class="space-y-2">
						<Label for="cifs-share">共享路径 *</Label>
						<Input
							id="cifs-share"
							bind:value={cifsShare}
							placeholder="shared/folder"
							disabled={creating}
							class={errors.share ? 'border-destructive focus-visible:ring-destructive' : ''}
							oninput={() => errors.share = undefined}
						/>
						{#if errors.share}
							<p class="text-xs text-destructive">{errors.share}</p>
						{/if}
					</div>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="cifs-username">用户名</Label>
						<Input
							id="cifs-username"
							bind:value={cifsUsername}
							placeholder="user"
							disabled={creating}
						/>
					</div>
					<div class="space-y-2">
						<Label for="cifs-password">密码</Label>
						<Input
							id="cifs-password"
							type="password"
							bind:value={cifsPassword}
							placeholder="••••••••"
							disabled={creating}
						/>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="cifs-version">SMB 版本</Label>
						<Select.Root type="single" bind:value={cifsVersion} disabled={creating}>
							<Select.Trigger class="w-full h-9">
								{SMB_VERSIONS.find(v => v.value === cifsVersion)?.label ?? '选择版本'}
							</Select.Trigger>
							<Select.Content>
								{#each SMB_VERSIONS as v}
									<Select.Item value={v.value} label={v.label}>{v.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="space-y-2">
						<Label for="cifs-domain">域</Label>
						<Input
							id="cifs-domain"
							bind:value={cifsDomain}
							placeholder="WORKGROUP"
							disabled={creating}
						/>
						<p class="text-xs text-muted-foreground">可选的 AD/工作组域</p>
					</div>
				</div>

				<!-- Additional options (collapsible) -->
				<div class="space-y-2">
					<button
						type="button"
						class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
						onclick={() => showAdditionalOpts = !showAdditionalOpts}
					>
						<ChevronDown class="w-3.5 h-3.5 transition-transform {showAdditionalOpts ? 'rotate-180' : ''}" />
						高级选项
					</button>
					{#if showAdditionalOpts}
						<div class="space-y-2 pl-1">
							<div class="flex items-center justify-end">
								<Button type="button" size="sm" variant="outline" onclick={addDriverOpt} disabled={creating}>
									<Plus class="w-3 h-3" />
									添加选项
								</Button>
							</div>
							{#if driverOpts.length > 0}
								{#each driverOpts as opt, i}
									<div class="flex gap-2">
										<Input bind:value={opt.key} placeholder="键" disabled={creating} class="flex-1" />
										<Input bind:value={opt.value} placeholder="值 (可选)" disabled={creating} class="flex-1" />
										<Button type="button" size="icon" variant="ghost" onclick={() => removeDriverOpt(i)} disabled={creating}>
											<Trash2 class="w-4 h-4" />
										</Button>
									</div>
								{/each}
							{:else}
								<p class="text-xs text-muted-foreground">附加到挂载字符串的额外挂载选项</p>
							{/if}
						</div>
					{/if}
				</div>
			{:else if driver === 'nfs'}
				<!-- NFS fields -->
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="nfs-server">服务器 / IP 地址 *</Label>
						<Input
							id="nfs-server"
							bind:value={nfsServer}
							placeholder="192.168.1.100"
							disabled={creating}
							class={errors.server ? 'border-destructive focus-visible:ring-destructive' : ''}
							oninput={() => errors.server = undefined}
						/>
						{#if errors.server}
							<p class="text-xs text-destructive">{errors.server}</p>
						{/if}
					</div>
					<div class="space-y-2">
						<Label for="nfs-path">导出路径 *</Label>
						<Input
							id="nfs-path"
							bind:value={nfsPath}
							placeholder="/exports/data"
							disabled={creating}
							class={errors.path ? 'border-destructive focus-visible:ring-destructive' : ''}
							oninput={() => errors.path = undefined}
						/>
						{#if errors.path}
							<p class="text-xs text-destructive">{errors.path}</p>
						{/if}
					</div>
				</div>
				<div class="space-y-2">
					<Label for="nfs-version">NFS 版本</Label>
					<Select.Root type="single" bind:value={nfsVersion} disabled={creating}>
						<Select.Trigger class="w-full max-w-[200px] h-9">
							{NFS_VERSIONS.find(v => v.value === nfsVersion)?.label ?? '选择版本'}
						</Select.Trigger>
						<Select.Content>
							{#each NFS_VERSIONS as v}
								<Select.Item value={v.value} label={v.label}>{v.label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex items-center gap-6">
					<div class="flex items-center gap-2">
						<TogglePill bind:checked={nfsSoft} onLabel="软挂载" offLabel="硬挂载" />
						<span class="text-xs text-muted-foreground">挂载</span>
					</div>
					<div class="flex items-center gap-2">
						<TogglePill bind:checked={nfsNolock} />
						<span class="text-xs text-muted-foreground">无锁</span>
					</div>
					<div class="flex items-center gap-2">
						<TogglePill bind:checked={nfsReadOnly} />
						<span class="text-xs text-muted-foreground">只读</span>
					</div>
				</div>

				<!-- Additional options (collapsible) -->
				<div class="space-y-2">
					<button
						type="button"
						class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
						onclick={() => showAdditionalOpts = !showAdditionalOpts}
					>
						<ChevronDown class="w-3.5 h-3.5 transition-transform {showAdditionalOpts ? 'rotate-180' : ''}" />
						高级选项
					</button>
					{#if showAdditionalOpts}
						<div class="space-y-2 pl-1">
							<div class="flex items-center justify-end">
								<Button type="button" size="sm" variant="outline" onclick={addDriverOpt} disabled={creating}>
									<Plus class="w-3 h-3" />
									添加选项
								</Button>
							</div>
							{#if driverOpts.length > 0}
								{#each driverOpts as opt, i}
									<div class="flex gap-2">
										<Input bind:value={opt.key} placeholder="键" disabled={creating} class="flex-1" />
										<Input bind:value={opt.value} placeholder="值 (可选)" disabled={creating} class="flex-1" />
										<Button type="button" size="icon" variant="ghost" onclick={() => removeDriverOpt(i)} disabled={creating}>
											<Trash2 class="w-4 h-4" />
										</Button>
									</div>
								{/each}
							{:else}
								<p class="text-xs text-muted-foreground">附加到挂载字符串的额外挂载选项</p>
							{/if}
						</div>
					{/if}
				</div>
			{:else}
				<!-- Local driver - generic key-value options -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<Label>驱动选项</Label>
						<Button
							type="button"
							size="sm"
							variant="outline"
							onclick={addDriverOpt}
							disabled={creating}
						>
							<Plus class="w-3 h-3" />
							添加选项
						</Button>
					</div>
					{#if driverOpts.length > 0}
						<div class="space-y-2">
							{#each driverOpts as opt, i}
								<div class="flex gap-2">
									<Input
										bind:value={opt.key}
										placeholder="键"
										disabled={creating}
										class="flex-1"
									/>
									<Input
										bind:value={opt.value}
										placeholder="值"
										disabled={creating}
										class="flex-1"
									/>
									<Button
										type="button"
										size="icon"
										variant="ghost"
										onclick={() => removeDriverOpt(i)}
										disabled={creating}
									>
										<Trash2 class="w-4 h-4" />
									</Button>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-xs text-muted-foreground">未配置任何驱动选项</p>
					{/if}
				</div>
			{/if}

			<!-- Labels -->
			<div class="space-y-2">
				<div class="flex items-center justify-between">
					<Label>标签</Label>
					<Button
						type="button"
						size="sm"
						variant="outline"
						onclick={addLabel}
						disabled={creating}
					>
						<Plus class="w-3 h-3" />
						添加标签
					</Button>
				</div>
				{#if labels.length > 0}
					<div class="space-y-2">
						{#each labels as label, i}
							<div class="flex gap-2">
								<Input
									bind:value={label.key}
									placeholder="键"
									disabled={creating}
									class="flex-1"
								/>
								<Input
									bind:value={label.value}
									placeholder="值"
									disabled={creating}
									class="flex-1"
								/>
								<Button
									type="button"
									size="icon"
									variant="ghost"
									onclick={() => removeLabel(i)}
									disabled={creating}
								>
									<Trash2 class="w-4 h-4" />
								</Button>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-xs text-muted-foreground">未配置任何标签</p>
				{/if}
			</div>

			<Dialog.Footer class="pt-4">
				<Button variant="outline" onclick={() => (open = false)} disabled={creating}>
					取消
				</Button>
				<Button onclick={handleCreate} disabled={creating}>
					{creating ? '创建中...' : '创建数据卷'}
				</Button>
			</Dialog.Footer>
		</div>
	</Dialog.Content>
</Dialog.Root>
