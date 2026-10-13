<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { ToggleGroup } from '$lib/components/ui/toggle-pill';
	import { Plus, Check, RefreshCw, Trash2 } from 'lucide-svelte';
	import { focusFirstInput } from '$lib/utils';

	// Protocol options for ports
	const protocolOptions = [
		{ value: 'tcp', label: 'TCP' },
		{ value: 'udp', label: 'UDP' }
	];

	// Mode options for volumes
	const volumeModeOptions = [
		{ value: 'rw', label: '读写' },
		{ value: 'ro', label: '只读' }
	];

	export interface ConfigSet {
		id: number;
		name: string;
		description?: string;
		envVars?: { key: string; value: string }[];
		labels?: { key: string; value: string }[];
		ports?: { hostPort: string; containerPort: string; protocol: string }[];
		volumes?: { hostPath: string; containerPath: string; mode: string }[];
		networkMode?: string;
		restartPolicy?: string;
		createdAt: string;
	}

	interface Props {
		open: boolean;
		configSet?: ConfigSet | null;
		onClose: () => void;
		onSaved: () => void;
	}

	let { open = $bindable(), configSet = null, onClose, onSaved }: Props = $props();

	const isEditing = $derived(configSet !== null);

	// Form state
	let formName = $state('');
	let formDescription = $state('');
	let formEnvVars = $state<{ key: string; value: string }[]>([{ key: '', value: '' }]);
	let formLabels = $state<{ key: string; value: string }[]>([{ key: '', value: '' }]);
	let formPorts = $state<{ hostPort: string; containerPort: string; protocol: string }[]>([{ hostPort: '', containerPort: '', protocol: 'tcp' }]);
	let formVolumes = $state<{ hostPath: string; containerPath: string; mode: string }[]>([{ hostPath: '', containerPath: '', mode: 'rw' }]);
	let formNetworkMode = $state('bridge');
	let formRestartPolicy = $state('no');
	let formError = $state('');
	let formErrors = $state<{ name?: string; ports?: string[] }>({});
	let formSaving = $state(false);

	// Validate port number
	function isValidPort(value: string): boolean {
		if (!value.trim()) return true; // Empty is ok (will be filtered out)
		const num = parseInt(value, 10);
		return !isNaN(num) && num >= 1 && num <= 65535 && String(num) === value.trim();
	}

	function validatePort(index: number, field: 'host' | 'container') {
		const port = formPorts[index];
		const value = field === 'host' ? port.hostPort : port.containerPort;

		if (!formErrors.ports) formErrors.ports = [];
		const errorKey = `${index}-${field}`;

		if (value.trim() && !isValidPort(value)) {
			if (!formErrors.ports.includes(errorKey)) {
				formErrors.ports = [...formErrors.ports, errorKey];
			}
		} else {
			formErrors.ports = formErrors.ports.filter(e => e !== errorKey);
		}
	}

	function hasPortError(index: number, field: 'host' | 'container'): boolean {
		return formErrors.ports?.includes(`${index}-${field}`) ?? false;
	}

	function resetForm() {
		formName = '';
		formDescription = '';
		formEnvVars = [{ key: '', value: '' }];
		formLabels = [{ key: '', value: '' }];
		formPorts = [{ hostPort: '', containerPort: '', protocol: 'tcp' }];
		formVolumes = [{ hostPath: '', containerPath: '', mode: 'rw' }];
		formNetworkMode = 'bridge';
		formRestartPolicy = 'no';
		formError = '';
		formErrors = {};
		formSaving = false;
	}

	// Initialize form when configSet changes or modal opens
	$effect(() => {
		if (open) {
			if (configSet) {
				formName = configSet.name;
				formDescription = configSet.description || '';
				formEnvVars = configSet.envVars?.length ? [...configSet.envVars] : [{ key: '', value: '' }];
				formLabels = configSet.labels?.length ? [...configSet.labels] : [{ key: '', value: '' }];
				formPorts = configSet.ports?.length ? [...configSet.ports] : [{ hostPort: '', containerPort: '', protocol: 'tcp' }];
				formVolumes = configSet.volumes?.length ? [...configSet.volumes] : [{ hostPath: '', containerPath: '', mode: 'rw' }];
				formNetworkMode = configSet.networkMode || 'bridge';
				formRestartPolicy = configSet.restartPolicy || 'no';
				formError = '';
				formErrors = {};
				formSaving = false;
			} else {
				resetForm();
			}
		}
	});

	function addEnvVar() { formEnvVars = [...formEnvVars, { key: '', value: '' }]; }
	function removeEnvVar(i: number) { formEnvVars = formEnvVars.filter((_, idx) => idx !== i); }
	function addLabel() { formLabels = [...formLabels, { key: '', value: '' }]; }
	function removeLabel(i: number) { formLabels = formLabels.filter((_, idx) => idx !== i); }
	function addPort() { formPorts = [...formPorts, { hostPort: '', containerPort: '', protocol: 'tcp' }]; }
	function removePort(i: number) { formPorts = formPorts.filter((_, idx) => idx !== i); }
	function addVolume() { formVolumes = [...formVolumes, { hostPath: '', containerPath: '', mode: 'rw' }]; }
	function removeVolume(i: number) { formVolumes = formVolumes.filter((_, idx) => idx !== i); }

	function getCleanedFormData() {
		return {
			name: formName.trim(),
			description: formDescription.trim() || undefined,
			envVars: formEnvVars.filter(e => e.key.trim()),
			labels: formLabels.filter(l => l.key.trim()),
			ports: formPorts.filter(p => p.containerPort.trim()),
			volumes: formVolumes.filter(v => v.hostPath.trim() && v.containerPath.trim()),
			networkMode: formNetworkMode,
			restartPolicy: formRestartPolicy
		};
	}

	async function save() {
		formErrors = {};

		if (!formName.trim()) {
			formErrors.name = '名称不能为空';
		}

		// Validate all ports
		const portErrors: string[] = [];
		formPorts.forEach((port, i) => {
			if (port.hostPort.trim() && !isValidPort(port.hostPort)) {
				portErrors.push(`${i}-host`);
			}
			if (port.containerPort.trim() && !isValidPort(port.containerPort)) {
				portErrors.push(`${i}-container`);
			}
		});
		if (portErrors.length > 0) {
			formErrors.ports = portErrors;
		}

		// Stop if there are any errors
		if (formErrors.name || (formErrors.ports && formErrors.ports.length > 0)) {
			return;
		}

		formSaving = true;
		formError = '';

		try {
			const url = isEditing ? `/api/config-sets/${configSet!.id}` : '/api/config-sets';
			const method = isEditing ? 'PUT' : 'POST';

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(getCleanedFormData())
			});

			if (response.ok) {
				open = false;
				onSaved();
			} else {
				const data = await response.json();
				if (data.error?.includes('already exists')) {
					formErrors.name = '配置集名称已存在';
				} else {
					formError = data.error || `配置集 ${isEditing ? '更新' : '创建'} 失败`;
				}
			}
		} catch {
			formError = `配置集 ${isEditing ? '更新' : '创建'} 失败`;
		} finally {
			formSaving = false;
		}
	}

	function handleClose() {
		open = false;
		onClose();
	}
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (o) { formError = ''; formErrors = {}; focusFirstInput(); } }}>
	<Dialog.Content class="max-w-3xl max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{isEditing ? '编辑' : '添加'}配置集</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-4">
			{#if formError}
				<div class="text-sm text-red-600 dark:text-red-400">{formError}</div>
			{/if}

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="cfg-name">名称 *</Label>
					<Input
						id="cfg-name"
						bind:value={formName}
						placeholder="production-web"
						class={formErrors.name ? 'border-destructive focus-visible:ring-destructive' : ''}
						oninput={() => formErrors.name = undefined}
					/>
					{#if formErrors.name}
						<p class="text-xs text-destructive">{formErrors.name}</p>
					{/if}
				</div>
				<div class="space-y-2">
					<Label for="cfg-description">描述</Label>
					<Input id="cfg-description" bind:value={formDescription} placeholder="Web 服务通用配置" />
				</div>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="cfg-network">网络模式</Label>
					<Select.Root type="single" value={formNetworkMode} onValueChange={(v) => formNetworkMode = v}>
						<Select.Trigger class="w-full">
							<span>{formNetworkMode === 'bridge' ? '桥接' : formNetworkMode === 'host' ? '主机' : '无'}</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="bridge" label="桥接" />
							<Select.Item value="host" label="主机" />
							<Select.Item value="none" label="无" />
						</Select.Content>
					</Select.Root>
				</div>
				<div class="space-y-2">
					<Label for="cfg-restart">重启策略</Label>
					<Select.Root type="single" value={formRestartPolicy} onValueChange={(v) => formRestartPolicy = v}>
						<Select.Trigger class="w-full">
							<span>{formRestartPolicy === 'no' ? '不重启' : formRestartPolicy === 'always' ? '始终重启' : formRestartPolicy === 'on-failure' ? '失败时重启' : '除非手动停止'}</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="no" label="不重启" />
							<Select.Item value="always" label="始终重启" />
							<Select.Item value="on-failure" label="失败时重启" />
							<Select.Item value="unless-stopped" label="除非手动停止" />
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			<!-- Environment Variables -->
			<div class="space-y-2 border-t pt-4">
				<div class="flex justify-between items-center">
					<Label class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">环境变量</Label>
					<Button type="button" size="sm" variant="ghost" onclick={addEnvVar} class="h-7 text-xs">
						<Plus class="w-3.5 h-3.5" />添加
					</Button>
				</div>
				{#each formEnvVars as envVar, i}
					<div class="flex gap-2 items-center">
						<Input bind:value={envVar.key} placeholder="变量名" class="flex-1 h-8" />
						<Input bind:value={envVar.value} placeholder="变量值" class="flex-1 h-8" />
						<Button type="button" size="icon" variant="ghost" onclick={() => removeEnvVar(i)} disabled={formEnvVars.length === 1} class="h-8 w-8">
							<Trash2 class="w-3 h-3 text-muted-foreground" />
						</Button>
					</div>
				{/each}
			</div>

			<!-- Labels -->
			<div class="space-y-2 border-t pt-4">
				<div class="flex justify-between items-center">
					<Label class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">标签</Label>
					<Button type="button" size="sm" variant="ghost" onclick={addLabel} class="h-7 text-xs">
						<Plus class="w-3.5 h-3.5" />添加
					</Button>
				</div>
				{#each formLabels as label, i}
					<div class="flex gap-2 items-center">
						<Input bind:value={label.key} placeholder="标签键" class="flex-1 h-8" />
						<Input bind:value={label.value} placeholder="标签值" class="flex-1 h-8" />
						<Button type="button" size="icon" variant="ghost" onclick={() => removeLabel(i)} disabled={formLabels.length === 1} class="h-8 w-8">
							<Trash2 class="w-3 h-3 text-muted-foreground" />
						</Button>
					</div>
				{/each}
			</div>

			<!-- Ports -->
			<div class="space-y-2 border-t pt-4">
				<div class="flex justify-between items-center">
					<Label class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">端口映射</Label>
					<Button type="button" size="sm" variant="ghost" onclick={addPort} class="h-7 text-xs">
						<Plus class="w-3.5 h-3.5" />添加
					</Button>
				</div>
				{#each formPorts as port, i}
					<div class="grid grid-cols-[1fr_1fr_5rem_auto] gap-2 items-start">
						<div>
							<Input
								bind:value={port.hostPort}
								placeholder="主机端口"
								class="h-8 {hasPortError(i, 'host') ? 'border-destructive focus-visible:ring-destructive' : ''}"
								oninput={() => validatePort(i, 'host')}
							/>
							{#if hasPortError(i, 'host')}
								<p class="text-xs text-destructive mt-0.5">端口无效 (1-65535)</p>
							{/if}
						</div>
						<div>
							<Input
								bind:value={port.containerPort}
								placeholder="容器端口"
								class="h-8 {hasPortError(i, 'container') ? 'border-destructive focus-visible:ring-destructive' : ''}"
								oninput={() => validatePort(i, 'container')}
							/>
							{#if hasPortError(i, 'container')}
								<p class="text-xs text-destructive mt-0.5">端口无效 (1-65535)</p>
							{/if}
						</div>
						<ToggleGroup
							value={port.protocol}
							options={protocolOptions}
							onchange={(v) => { formPorts[i].protocol = v; formPorts = formPorts; }}
						/>
						<Button type="button" size="icon" variant="ghost" onclick={() => removePort(i)} disabled={formPorts.length === 1} class="h-8 w-8">
							<Trash2 class="w-3 h-3 text-muted-foreground" />
						</Button>
					</div>
				{/each}
			</div>

			<!-- Volumes -->
			<div class="space-y-2 border-t pt-4">
				<div class="flex justify-between items-center">
					<Label class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">数据卷映射</Label>
					<Button type="button" size="sm" variant="ghost" onclick={addVolume} class="h-7 text-xs">
						<Plus class="w-3.5 h-3.5" />添加
					</Button>
				</div>
				{#each formVolumes as vol, i}
					<div class="grid grid-cols-[1fr_1fr_5rem_auto] gap-2 items-center">
						<Input bind:value={vol.hostPath} placeholder="主机路径" class="h-8" />
						<Input bind:value={vol.containerPath} placeholder="容器路径" class="h-8" />
						<ToggleGroup
							value={vol.mode}
							options={volumeModeOptions}
							onchange={(v) => { formVolumes[i].mode = v; formVolumes = formVolumes; }}
						/>
						<Button type="button" size="icon" variant="ghost" onclick={() => removeVolume(i)} disabled={formVolumes.length === 1} class="h-8 w-8">
							<Trash2 class="w-3 h-3 text-muted-foreground" />
						</Button>
					</div>
				{/each}
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={handleClose}>取消</Button>
			<Button onclick={save} disabled={formSaving}>
				{#if formSaving}
					<RefreshCw class="w-4 h-4 mr-1 animate-spin" />
				{:else if isEditing}
					<Check class="w-4 h-4" />
				{:else}
					<Plus class="w-4 h-4" />
				{/if}
				{isEditing ? '保存' : '添加'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
