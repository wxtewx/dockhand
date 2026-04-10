<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import { Loader2, GitBranch, RefreshCw, Webhook, Rocket, RefreshCcw, Copy, Check, XCircle, FolderGit2, Github, Key, KeyRound, Lock, FileText, HelpCircle, GripVertical, X, Download, Hammer, ArrowDownToLine, Zap } from 'lucide-svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import CronEditor from '$lib/components/cron-editor.svelte';
	import StackEnvVarsPanel from '$lib/components/StackEnvVarsPanel.svelte';
	import { type EnvVar, type ValidationResult } from '$lib/components/StackEnvVarsEditor.svelte';
	import { toast } from 'svelte-sonner';
	import { focusFirstInput } from '$lib/utils';
	import { readJobResponse } from '$lib/utils/sse-fetch';
	import { useSidebar } from '$lib/components/ui/sidebar/context.svelte';

	// Get sidebar state to adjust modal positioning
	const sidebar = useSidebar();

	// localStorage key for persisted split ratio
	const STORAGE_KEY_SPLIT = 'dockhand-git-stack-modal-split';

	interface GitCredential {
		id: number;
		name: string;
		authType: string;
	}

	function getAuthLabel(authType: string) {
		switch (authType) {
			case 'ssh': return 'SSH 密钥';
			case 'password': return '密码';
			default: return '无';
		}
	}

	interface GitRepository {
		id: number;
		name: string;
		url: string;
		branch: string;
		credential_id: number | null;
	}

	interface GitStack {
		id: number;
		stackName: string;
		repositoryId: number;
		environmentId: number | null;
		composePath: string;
		envFilePath: string | null;
		autoUpdate: boolean;
		autoUpdateSchedule: 'daily' | 'weekly' | 'custom';
		autoUpdateCron: string;
		webhookEnabled: boolean;
		webhookSecret: string | null;
		buildOnDeploy: boolean;
		repullImages: boolean;
		forceRedeploy: boolean;
	}

	interface Props {
		open: boolean;
		gitStack?: GitStack | null;
		environmentId?: number | null;
		repositories: GitRepository[];
		credentials: GitCredential[];
		onClose: () => void;
		onSaved: () => void;
	}

	let { open = $bindable(), gitStack = null, environmentId = null, repositories, credentials, onClose, onSaved }: Props = $props();

	// Form state - repository selection or creation
	let formRepoMode = $state<'existing' | 'new'>('existing');
	let formRepositoryId = $state<number | null>(null);
	let formNewRepoName = $state('');
	let formNewRepoUrl = $state('');
	let formNewRepoBranch = $state('main');
	let formNewRepoCredentialId = $state<number | null>(null);

	// Form state - stack deployment config
	let formStackName = $state('');
	let formStackNameUserModified = $state(false);
	let formComposePath = $state('compose.yaml');
	let formAutoUpdate = $state(false);
	let formAutoUpdateCron = $state('0 3 * * *');
	let formWebhookEnabled = $state(false);
	let formWebhookSecret = $state('');
	let formBuildOnDeploy = $state(false);
	let formRepullImages = $state(false);
	let formForceRedeploy = $state(false);
	let formDeployNow = $state(false);
	let formError = $state('');
	let formSaving = $state(false);
	let errors = $state<{ stackName?: string; repository?: string; repoName?: string; repoUrl?: string }>({});

	// Stack name validation: must start with alphanumeric, can contain alphanumeric, hyphens, underscores
	const STACK_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
	let copiedWebhookUrl = $state<'ok' | 'error' | null>(null);
	let copiedWebhookSecret = $state<'ok' | 'error' | null>(null);

	// Environment variables state
	let formEnvFilePath = $state<string | null>(null);
	let envFiles = $state<string[]>([]);
	let loadingEnvFiles = $state(false);
	let envVars = $state<EnvVar[]>([]);
	let fileEnvVars = $state<Record<string, string>>({});
	let loadingFileVars = $state(false);
	let existingSecretKeys = $state<Set<string>>(new Set());
	let populatingEnvVars = $state(false);

	// Resizable split panel state
	let splitRatio = $state(60); // percentage for form panel
	let isDraggingSplit = $state(false);
	let containerRef: HTMLDivElement | null = $state(null);


	// Track which gitStack was initialized to avoid repeated resets
	let lastInitializedStackId = $state<number | null | undefined>(undefined);
	let isInitializing = $state(false);

	$effect(() => {
		if (open) {
			const currentStackId = gitStack?.id ?? null;
			if (lastInitializedStackId !== currentStackId && !isInitializing) {
				lastInitializedStackId = currentStackId;
				isInitializing = true;
				resetForm().finally(() => {
					isInitializing = false;
				});
			}
		} else {
			lastInitializedStackId = undefined;
		}
	});

	// Derived state for selected repository
	let selectedRepo = $derived(formRepositoryId ? repositories.find(r => r.id === formRepositoryId) : null);

	onMount(() => {
		// Load saved split ratio
		const savedSplit = localStorage.getItem(STORAGE_KEY_SPLIT);
		if (savedSplit) {
			const ratio = parseFloat(savedSplit);
			if (!isNaN(ratio) && ratio >= 30 && ratio <= 80) {
				splitRatio = ratio;
			}
		}

		// Add global mouse event listeners for split dragging
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	});

	onDestroy(() => {
		window.removeEventListener('mousemove', handleMouseMove);
		window.removeEventListener('mouseup', handleMouseUp);
	});

	// Split panel drag handlers
	function startSplitDrag(e: MouseEvent) {
		e.preventDefault();
		isDraggingSplit = true;
	}

	function handleMouseMove(e: MouseEvent) {
		if (isDraggingSplit && containerRef) {
			const rect = containerRef.getBoundingClientRect();
			const newRatio = ((e.clientX - rect.left) / rect.width) * 100;
			splitRatio = Math.max(30, Math.min(80, newRatio));
		}
	}

	function handleMouseUp() {
		if (isDraggingSplit) {
			isDraggingSplit = false;
			// Save split ratio
			localStorage.setItem(STORAGE_KEY_SPLIT, splitRatio.toString());
		}
	}

	function generateWebhookSecret(): string {
		const array = new Uint8Array(24);
		crypto.getRandomValues(array);
		return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
	}

	function getWebhookUrl(stackId: number): string {
		return `${window.location.origin}/api/git/stacks/${stackId}/webhook`;
	}

	async function copyWebhookField(text: string, type: 'url' | 'secret') {
		const ok = await copyToClipboard(text);
		const state = ok ? 'ok' : 'error';
		if (type === 'url') {
			copiedWebhookUrl = state;
			setTimeout(() => copiedWebhookUrl = null, 2000);
		} else {
			copiedWebhookSecret = state;
			setTimeout(() => copiedWebhookSecret = null, 2000);
		}
	}

	async function loadEnvFiles() {
		if (!gitStack) return;

		loadingEnvFiles = true;
		try {
			const response = await fetch(`/api/git/stacks/${gitStack.id}/env-files`);
			if (response.ok) {
				const data = await response.json();
				envFiles = data.files || [];
			}
		} catch (e) {
			console.error('加载环境变量文件失败:', e);
		} finally {
			loadingEnvFiles = false;
		}
	}

	async function loadEnvFileContents(path: string) {
		if (!gitStack || !path) {
			fileEnvVars = {};
			return;
		}

		loadingFileVars = true;
		try {
			const response = await fetch(`/api/git/stacks/${gitStack.id}/env-files`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ path })
			});
			if (response.ok) {
				const data = await response.json();
				fileEnvVars = data.vars || {};
			}
		} catch (e) {
			console.error('加载环境变量文件内容失败:', e);
			fileEnvVars = {};
		} finally {
			loadingFileVars = false;
		}
	}

	async function loadEnvVarsOverrides() {
		if (!gitStack) return;

		try {
			// Use gitStack.environmentId when editing, fall back to prop for new stacks
			const envIdToUse = gitStack.environmentId ?? environmentId;
			const response = await fetch(`/api/stacks/${encodeURIComponent(gitStack.stackName)}/env${envIdToUse ? `?env=${envIdToUse}` : ''}`);
			if (response.ok) {
				const data = await response.json();
				const loadedVars = data.variables || [];
				// Track existing secret keys (secrets loaded from DB cannot have visibility toggled)
				existingSecretKeys = new Set(
					loadedVars.filter((v: EnvVar) => v.isSecret && v.key.trim()).map((v: EnvVar) => v.key.trim())
				);
				// Set envVars - the panel's $effect will auto-sync rawContent for text view
				envVars = loadedVars;
			}
		} catch (e) {
			console.error('加载环境变量覆盖配置失败:', e);
		}
	}

	async function populateEnvVars() {
		// Validate we have repository info
		if (formRepoMode === 'existing' && !formRepositoryId) {
			toast.error('请先选择一个仓库');
			return;
		}
		if (formRepoMode === 'new' && !formNewRepoUrl.trim()) {
			toast.error('请先输入仓库地址');
			return;
		}

		populatingEnvVars = true;
		try {
			const body: Record<string, any> = {
				composePath: formComposePath || 'compose.yaml',
				envFilePath: formEnvFilePath || null
			};

			if (formRepoMode === 'existing') {
				body.repositoryId = formRepositoryId;
			} else {
				body.url = formNewRepoUrl;
				body.branch = formNewRepoBranch || 'main';
				body.credentialId = formNewRepoCredentialId;
			}

			const response = await fetch('/api/git/preview-env', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const data = await response.json();

			if (!response.ok) {
				toast.error('加载环境变量失败', {
					description: data.error || '未知错误'
				});
				return;
			}

			const vars = data.vars as Record<string, string>;
			const count = Object.keys(vars).length;

			if (count === 0) {
				toast.info('未找到环境变量', {
					description: '仓库中未找到 .env 文件，您仍可手动添加变量。'
				});
				return;
			}

			// Convert to EnvVar array - preserve existing user entries that aren't in repo
			const existingUserVars = envVars.filter(v => v.key.trim() && !(v.key in vars));
			const newVars: EnvVar[] = Object.entries(vars).map(([key, value]) => ({
				key,
				value,
				isSecret: false
			}));

			envVars = [...newVars, ...existingUserVars];
			fileEnvVars = vars;

			toast.success(`已加载 ${count} 个变量${count === 1 ? '' : 's'}`, {
				description: '您现在可以在部署前自定义变量值'
			});
		} catch (e) {
			console.error('填充环境变量失败:', e);
			toast.error('加载环境变量失败');
		} finally {
			populatingEnvVars = false;
		}
	}

	async function resetForm() {
		// Clear state BEFORE async loads to avoid race conditions
		formError = '';
		errors = {};
		copiedWebhookUrl = null;
		copiedWebhookSecret = null;
		envFiles = [];
		envVars = [];
		fileEnvVars = {};
		existingSecretKeys = new Set();

		if (gitStack) {
			formRepoMode = 'existing';
			formRepositoryId = gitStack.repositoryId;
			formStackName = gitStack.stackName;
			formComposePath = gitStack.composePath;
			formEnvFilePath = gitStack.envFilePath;
			formAutoUpdate = gitStack.autoUpdate;
			formAutoUpdateCron = gitStack.autoUpdateCron || '0 3 * * *';
			formWebhookEnabled = gitStack.webhookEnabled;
			formWebhookSecret = gitStack.webhookSecret || '';
			formBuildOnDeploy = gitStack.buildOnDeploy ?? false;
			formRepullImages = gitStack.repullImages ?? false;
			formForceRedeploy = gitStack.forceRedeploy ?? false;
			formDeployNow = false;

			// Load env files and overrides SYNCHRONOUSLY to avoid race conditions
			// Wait for all loads to complete before allowing any other effect to run
			await Promise.all([
				loadEnvFiles(),
				loadEnvVarsOverrides(),
				gitStack.envFilePath ? loadEnvFileContents(gitStack.envFilePath) : Promise.resolve()
			]);
		} else {
			formRepoMode = repositories.length > 0 ? 'existing' : 'new';
			formRepositoryId = null;
			formNewRepoName = '';
			formNewRepoUrl = '';
			formNewRepoBranch = 'main';
			formNewRepoCredentialId = null;
			formStackName = '';
			formStackNameUserModified = false;
			formComposePath = 'compose.yaml';
			formEnvFilePath = null;
			formAutoUpdate = false;
			formAutoUpdateCron = '0 3 * * *';
			formWebhookEnabled = false;
			formWebhookSecret = '';
			formBuildOnDeploy = false;
			formRepullImages = false;
			formForceRedeploy = false;
			formDeployNow = false;
		}
	}

	async function saveGitStack(deployAfterSave: boolean = false) {
		errors = {};
		let hasErrors = false;

		const trimmedStackName = formStackName.trim();
		if (!trimmedStackName) {
			errors.stackName = '堆栈名称不能为空';
			hasErrors = true;
		} else if (!STACK_NAME_REGEX.test(trimmedStackName)) {
			errors.stackName = '堆栈名称必须以字母或数字开头，仅可包含字母、数字、连字符和下划线';
			hasErrors = true;
		}

		if (formRepoMode === 'existing' && !formRepositoryId) {
			errors.repository = '请选择一个仓库';
			hasErrors = true;
		}

		if (formRepoMode === 'new' && !formNewRepoName.trim()) {
			errors.repoName = '仓库名称不能为空';
			hasErrors = true;
		}

		if (formRepoMode === 'new' && !formNewRepoUrl.trim()) {
			errors.repoUrl = '仓库地址不能为空';
			hasErrors = true;
		}
		if (hasErrors) return;

		formSaving = true;
		formError = '';

		try {
			// Only save vars that are actual overrides (differ from file) or new (not in file)
			// This ensures file updates from git are picked up on next sync
			const overrideVars = envVars.filter(v => {
				if (!v.key.trim()) return false;
				const fileValue = fileEnvVars[v.key];
				// Save if: not in file (new var), value differs from file, or is a secret
				return fileValue === undefined || v.value !== fileValue || v.isSecret;
			});

			let body: any = {
				stackName: formStackName,
				composePath: formComposePath || 'compose.yaml',
				envFilePath: formEnvFilePath,
				environmentId: environmentId,
				autoUpdate: formAutoUpdate,
				autoUpdateCron: formAutoUpdateCron,
				webhookEnabled: formWebhookEnabled,
				webhookSecret: formWebhookEnabled ? formWebhookSecret : null,
				buildOnDeploy: formBuildOnDeploy,
				repullImages: formRepullImages,
				forceRedeploy: formForceRedeploy,
				deployNow: deployAfterSave,
				envVars: overrideVars.map(v => ({
					key: v.key.trim(),
					value: v.value,
					isSecret: v.isSecret
				}))
			};

			if (formRepoMode === 'existing') {
				body.repositoryId = formRepositoryId;
			} else {
				// Create new repo inline
				body.repoName = formNewRepoName;
				body.url = formNewRepoUrl;
				body.branch = formNewRepoBranch || 'main';
				body.credentialId = formNewRepoCredentialId;
			}

			const url = gitStack
				? `/api/git/stacks/${gitStack.id}`
				: '/api/git/stacks';
			const method = gitStack ? 'PUT' : 'POST';

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const data = await readJobResponse(response);

			if (!response.ok) {
				formError = data.error || '保存 Git 堆栈失败';
				return;
			}

			// Check if deployment failed
			if (data.deployResult && !data.deployResult.success) {
				toast.error('部署失败', {
					description: data.deployResult.error || '未知错误'
				});
				onSaved(); // Still refresh the list to show the new stack
				onClose(); // Close modal, error shown as toast
				return;
			}

			onSaved();
			onClose();
		} catch (error) {
			formError = '保存 Git 堆栈失败';
		} finally {
			formSaving = false;
		}
	}

	// Auto-populate stack name from selected repo and compose path (only if user hasn't manually edited)
	$effect(() => {
		if (formRepoMode === 'existing' && formRepositoryId && !gitStack && !formStackNameUserModified) {
			const repo = repositories.find(r => r.id === formRepositoryId);
			if (repo) {
				// Normalize repo name: lowercase, spaces/underscores to hyphens, strip invalid chars
				const normalizedName = repo.name
					.toLowerCase()
					.replace(/[\s_]+/g, '-')
					.replace(/[^a-z0-9-]/g, '')
					.replace(/-+/g, '-')
					.replace(/^-|-$/g, '');

				// Extract compose filename without extension for stack name
				const composeName = formComposePath
					.replace(/^.*\//, '') // Remove directory path
					.replace(/\.(yml|yaml)$/i, '') // Remove extension
					.replace(/^docker-compose\.?/, '') // Remove docker-compose prefix
					.replace(/^compose$/, ''); // Remove plain "compose"

				// Combine repo name with compose name if it's not the default
				if (composeName && composeName !== 'docker-compose') {
					formStackName = `${normalizedName}-${composeName}`;
				} else {
					formStackName = normalizedName;
				}
			}
		}
	});
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => { if (isOpen) focusFirstInput(); }}>
	<Dialog.Content
		class="max-w-none h-[95vh] flex flex-col p-0 gap-0 shadow-xl border-zinc-200 dark:border-zinc-700 {sidebar.state === 'collapsed' ? 'w-[calc(100vw-6rem)] ml-[1.5rem]' : 'w-[calc(100vw-12rem)] ml-[4.5rem]'}"
		showCloseButton={false}
	>
		<Dialog.Header class="px-5 py-3 border-b border-zinc-200 dark:border-zinc-700 flex-shrink-0">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div class="p-1.5 rounded-md bg-zinc-200 dark:bg-zinc-700">
						<GitBranch class="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
					</div>
					<div>
						<Dialog.Title class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
							{gitStack ? '编辑 Git 堆栈' : '从 Git 部署'}
						</Dialog.Title>
						<Dialog.Description class="text-xs text-zinc-500 dark:text-zinc-400">
							{gitStack ? '更新 Git 堆栈配置' : '从 Git 仓库部署 compose 堆栈'}
						</Dialog.Description>
					</div>
				</div>

				<!-- Close button -->
				<button
					onclick={onClose}
					class="p-1.5 rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
				>
					<X class="w-4 h-4" />
				</button>
			</div>
		</Dialog.Header>

		<div bind:this={containerRef} class="flex-1 min-h-0 flex {isDraggingSplit ? 'select-none' : ''}">
			<!-- Left column: Form fields -->
			<div class="flex-shrink-0 flex flex-col min-w-0 overflow-y-auto" style="width: {splitRatio}%">
				<div class="space-y-4 py-4 px-6">
			<!-- Repository selection -->
			{#if !gitStack}
				<div class="space-y-3">
					<Label>仓库</Label>
					<div class="flex gap-2">
						<Button
							variant={formRepoMode === 'existing' ? 'default' : 'outline'}
							size="sm"
							onclick={() => formRepoMode = 'existing'}
							disabled={repositories.length === 0}
						>
							选择现有仓库
						</Button>
						<Button
							variant={formRepoMode === 'new' ? 'default' : 'outline'}
							size="sm"
							onclick={() => formRepoMode = 'new'}
						>
							添加新仓库
						</Button>
					</div>

					{#if formRepoMode === 'existing'}
						<Select.Root
							type="single"
							value={formRepositoryId?.toString() ?? ''}
							onValueChange={(v) => { formRepositoryId = v ? parseInt(v) : null; errors.repository = undefined; }}
						>
							<Select.Trigger class="w-full {errors.repository ? 'border-destructive' : ''}">
								{#if selectedRepo}
									{@const repoPath = selectedRepo.url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '')}
									<div class="flex items-center gap-2 text-left">
										{#if selectedRepo.url.includes('github.com')}
											<Github class="w-4 h-4 shrink-0 text-muted-foreground" />
										{:else}
											<FolderGit2 class="w-4 h-4 shrink-0 text-muted-foreground" />
										{/if}
										<span class="truncate">{selectedRepo.name}</span>
										<span class="text-muted-foreground text-xs truncate hidden sm:inline">({repoPath})</span>
									</div>
								{:else}
									<span class="text-muted-foreground">选择一个仓库...</span>
								{/if}
							</Select.Trigger>
							<Select.Content>
								{#each repositories as repo}
									{@const repoPath = repo.url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '')}
									<Select.Item value={repo.id.toString()} label={repo.name}>
										<div class="flex items-center gap-2">
											{#if repo.url.includes('github.com')}
												<Github class="w-4 h-4 shrink-0 text-muted-foreground" />
											{:else}
												<FolderGit2 class="w-4 h-4 shrink-0 text-muted-foreground" />
											{/if}
											<span>{repo.name}</span>
											<span class="text-muted-foreground text-xs">- {repoPath}</span>
											<span class="text-muted-foreground text-xs flex items-center gap-1">
												<GitBranch class="w-3 h-3" />
												{repo.branch}
											</span>
										</div>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						{#if errors.repository}
							<p class="text-xs text-destructive">{errors.repository}</p>
						{:else if repositories.length === 0}
							<p class="text-xs text-muted-foreground">
								未配置任何仓库，请点击 “添加新仓库” 进行添加。
							</p>
						{/if}
					{:else}
						<div class="space-y-3 p-3 border rounded-md bg-muted/30">
							<div class="space-y-2">
								<Label for="new-repo-name">仓库名称</Label>
								<Input
									id="new-repo-name"
									bind:value={formNewRepoName}
									placeholder="例如：my-stacks"
									class={errors.repoName ? 'border-destructive focus-visible:ring-destructive' : ''}
									oninput={() => errors.repoName = undefined}
								/>
								{#if errors.repoName}
									<p class="text-xs text-destructive">{errors.repoName}</p>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="new-repo-url">仓库地址</Label>
								<Input
									id="new-repo-url"
									bind:value={formNewRepoUrl}
									placeholder="https://github.com/user/repo.git"
									class={errors.repoUrl ? 'border-destructive focus-visible:ring-destructive' : ''}
									oninput={() => errors.repoUrl = undefined}
								/>
								{#if errors.repoUrl}
									<p class="text-xs text-destructive">{errors.repoUrl}</p>
								{/if}
							</div>
							<div class="grid grid-cols-2 gap-3">
								<div class="space-y-2">
									<Label for="new-repo-branch">分支</Label>
									<Input id="new-repo-branch" bind:value={formNewRepoBranch} placeholder="main" />
								</div>
								<div class="space-y-2">
									<Label for="new-repo-credential">认证信息</Label>
									<Select.Root
										type="single"
										value={formNewRepoCredentialId?.toString() ?? 'none'}
										onValueChange={(v) => formNewRepoCredentialId = v === 'none' ? null : parseInt(v)}
									>
										<Select.Trigger class="w-full">
											{@const selectedCred = credentials.find(c => c.id === formNewRepoCredentialId)}
											{#if selectedCred}
												{#if selectedCred.authType === 'ssh'}
													<KeyRound class="w-4 h-4 mr-2 text-muted-foreground" />
												{:else if selectedCred.authType === 'password'}
													<Lock class="w-4 h-4 mr-2 text-muted-foreground" />
												{:else}
													<Key class="w-4 h-4 mr-2 text-muted-foreground" />
												{/if}
												<span>{selectedCred.name} ({getAuthLabel(selectedCred.authType)})</span>
											{:else}
												<Key class="w-4 h-4 mr-2 text-muted-foreground" />
												<span>无 (公开仓库)</span>
											{/if}
										</Select.Trigger>
										<Select.Content>
											<Select.Item value="none">
												<span class="flex items-center gap-2">
													<Key class="w-4 h-4 text-muted-foreground" />
													无 (公开仓库)
												</span>
											</Select.Item>
											{#each credentials as cred}
												<Select.Item value={cred.id.toString()}>
													<span class="flex items-center gap-2">
														{#if cred.authType === 'ssh'}
															<KeyRound class="w-4 h-4 text-muted-foreground" />
														{:else if cred.authType === 'password'}
															<Lock class="w-4 h-4 text-muted-foreground" />
														{:else}
															<Key class="w-4 h-4 text-muted-foreground" />
														{/if}
														{cred.name} ({getAuthLabel(cred.authType)})
													</span>
												</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Stack configuration -->
			<div class="space-y-2">
				<Label for="stack-name">堆栈名称</Label>
				<Input
					id="stack-name"
					bind:value={formStackName}
					placeholder="例如：my-app"
					class={errors.stackName ? 'border-destructive focus-visible:ring-destructive' : ''}
					oninput={() => { errors.stackName = undefined; formStackNameUserModified = true; }}
				/>
				{#if errors.stackName}
					<p class="text-xs text-destructive">{errors.stackName}</p>
				{:else}
					<p class="text-xs text-muted-foreground">这将是部署后的堆栈名称</p>
				{/if}
			</div>

			<div class="space-y-2">
				<Label for="compose-path">Compose 文件路径</Label>
				<Input id="compose-path" bind:value={formComposePath} placeholder="compose.yaml" />
				<p class="text-xs text-muted-foreground">仓库内 Compose 文件的路径</p>
			</div>

			<!-- Additional env file for variable substitution -->
			<div class="space-y-2">
				<div class="flex items-center gap-1.5">
					<Label for="env-file-path">附加环境变量文件 (可选)</Label>
					<Tooltip.Root>
						<Tooltip.Trigger>
							<HelpCircle class="w-3.5 h-3.5 text-muted-foreground cursor-help" />
						</Tooltip.Trigger>
						<Tooltip.Content>
							<div class="w-80">
								<p class="text-xs">Compose 目录下的 <code class="bg-muted px-1 rounded">.env</code> 文件会自动加载 (如果存在)。</p>
								<p class="text-xs mt-2">此字段用于指定非标准名称的附加环境变量文件 (例如 <code class="bg-muted px-1 rounded">.env.production</code>)，其值会覆盖默认的 <code class="bg-muted px-1 rounded">.env</code> 文件。</p>
								<p class="text-xs mt-2">右侧环境变量编辑器中的覆盖配置优先级最高。</p>
							</div>
						</Tooltip.Content>
					</Tooltip.Root>
				</div>
					<Input
						id="env-file-path"
						bind:value={formEnvFilePath}
						placeholder=""
					/>
				<p class="text-xs text-muted-foreground">传递给 Docker Compose 的附加环境变量文件</p>
			</div>

			<!-- Auto-update section -->
			<div class="space-y-3 p-3 bg-muted/50 rounded-md">
			<div class="flex items-center gap-3">
				<div class="flex items-center gap-2 flex-1">
					<RefreshCw class="w-4 h-4 text-muted-foreground" />
					<Label class="text-sm font-normal">启用定时同步</Label>
				</div>
				<TogglePill bind:checked={formAutoUpdate} />
			</div>
				<p class="text-xs text-muted-foreground">
					自动同步仓库并在有变更时重新部署堆栈。
				</p>
				{#if formAutoUpdate}
					<CronEditor
						value={formAutoUpdateCron}
						onchange={(cron) => formAutoUpdateCron = cron}
					/>
				{/if}
			</div>

			<!-- Webhook section -->
			<div class="space-y-3 p-3 bg-muted/50 rounded-md">
			<div class="flex items-center gap-3">
				<div class="flex items-center gap-2 flex-1">
					<Webhook class="w-4 h-4 text-muted-foreground" />
					<Label class="text-sm font-normal">Enable webhook</Label>
				</div>
				<TogglePill bind:checked={formWebhookEnabled} />
			</div>
				<p class="text-xs text-muted-foreground">
					接收来自 Git 平台的推送事件，触发同步与重新部署。
				</p>
				{#if formWebhookEnabled}
					{#if gitStack}
						<div class="space-y-2">
							<Label>Webhook URL</Label>
							<div class="flex gap-2">
								<Input
									value={getWebhookUrl(gitStack.id)}
									readonly
									class="font-mono text-xs bg-background"
								/>
								<Button
									variant="outline"
									size="sm"
									onclick={() => copyWebhookField(getWebhookUrl(gitStack.id), 'url')}
									title="复制地址"
								>
									{#if copiedWebhookUrl === 'error'}
										<Tooltip.Root open>
											<Tooltip.Trigger>
												<XCircle class="w-4 h-4 text-red-500" />
											</Tooltip.Trigger>
											<Tooltip.Content>复制需要 HTTPS</Tooltip.Content>
										</Tooltip.Root>
									{:else if copiedWebhookUrl === 'ok'}
										<Check class="w-4 h-4 text-green-500" />
									{:else}
										<Copy class="w-4 h-4" />
									{/if}
								</Button>
							</div>
						</div>
					{/if}
					<div class="space-y-2">
						<Label for="webhook-secret">Webhook 密钥 (可选)</Label>
						<div class="flex gap-2">
							<Input
								id="webhook-secret"
								bind:value={formWebhookSecret}
								placeholder="留空则不进行签名验证"
								class="font-mono text-xs"
							/>
							{#if gitStack && formWebhookSecret}
								<Button
									variant="outline"
									size="sm"
									onclick={() => copyWebhookField(formWebhookSecret, 'secret')}
									title="复制密钥"
								>
									{#if copiedWebhookSecret === 'error'}
										<Tooltip.Root open>
											<Tooltip.Trigger>
												<XCircle class="w-4 h-4 text-red-500" />
											</Tooltip.Trigger>
											<Tooltip.Content>复制需要 HTTPS</Tooltip.Content>
										</Tooltip.Root>
									{:else if copiedWebhookSecret === 'ok'}
										<Check class="w-4 h-4 text-green-500" />
									{:else}
										<Copy class="w-4 h-4" />
									{/if}
								</Button>
							{/if}
							<Button
								variant="outline"
								size="sm"
								onclick={() => formWebhookSecret = generateWebhookSecret()}
								title="生成新密钥"
							>
								<RefreshCcw class="w-4 h-4" />
							</Button>
						</div>
					</div>
					{#if !gitStack}
						<p class="text-xs text-muted-foreground">
							Webhook 地址将在创建堆栈后生成。
						</p>
					{:else}
						<p class="text-xs text-muted-foreground">
							请在您的 Git 平台中配置此地址，密钥用于签名验证。
						</p>
					{/if}
				{/if}
			</div>

			<!-- Deploy options section -->
			<div class="space-y-3 p-3 bg-muted/50 rounded-md">
				<p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Deploy options</p>
				<div class="flex items-center gap-3">
					<div class="flex items-center gap-2 flex-1">
						<Hammer class="w-4 h-4 text-muted-foreground" />
						<Label class="text-sm font-normal">Build images on deploy</Label>
					</div>
					<TogglePill bind:checked={formBuildOnDeploy} />
				</div>
				<p class="text-xs text-muted-foreground">
					Run <code class="text-xs bg-muted px-1 rounded">--build</code> to build images from Dockerfiles before starting containers.
				</p>
				<div class="flex items-center gap-3">
					<div class="flex items-center gap-2 flex-1">
						<ArrowDownToLine class="w-4 h-4 text-muted-foreground" />
						<Label class="text-sm font-normal">Re-pull images</Label>
					</div>
					<TogglePill bind:checked={formRepullImages} />
				</div>
				<p class="text-xs text-muted-foreground">
					Always pull latest images before deploying, even if the compose file hasn't changed. Useful for CI/CD workflows with static tags like <code class="text-xs bg-muted px-1 rounded">:latest</code>.
				</p>
				<div class="flex items-center gap-3">
					<div class="flex items-center gap-2 flex-1">
						<Zap class="w-4 h-4 text-muted-foreground" />
						<Label class="text-sm font-normal">Force redeployment</Label>
					</div>
					<TogglePill bind:checked={formForceRedeploy} />
				</div>
				<p class="text-xs text-muted-foreground">
					Always redeploy the stack on webhook or scheduled sync, even if no git changes are detected.
				</p>
			</div>

			<!-- Deploy now option (only for new stacks) -->
			{#if !gitStack}
				<div class="space-y-3 p-3 bg-muted/50 rounded-md">
					<div class="flex items-center gap-3">
						<div class="flex items-center gap-2 flex-1">
							<Rocket class="w-4 h-4 text-muted-foreground" />
							<div class="flex-1">
								<Label class="text-sm font-normal">立即部署</Label>
								<p class="text-xs text-muted-foreground">立即克隆并部署堆栈</p>
							</div>
						</div>
						<TogglePill bind:checked={formDeployNow} />
					</div>
				</div>
			{/if}

			{#if formError}
				<p class="text-sm text-destructive">{formError}</p>
			{/if}
				</div>
			</div>

			<!-- Resizable divider -->
			<div
				class="w-1 flex-shrink-0 bg-zinc-200 dark:bg-zinc-700 hover:bg-blue-400 dark:hover:bg-blue-500 cursor-col-resize transition-colors flex items-center justify-center group {isDraggingSplit ? 'bg-blue-500 dark:bg-blue-400' : ''}"
				onmousedown={startSplitDrag}
				role="separator"
				aria-orientation="vertical"
				tabindex="0"
			>
				<div class="w-4 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity {isDraggingSplit ? 'opacity-100' : ''}">
					<GripVertical class="w-3 h-3 text-white" />
				</div>
			</div>

			<!-- Right column: Environment Variables -->
			<div class="flex-1 min-w-0 flex flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-800/50">
				<StackEnvVarsPanel
					bind:variables={envVars}
					placeholder={{ key: 'MY_VAR', value: 'value' }}
					infoText="覆盖仓库环境变量文件中的变量。非机密变量将保存到堆栈目录下的 <code class='bg-muted px-1 rounded'>.env.dockhand</code> 文件。机密变量存储在数据库中，并在部署时通过系统环境注入。<br/><br/>变量可通过 <code class='bg-muted px-1 rounded'>${'{VAR_NAME}'}</code> 语法用于<strong>compose文件插值</strong>。它们不会自动注入容器 —— 如需传递，请使用 <code class='bg-muted px-1 rounded'>environment:</code> 配置，或在 <code class='bg-muted px-1 rounded'>env_file:</code> 中引用 <code class='bg-muted px-1 rounded'>.env.dockhand</code>。"
					existingSecretKeys={gitStack !== null ? existingSecretKeys : new Set()}
					showInterpolationHint={true}
				>
					{#snippet headerActions()}
						{#if !gitStack}
							<div class="flex items-center gap-0.5">
								<Button
									type="button"
									size="sm"
									variant="ghost"
									onclick={populateEnvVars}
									disabled={populatingEnvVars || (formRepoMode === 'existing' && !formRepositoryId) || (formRepoMode === 'new' && !formNewRepoUrl.trim())}
									class="h-6 text-xs px-2"
								>
									{#if populatingEnvVars}
										<Loader2 class="w-3.5 h-3.5 mr-1 animate-spin" />
										加载中...
									{:else}
										<Download class="w-3.5 h-3.5" />
										自动填充
									{/if}
								</Button>
								<Tooltip.Root>
									<Tooltip.Trigger>
										<HelpCircle class="w-3.5 h-3.5 text-muted-foreground cursor-help" />
									</Tooltip.Trigger>
									<Tooltip.Content>
										<div class="w-64">
											<p class="text-xs">克隆仓库并从 <code class="bg-muted px-1 rounded">.env</code> 文件 (compose 目录下) 和附加环境变量文件 (如指定) 加载变量，方便您查看可覆盖的配置项。</p>
										</div>
									</Tooltip.Content>
								</Tooltip.Root>
							</div>
						{/if}
					{/snippet}
				</StackEnvVarsPanel>
			</div>
		</div>

		<Dialog.Footer class="px-5 py-2.5 border-t border-zinc-200 dark:border-zinc-700 flex-shrink-0">
			<Button variant="outline" onclick={onClose}>取消</Button>
			{#if gitStack}
				<Button variant="outline" onclick={() => saveGitStack(true)} disabled={formSaving}>
					{#if formSaving}
						<Loader2 class="w-4 h-4 mr-1 animate-spin" />
						部署中...
					{:else}
						<Rocket class="w-4 h-4" />
						保存并部署
					{/if}
				</Button>
				<Button onclick={() => saveGitStack(false)} disabled={formSaving}>
					{#if formSaving}
						<Loader2 class="w-4 h-4 mr-1 animate-spin" />
						保存中...
					{:else}
						保存更改
					{/if}
				</Button>
			{:else}
				<Button onclick={() => saveGitStack(formDeployNow)} disabled={formSaving}>
					{#if formSaving}
						<Loader2 class="w-4 h-4 mr-1 animate-spin" />
						{formDeployNow ? '部署中...' : '创建中...'}
					{:else}
						{formDeployNow ? '部署' : '创建'}
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
