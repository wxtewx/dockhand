<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Input } from '$lib/components/ui/input';
	import { Plus, Check, RefreshCw, Wifi, Database, HardDrive, Dices, Copy, BarChart3, Loader2, Clock, PackageCheck, FolderCheck, Unlock, CircleHelp, AlertTriangle } from 'lucide-svelte';
	import cronstrue from 'cronstrue/i18n';
	import { formatBytes } from '$lib/utils/format';
	import CronEditor from '$lib/components/cron-editor.svelte';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import * as Popover from '$lib/components/ui/popover';
	import { AmazonS3Icon, BackblazeIcon, AzureBlobIcon, GoogleCloudIcon, RestServerIcon } from '$lib/components/cloud-icons';
	import { toast } from 'svelte-sonner';
	import { focusFirstInput } from '$lib/utils';
	import { getResticText } from '$lib/types';

	interface Destination {
		id: number;
		name: string;
		repository: string;
		hostPath?: string | null;
		envVars?: Record<string, string>;
		flags?: string;
		policies?: string | null;
		lastTestStatus?: string | null;
		createdAt: string;
		updatedAt: string;
	}

	interface Props {
		open: boolean;
		destination?: Destination | null;
		existingDestinations?: Destination[];
		onClose: () => void;
		onSaved: () => void;
	}

	let { open = $bindable(), destination = null, existingDestinations = [], onClose, onSaved }: Props = $props();
	const isEditing = $derived(destination !== null);

	// Stats for existing destinations
	let repoStats = $state<{ totalSize: number; totalFiles: number; snapshots: number } | null>(null);
	let loadingStats = $state(false);

	async function fetchStats() {
		if (!destination?.id) return;
		loadingStats = true;
		try {
			const res = await fetch(`/api/backup/destinations/${destination.id}/task`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ task: 'stats' })
			});
			const data = await res.json();
			if (data.success && data.stats) repoStats = data.stats;
		} catch {} finally { loadingStats = false; }
	}

	$effect(() => {
		if (open && destination?.id) {
			repoStats = null;
			fetchStats();
		}
	});

	interface FormField {
		key: string;
		label: string;
		placeholder: string;
		secret?: boolean;
		envKey?: string; // if set, stored as env var instead of part of repo URL
	}

	interface BackendType {
		value: string;
		label: string;
		icon: any;
		fields: FormField[];
		buildRepo: (fields: Record<string, string>) => string;
		parseRepo: (repo: string) => Record<string, string>;
	}

	const backendTypes: BackendType[] = [
		{
			value: 'local', label: '本地路径', icon: HardDrive,
			fields: [
				{ key: 'path', label: '路径', placeholder: '/mnt/backups/dockhand' }
			],
			buildRepo: (f) => f.path || '',
			parseRepo: (repo) => ({ path: repo })
		},
		{
			value: 's3', label: 'Amazon S3', icon: AmazonS3Icon,
			fields: [
				{ key: 'endpoint', label: '接入地址', placeholder: 's3.amazonaws.com (or http://minio:9000)' },
				{ key: 'bucket', label: '存储桶', placeholder: 'my-backup-bucket' },
				{ key: 'path', label: '路径 (可选)', placeholder: 'dockhand' },
				{ key: 'accessKey', label: '访问密钥 ID', placeholder: '', envKey: 'AWS_ACCESS_KEY_ID' },
				{ key: 'secretKey', label: '私有访问密钥', placeholder: '', secret: true, envKey: 'AWS_SECRET_ACCESS_KEY' }
			],
			buildRepo: (f) => {
				const endpoint = f.endpoint || 's3.amazonaws.com';
				const path = f.path ? `/${f.path}` : '';
				return `s3:${endpoint.includes('://') ? '' : 'https://'}${endpoint}/${f.bucket}${path}`;
			},
			parseRepo: (repo) => {
				// s3:https://s3.amazonaws.com/bucket/path or s3:http://minio:9000/bucket/path
				const after = repo.replace(/^s3:/, '');
				try {
					const url = new URL(after.startsWith('http') ? after : `https://${after}`);
					const parts = url.pathname.replace(/^\//, '').split('/');
					const bucket = parts[0] || '';
					const path = parts.slice(1).join('/');
					const endpoint = after.startsWith('http') ? `${url.protocol}//${url.host}` : url.host;
					return { endpoint, bucket, path };
				} catch {
					return { endpoint: '', bucket: '', path: '' };
				}
			}
		},
		{
			value: 'b2', label: 'Backblaze B2', icon: BackblazeIcon,
			fields: [
				{ key: 'bucket', label: '存储桶', placeholder: 'my-backup-bucket' },
				{ key: 'path', label: '路径 (选填)', placeholder: 'dockhand' },
				{ key: 'accountId', label: '密钥 ID', placeholder: '', envKey: 'B2_ACCOUNT_ID' },
				{ key: 'accountKey', label: '应用密钥', placeholder: '', secret: true, envKey: 'B2_ACCOUNT_KEY' }
			],
			buildRepo: (f) => `b2:${f.bucket}:${f.path || ''}`.replace(/:$/, ''),
			parseRepo: (repo) => {
				const after = repo.replace(/^b2:/, '');
				const [bucket, ...rest] = after.split(':');
				return { bucket: bucket || '', path: rest.join(':') };
			}
		},
		{
			value: 'azure', label: 'Azure Blob', icon: AzureBlobIcon,
			fields: [
				{ key: 'container', label: '容器', placeholder: 'my-backup-container' },
				{ key: 'path', label: '路径 (可选)', placeholder: 'dockhand' },
				{ key: 'accountName', label: '账户名称', placeholder: '', envKey: 'AZURE_ACCOUNT_NAME' },
				{ key: 'accountKey', label: '账户密钥', placeholder: '', secret: true, envKey: 'AZURE_ACCOUNT_KEY' }
			],
			buildRepo: (f) => `azure:${f.container}:${f.path || ''}`.replace(/:$/, ''),
			parseRepo: (repo) => {
				const after = repo.replace(/^azure:/, '');
				const [container, ...rest] = after.split(':');
				return { container: container || '', path: rest.join(':') };
			}
		},
		{
			value: 'gs', label: 'Google Cloud', icon: GoogleCloudIcon,
			fields: [
				{ key: 'bucket', label: '存储桶', placeholder: 'my-backup-bucket' },
				{ key: 'path', label: '路径 (可选)', placeholder: '/dockhand' },
				{ key: 'accessToken', label: '访问令牌', placeholder: '', secret: true, envKey: 'GOOGLE_ACCESS_TOKEN' }
			],
			buildRepo: (f) => `gs:${f.bucket}:${f.path || '/'}`,
			parseRepo: (repo) => {
				const after = repo.replace(/^gs:/, '');
				const [bucket, ...rest] = after.split(':');
				return { bucket: bucket || '', path: rest.join(':') };
			}
		},
		{
			value: 'rest', label: 'REST server', icon: RestServerIcon,
			fields: [
				{ key: 'url', label: '服务端地址', placeholder: 'https://backup-server:8000/repo-name' }
			],
			buildRepo: (f) => `rest:${f.url || ''}`,
			parseRepo: (repo) => ({ url: repo.replace(/^rest:/, '') })
		}
	];

	let formName = $state('');
	let formBackendType = $state('local');
	let formFields = $state<Record<string, string>>({});
	let formPassword = $state('');
	let formFlags = $state('');
	let formError = $state('');
	let formSaving = $state(false);

	// Policies
	let policyPruneEnabled = $state(true);
	let policyPruneSchedule = $state('0 0 1 * *');
	let policyPruneMaxUnused = $state('10');
	let policyCheckEnabled = $state(true);
	let policyCheckSchedule = $state('0 0 1 * *');
	let policyVerifyEnabled = $state(false);
	let policyVerifySchedule = $state('0 0 1 * *');
	let policyVerifyDataSubset = $state('5%');
	let policyAutoUnlock = $state(true);
	let testing = $state(false);
	let initializing = $state(false);
	// Set when a Test on a NEW (unsaved) destination reports the repo reachable but
	// not yet initialised. It flips the create button to "Save and init" so the user
	// can save + init in one click. Reset whenever the repo fields change (a stale
	// verdict must not drive the button after the user edits the target).
	let needsInit = $state(false);

	const selectedBackend = $derived(backendTypes.find(b => b.value === formBackendType) ?? backendTypes[0]);
	const repoFields = $derived(selectedBackend.fields.filter(f => !f.envKey));
	const credentialFields = $derived(selectedBackend.fields.filter(f => f.envKey));

	function detectBackendType(repo: string): string {
		for (const prefix of ['s3:', 'b2:', 'azure:', 'gs:', 'rest:']) {
			if (repo.startsWith(prefix)) return prefix.slice(0, -1);
		}
		return 'local';
	}

	function resetForm() {
		formName = ''; formBackendType = 'local'; formFields = {}; formPassword = '';
		formFlags = ''; formError = '';
		formSaving = false;
		policyPruneEnabled = true; policyPruneSchedule = '0 0 1 * *'; policyPruneMaxUnused = '10';
		policyCheckEnabled = true; policyCheckSchedule = '0 0 1 * *';
		policyVerifyEnabled = false; policyVerifySchedule = '0 0 1 * *'; policyVerifyDataSubset = '5%';
		policyAutoUnlock = true;
	}

	$effect(() => {
		if (open) {
			if (destination) {
				formName = destination.name;
				const type = detectBackendType(destination.repository);
				formBackendType = type;
				const backend = backendTypes.find(b => b.value === type);
				// Parse repo URL into fields, then merge credential env vars
				const fields = backend ? backend.parseRepo(destination.repository) : {};
				if (destination.envVars) {
					for (const [key, value] of Object.entries(destination.envVars)) {
						const field = backend?.fields.find(f => f.envKey === key);
						if (field) fields[field.key] = value as string;
					}
				}
				formFields = fields;
				formPassword = '';
				formFlags = destination.flags || '';
				formError = '';
				// Load policies
				const pol = destination.policies ? (() => { try { return JSON.parse(destination.policies); } catch { return {}; } })() : {};
				policyPruneEnabled = pol.pruneEnabled ?? true;
				policyPruneSchedule = pol.pruneSchedule || '0 0 1 * *';
				policyPruneMaxUnused = pol.pruneMaxUnused || '10';
				policyCheckEnabled = pol.checkEnabled ?? true;
				policyCheckSchedule = pol.checkSchedule || '0 0 1 * *';
				policyVerifyEnabled = pol.verifyEnabled ?? false;
				policyVerifySchedule = pol.verifySchedule || '0 0 1 * *';
				policyVerifyDataSubset = pol.verifyDataSubset || '5%';
				policyAutoUnlock = pol.autoUnlock ?? true;
			} else { resetForm(); }
		}
	});

	let generatedOk = $state(false);
	let copiedOk = $state(false);

	function generatePassword() {
		const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*-_=+';
		// Rejection sampling to avoid modulo bias: 256 % 72 = 40, so bytes >= 216
		// are discarded and re-drawn, keeping every character uniformly likely.
		const max = 256 - (256 % chars.length); // 216
		const result: string[] = [];
		while (result.length < 32) {
			const batch = new Uint8Array(32);
			crypto.getRandomValues(batch);
			for (const b of batch) {
				if (b >= max) continue;
				result.push(chars[b % chars.length]);
				if (result.length === 32) break;
			}
		}
		formPassword = result.join('');
		generatedOk = true;
		setTimeout(() => { generatedOk = false; }, 1500);
	}

	function copyPassword() {
		copyToClipboard(formPassword);
		copiedOk = true;
		setTimeout(() => { copiedOk = false; }, 1500);
	}

	function handleBackendChange(value: string) {
		formBackendType = value;
		formFields = {};
	}

	async function testConnection() {
		testing = true;
		try {
			let payload: Record<string, unknown>;
			if (isEditing) {
				// Use saved credentials from DB
				payload = { destinationId: destination!.id };
			} else {
				const repository = selectedBackend.buildRepo(formFields);
				if (!repository.trim()) { toast.error('请先填写仓库信息再进行测试'); testing = false; return; }
				if (!formPassword.trim()) { toast.error('请输入加密密码再进行测试'); testing = false; return; }
				const envVars: Record<string, string> = {};
				for (const field of selectedBackend.fields) {
					if (field.envKey && formFields[field.key]?.trim()) envVars[field.envKey] = formFields[field.key];
				}
				payload = { repository, password: formPassword, envVars: Object.keys(envVars).length > 0 ? envVars : undefined };
			}
			const res = await fetch('/api/backup/destinations/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const data = await res.json();
			if (data.success && data.needsInit) {
				// Only the create flow gets the "Save and init" button; editing an
				// existing destination already has its own "Init repo" action.
				needsInit = !isEditing;
				toast.info(data.message || '连接正常，但仓库需要初始化');
			} else {
				needsInit = false;
				toast[res.ok && data.success ? 'success' : 'error'](data.success ? '连接测试成功' : (data.error || '连接测试失败'));
			}
		} catch { toast.error('连接测试失败'); } finally { testing = false; }
	}

	async function initRepo() {
		if (!destination) return;
		initializing = true;
		try {
			const res = await fetch(`/api/backup/destinations/${destination.id}/init`, { method: 'POST' });
			const data = await res.json();
			toast[res.ok && data.success ? 'success' : 'error'](data.success ? '仓库初始化完成' : (data.error || '初始化失败'));
		} catch { toast.error('初始化失败'); } finally { initializing = false; }
	}

	// Normalize a restic repository string for loose equality: lowercase, drop
	// trailing slashes, collapse internal whitespace. Good enough to catch the
	// common "same repo, two rows" mistake (s3:https://host/bucket vs the same
	// with a trailing slash). This only gates a non-blocking WARNING, so a missed
	// match just means no warning — never a false block.
	function normalizeRepo(repo: string): string {
		return repo.trim().toLowerCase().replace(/\/+$/, '').replace(/\s+/g, ' ');
	}

	// Set to the colliding destination's name when the entered repo matches an
	// existing destination's repo. Shows a warning + flips Save to "Save anyway".
	let repoConflictName = $state<string | null>(null);

	// Editing the repo after the warning appeared clears it, so the user must
	// re-confirm against whatever repo they end up with (not a stale acknowledgement).
	const currentRepo = $derived(selectedBackend.buildRepo(formFields));
	$effect(() => {
		currentRepo; // track
		repoConflictName = null;
	});
	// Any change to the target (repo string OR credentials OR password) invalidates a
	// prior Test verdict, so the "Save and init" state must not linger.
	$effect(() => {
		currentRepo; formFields; formPassword; // track
		needsInit = false;
	});

	async function save() {
		if (!formName.trim()) { formError = '名称不能为空'; return; }
		const repository = selectedBackend.buildRepo(formFields);
		if (!repository.trim()) { formError = '仓库信息填写不完整'; return; }

		// Warn (once) if this repo is already used by another destination. Backups
		// to a shared repo are serialized (restic locks the repo), not parallel —
		// legitimate for rotation/migration, but usually a mistake. Non-blocking:
		// a second click on "Save anyway" proceeds.
		if (!repoConflictName) {
			const norm = normalizeRepo(repository);
			const clash = existingDestinations.find(
				(d) => d.id !== destination?.id && normalizeRepo(d.repository) === norm
			);
			if (clash) { repoConflictName = clash.name; return; }
		}

		formSaving = true; formError = '';
		try {
			const envVars: Record<string, string> = {};
			for (const field of selectedBackend.fields) {
				if (field.envKey && formFields[field.key]?.trim()) {
					envVars[field.envKey] = formFields[field.key];
				}
			}
			const policies = {
				pruneEnabled: policyPruneEnabled,
				pruneSchedule: policyPruneSchedule,
				pruneMaxUnused: policyPruneMaxUnused,
				checkEnabled: policyCheckEnabled,
				checkSchedule: policyCheckSchedule,
				verifyEnabled: policyVerifyEnabled,
				verifySchedule: policyVerifySchedule,
				verifyDataSubset: policyVerifyDataSubset,
				autoUnlock: policyAutoUnlock
			};
			const body: Record<string, unknown> = {
				name: formName.trim(), repository,
				envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
				flags: formFlags.trim() || undefined,
				policies: JSON.stringify(policies)
			};
			if (formPassword || !isEditing) body.password = formPassword || undefined;
			const res = await fetch(isEditing ? `/api/backup/destinations/${destination!.id}` : '/api/backup/destinations', {
				method: isEditing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
			});
			// Creating a destination auto-initialises its repository server-side, so a
			// create over a reachable-but-uninitialised repo (needsInit) needs no extra
			// call here — the button just tells the user that up front ("Save and init").
			if (res.ok) { open = false; onSaved(); toast.success(needsInit ? '存储目标已创建且仓库初始化完成' : isEditing ? '存储目标已更新' : '存储目标已创建'); }
			else { const data = await res.json(); formError = data.error || '操作失败'; }
		} catch { formError = '操作失败'; } finally { formSaving = false; }
	}
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (o) { formError = ''; repoConflictName = null; focusFirstInput(); } }}>
	<Dialog.Content class="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
		<Dialog.Header>
			<Dialog.Title>{isEditing ? '编辑备份存储目标' : '添加备份存储目标'}</Dialog.Title>
			<Dialog.Description>{isEditing ? '修改备份存储目标配置' : '配置 restic 备份仓库'}</Dialog.Description>
		</Dialog.Header>

		{#if formError}<p class="text-sm text-destructive">{formError}</p>{/if}

		<div class="flex-1 overflow-y-auto pr-3">
		{#if selectedBackend.value === 'local'}
			<div class="flex items-start gap-2 p-2.5 mt-4 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
				<HardDrive class="w-3.5 h-3.5 shrink-0 mt-0.5" />
				<span>本地路径仓库仅可在本机 Docker 主机运行，或同一主机上部署的同址套接字代理。如需连接远程主机，请使用 S3、REST 或其他远程后端。</span>
			</div>
		{/if}
		<div class="grid grid-cols-2 gap-6 py-4">
			<!-- Left column: connection -->
			<div class="space-y-4">
				<div class="space-y-2">
					<Label for="dest-name">名称</Label>
					<Input id="dest-name" bind:value={formName} />
				</div>

				<div class="space-y-2">
					<Label>存储后端类型</Label>
					<Select.Root type="single" value={formBackendType} onValueChange={handleBackendChange}>
						<Select.Trigger class="w-full">
							<span class="flex items-center gap-2">
								<selectedBackend.icon class="w-4 h-4 text-muted-foreground" />
								{selectedBackend.label}
							</span>
						</Select.Trigger>
						<Select.Content>
							{#each backendTypes as backend}
								<Select.Item value={backend.value}>
									<span class="flex items-center gap-2">
										<backend.icon class="w-4 h-4 text-muted-foreground" />
										{backend.label}
									</span>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				{#each repoFields as field}
					<div class="space-y-1">
						<Label for="field-{field.key}">{field.label}</Label>
						<Input
							id="field-{field.key}"
							value={formFields[field.key] ?? ''}
							oninput={(e: Event) => { formFields[field.key] = (e.target as HTMLInputElement).value; }}
							placeholder={field.placeholder}
						/>
					</div>
				{/each}
			</div>

			<!-- Right column: credentials & security -->
			<div class="space-y-4">
				{#each credentialFields as field}
					{#if field.key === 'skipHostKey'}
						<div class="flex items-center justify-between">
							<Label>{field.label}</Label>
							<TogglePill checked={formFields[field.key] === 'true'} onchange={() => { formFields[field.key] = formFields[field.key] === 'true' ? '' : 'true'; }} />
						</div>
					{:else}
						<div class="space-y-1">
							<Label for="field-{field.key}">{field.label}</Label>
							<Input
								id="field-{field.key}"
								type={field.secret ? 'password' : 'text'}
								value={formFields[field.key] ?? ''}
								oninput={(e: Event) => { formFields[field.key] = (e.target as HTMLInputElement).value; }}
								placeholder={isEditing && field.secret ? '(留空则保持原有值)' : field.placeholder}
							/>
						</div>
					{/if}
				{/each}

				<div class="space-y-2">
					<Label for="dest-password">加密密码</Label>
					<div class="flex gap-1.5">
						<Input id="dest-password" type="password" bind:value={formPassword} placeholder={isEditing ? '(留空则保持原有值)' : ''} class="flex-1" />
						<Button variant="outline" size="sm" class="h-9 px-2 shrink-0" onclick={generatePassword} title="生成高强度密码">
							{#if generatedOk}<Check class="w-3.5 h-3.5 text-green-500" />{:else}<Dices class="w-3.5 h-3.5" />{/if}
						</Button>
						{#if formPassword}
							<Button variant="outline" size="sm" class="h-9 px-2 shrink-0" onclick={copyPassword} title="复制密码">
								{#if copiedOk}<Check class="w-3.5 h-3.5 text-green-500" />{:else}<Copy class="w-3.5 h-3.5" />{/if}
							</Button>
						{/if}
					</div>
					<p class="text-xs text-muted-foreground">Restic 使用该密码加密所有备份数据，恢复时必须提供此密码。</p>
				</div>

				<div class="space-y-2">
					<Label for="dest-flags">额外 restic 参数</Label>
					<Input id="dest-flags" bind:value={formFlags} />
					<div class="text-[10px] text-muted-foreground space-y-0.5">
						<p>常用参数:</p>
						<div class="flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
							<span class="cursor-pointer hover:text-foreground" onclick={() => { formFlags = (formFlags + ' --limit-upload 5120').trim(); }} title="限制上传速度为 5 MB/s">--limit-upload</span>
							<span class="cursor-pointer hover:text-foreground" onclick={() => { formFlags = (formFlags + ' --limit-download 10240').trim(); }} title="限制下载速度为 10 MB/s">--limit-download</span>
							<span class="cursor-pointer hover:text-foreground" onclick={() => { formFlags = (formFlags + ' --verbose').trim(); }} title="详细输出日志">--verbose</span>
							<span class="cursor-pointer hover:text-foreground" onclick={() => { formFlags = (formFlags + ' --compression max').trim(); }} title="最高压缩级别">--compression max</span>
						</div>
					</div>
				</div>
			</div>
		</div>


		<!-- Policies section -->
		<div class="border-t pt-3 mt-2 space-y-3">
			<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">仓库策略</span>

			<!-- Prune policy -->
			<div class="space-y-1.5">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-1.5">
						<Clock class="w-3.5 h-3.5 text-muted-foreground" />
						<Label class="text-sm">定时清理快照</Label>
						<Tooltip.Provider delayDuration={200}>
							<Tooltip.Root><Tooltip.Trigger><CircleHelp class="w-3 h-3 text-muted-foreground/50 cursor-help" /></Tooltip.Trigger>
								<Tooltip.Portal><Tooltip.Content side="right" class="!w-64 text-xs">移除仓库中不再被快照引用的数据，在快照过期后释放存储空间。大多数仓库建议每月执行一次。</Tooltip.Content></Tooltip.Portal>
							</Tooltip.Root>
						</Tooltip.Provider>
					</div>
					<TogglePill bind:checked={policyPruneEnabled} />
				</div>
				{#if policyPruneEnabled}
					<div class="pl-5 space-y-2">
						<CronEditor value={policyPruneSchedule} onchange={(v) => policyPruneSchedule = v} />
						<div class="flex items-center gap-2">
							<label class="text-[10px] text-muted-foreground">最大未使用占比 (%)</label>
							<Input bind:value={policyPruneMaxUnused} type="number" min="0" max="100" class="h-8 text-xs w-20" />
						</div>
					</div>
				{/if}
			</div>

			<!-- Check policy -->
			<div class="space-y-1.5">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-1.5">
						<PackageCheck class="w-3.5 h-3.5 text-muted-foreground" />
						<Label class="text-sm">定时完整性检测</Label>
						<Tooltip.Provider delayDuration={200}>
							<Tooltip.Root><Tooltip.Trigger><CircleHelp class="w-3 h-3 text-muted-foreground/50 cursor-help" /></Tooltip.Trigger>
								<Tooltip.Portal><Tooltip.Content side="right" class="!w-64 text-xs">校验仓库结构与元数据完整性，用于检测数据损坏或文件丢失。建议每月执行或存储出现故障后运行。</Tooltip.Content></Tooltip.Portal>
							</Tooltip.Root>
						</Tooltip.Provider>
					</div>
					<TogglePill bind:checked={policyCheckEnabled} />
				</div>
				{#if policyCheckEnabled}
					<div class="pl-5">
						<CronEditor value={policyCheckSchedule} onchange={(v) => policyCheckSchedule = v} />
					</div>
				{/if}
			</div>

			<!-- Data verification policy -->
			<div class="space-y-1.5">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-1.5">
						<FolderCheck class="w-3.5 h-3.5 text-muted-foreground" />
						<Label class="text-sm">定时数据校验</Label>
						<Tooltip.Provider delayDuration={200}>
							<Tooltip.Root><Tooltip.Trigger><CircleHelp class="w-3 h-3 text-muted-foreground/50 cursor-help" /></Tooltip.Trigger>
								<Tooltip.Portal><Tooltip.Content side="right" class="!w-64 text-xs">随机读取一部分数据块校验文件可用性与完整性，可发现存储位衰减与介质损坏。云端仓库会消耗带宽，默认关闭。</Tooltip.Content></Tooltip.Portal>
							</Tooltip.Root>
						</Tooltip.Provider>
					</div>
					<TogglePill bind:checked={policyVerifyEnabled} />
				</div>
				{#if policyVerifyEnabled}
					<div class="pl-5 space-y-2">
						<CronEditor value={policyVerifySchedule} onchange={(v) => policyVerifySchedule = v} />
						<div class="flex items-center gap-2">
							<label class="text-[10px] text-muted-foreground">校验数据占比</label>
							<Select.Root type="single" value={policyVerifyDataSubset} onValueChange={(v) => policyVerifyDataSubset = v}>
								<Select.Trigger class="h-8 w-20 text-xs">{policyVerifyDataSubset}</Select.Trigger>
								<Select.Content>
									<Select.Item value="5%">5%</Select.Item>
									<Select.Item value="10%">10%</Select.Item>
									<Select.Item value="25%">25%</Select.Item>
									<Select.Item value="50%">50%</Select.Item>
									<Select.Item value="100%">100%</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
					</div>
				{/if}
			</div>

			<!-- Auto-unlock -->
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-1.5">
					<Unlock class="w-3.5 h-3.5 text-muted-foreground" />
					<Label class="text-sm">自动清理过期锁文件</Label>
					<Tooltip.Provider delayDuration={200}>
						<Tooltip.Root><Tooltip.Trigger><CircleHelp class="w-3 h-3 text-muted-foreground/50 cursor-help" /></Tooltip.Trigger>
							<Tooltip.Portal><Tooltip.Content side="right" class="!w-64 text-xs">在执行清理与检测前自动移除过期仓库锁。中断、崩溃的备份任务会遗留锁文件导致后续任务阻塞。</Tooltip.Content></Tooltip.Portal>
						</Tooltip.Root>
					</Tooltip.Provider>
				</div>
				<TogglePill bind:checked={policyAutoUnlock} />
			</div>
		</div>

		<!-- Stats section (only for existing destinations) -->
		{#if isEditing}
			<div class="border-t pt-3 mt-2">
				<div class="flex items-center gap-2 mb-2">
					<BarChart3 class="w-3.5 h-3.5 text-muted-foreground" />
					<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">仓库使用概况</span>
					{#if loadingStats}
						<Loader2 class="w-3 h-3 animate-spin text-muted-foreground" />
					{/if}
				</div>
				{#if repoStats}
					<div class="grid grid-cols-3 gap-2">
						<div class="bg-muted/30 rounded px-2 py-1.5 text-center border border-border/30">
							<div class="text-sm font-semibold">{formatBytes(repoStats.totalSize)}</div>
							<div class="text-[9px] text-muted-foreground">总容量</div>
						</div>
						<div class="bg-muted/30 rounded px-2 py-1.5 text-center border border-border/30">
							<div class="text-sm font-semibold">{repoStats.totalFiles.toLocaleString()}</div>
							<div class="text-[9px] text-muted-foreground">文件总数</div>
						</div>
						<div class="bg-muted/30 rounded px-2 py-1.5 text-center border border-border/30">
							<div class="text-sm font-semibold">{repoStats.snapshots}</div>
							<div class="text-[9px] text-muted-foreground">快照数量</div>
						</div>
					</div>
					<!-- Usage bar -->
					{#if repoStats.totalSize > 0}
						<div class="h-2 bg-muted rounded-full overflow-hidden">
							<div class="h-full bg-primary/60 rounded-full transition-all" style="width: {Math.min(100, (repoStats.totalSize / (1024 * 1024 * 1024)) * 10)}%"></div>
						</div>
						<p class="text-[10px] text-muted-foreground mt-1">共 {repoStats.snapshots} 个快照，包含 {repoStats.totalFiles.toLocaleString()} 个文件</p>
					{/if}
				{:else if !loadingStats}
					<p class="text-xs text-muted-foreground">正在加载仓库统计信息...</p>
				{/if}
			</div>
		{/if}

		</div>
		{#if repoConflictName}
			<div class="flex-shrink-0 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
				<AlertTriangle class="w-4 h-4 mt-0.5 flex-shrink-0" />
				<span>
					该仓库地址已被 <span class="font-medium">"{repoConflictName}"</span> 使用。
					同一仓库无法并行执行备份 (Restic 会自动上锁串行运行)，仅适合迁移或轮换场景。
					点击 <span class="font-medium">仍然保存</span> 继续。
				</span>
			</div>
		{/if}
		<Dialog.Footer class="flex-shrink-0 border-t mt-auto pt-4">
			<div class="flex items-center gap-2 mr-auto">
				<Button variant="outline" size="sm" onclick={testConnection} disabled={testing}>
					{#if testing}<RefreshCw class="w-4 h-4 mr-1 animate-spin" />{:else}<Wifi class="w-4 h-4 mr-1" />{/if}
					测试连接
				</Button>
				{#if isEditing}
					<Button variant="outline" size="sm" class="{destination?.lastTestStatus === 'success' ? 'opacity-30' : ''}" onclick={initRepo} disabled={initializing} title={destination?.lastTestStatus === 'success' ? '已完成初始化' : '初始化仓库'}>
						{#if initializing}<RefreshCw class="w-4 h-4 mr-1 animate-spin" />{:else}<Database class="w-4 h-4 mr-1" />{/if}
						初始化仓库
					</Button>
				{:else if needsInit}
					<span class="text-xs text-muted-foreground">Connection OK — repository will be initialized on save.</span>
				{/if}
			</div>
			<Button variant="outline" onclick={() => { open = false; onClose(); }}>取消</Button>
			<Button onclick={save} disabled={formSaving} variant={repoConflictName ? 'destructive' : 'default'}>
				{#if formSaving}<RefreshCw class="w-4 h-4 mr-1 animate-spin" />{:else if repoConflictName}<AlertTriangle class="w-4 h-4 mr-1" />{:else if needsInit && !isEditing}<Database class="w-4 h-4 mr-1" />{:else if isEditing}<Check class="w-4 h-4" />{:else}<Plus class="w-4 h-4" />{/if}
				{repoConflictName ? '仍然保存' : needsInit && !isEditing ? '创建并初始化' : isEditing ? '保存' : '创建'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
