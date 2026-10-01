<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { ToggleGroup } from '$lib/components/ui/toggle-pill';
	import { Key, KeyRound, Lock } from 'lucide-svelte';
	import { focusFirstInput } from '$lib/utils';

	// Auth type options with icons
	const authTypeOptions = [
		{ value: 'password', label: '密码/令牌', icon: Lock },
		{ value: 'ssh', label: 'SSH 密钥', icon: KeyRound }
	];

	interface GitCredential {
		id: number;
		name: string;
		authType: 'none' | 'password' | 'ssh';
		username?: string;
		hasPassword: boolean;
		hasSshKey: boolean;
	}

	interface Props {
		open: boolean;
		credential?: GitCredential | null;
		onClose: () => void;
		onSaved: () => void;
	}

	let { open = $bindable(), credential = null, onClose, onSaved }: Props = $props();

	// Form state
	let formName = $state('');
	let formAuthType = $state<'none' | 'password' | 'ssh'>('password');
	let formUsername = $state('');
	let formPassword = $state('');
	let formSshKey = $state('');
	let formSshPassphrase = $state('');
	let formError = $state('');
	let formSaving = $state(false);
	let errors = $state<{ name?: string; password?: string; sshKey?: string }>({});

	const isEditing = $derived(credential !== null);

	// Track which credential was initialized to avoid repeated resets
	let lastInitializedCredId = $state<number | null | undefined>(undefined);

	$effect(() => {
		if (open) {
			const currentCredId = credential?.id ?? null;
			if (lastInitializedCredId !== currentCredId) {
				lastInitializedCredId = currentCredId;
				resetForm();
			}
		} else {
			lastInitializedCredId = undefined;
		}
	});

	function resetForm() {
		if (credential) {
			formName = credential.name;
			formAuthType = credential.authType;
			formUsername = credential.username || '';
			formPassword = '';
			formSshKey = '';
			formSshPassphrase = '';
		} else {
			formName = '';
			formAuthType = 'password';
			formUsername = '';
			formPassword = '';
			formSshKey = '';
			formSshPassphrase = '';
		}
		formError = '';
		errors = {};
	}

	async function saveCredential() {
		errors = {};
		let hasErrors = false;

		if (!formName.trim()) {
			errors.name = '名称为必填项';
			hasErrors = true;
		}

		if (formAuthType === 'password' && !formPassword.trim() && !credential?.hasPassword) {
			errors.password = '密码为必填项';
			hasErrors = true;
		}

		if (formAuthType === 'ssh' && !formSshKey.trim() && !credential?.hasSshKey) {
			errors.sshKey = 'SSH 私钥为必填项';
			hasErrors = true;
		}

		if (hasErrors) return;

		formSaving = true;
		formError = '';

		try {
			const body: any = {
				name: formName.trim(),
				authType: formAuthType,
				username: formUsername.trim() || undefined
			};

			if (formAuthType === 'password') {
				body.password = formPassword;
			}

			if (formAuthType === 'ssh') {
				body.sshPrivateKey = formSshKey;
				if (formSshPassphrase) body.sshPassphrase = formSshPassphrase;
			}

			const url = credential
				? `/api/git/credentials/${credential.id}`
				: '/api/git/credentials';
			const method = credential ? 'PUT' : 'POST';

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const data = await response.json();

			if (!response.ok) {
				formError = data.error || '保存凭据失败';
				toast.error(formError);
				return;
			}

			onSaved();
			onClose();
			toast.success(credential ? '凭据已更新' : '凭据已创建');
		} catch (error) {
			formError = '保存凭据失败';
			toast.error('保存凭据失败');
		} finally {
			formSaving = false;
		}
	}

</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (o) focusFirstInput(); else onClose(); }}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Key class="w-5 h-5" />
				{isEditing ? '编辑' : '添加'} Git 凭据
			</Dialog.Title>
			<Dialog.Description>
				{isEditing ? '更新凭据设置' : '创建用于访问 Git 仓库的新凭据'}
			</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={(e) => { e.preventDefault(); saveCredential(); }} class="space-y-4">
			<div class="space-y-2">
				<Label for="cred-name">名称</Label>
				<Input
					id="cred-name"
					bind:value={formName}
					placeholder="例如：个人 GitHub 账号"
					class={errors.name ? 'border-destructive focus-visible:ring-destructive' : ''}
					oninput={() => errors.name = undefined}
				/>
				{#if errors.name}
					<p class="text-xs text-destructive">{errors.name}</p>
				{:else if !isEditing}
					<p class="text-xs text-muted-foreground">用于标识该凭据的友好名称</p>
				{/if}
			</div>

			<div class="space-y-2">
				<Label>认证类型</Label>
				<ToggleGroup
					value={formAuthType}
					options={authTypeOptions}
					onchange={(val) => formAuthType = val as 'password' | 'ssh'}
				/>
			</div>

			<!-- Fixed height container to prevent layout jump -->
			<div class="min-h-[220px] space-y-4">
				{#if formAuthType === 'password'}
					<div class="space-y-2">
						<Label for="cred-username">用户名</Label>
						<Input id="cred-username" bind:value={formUsername} placeholder="用户名或邮箱" />
					</div>
					<div class="space-y-2">
						<Label for="cred-password">密码或令牌</Label>
						<Input
							id="cred-password"
							type="password"
							bind:value={formPassword}
							placeholder={isEditing ? '留空以保留当前密码' : '密码或个人访问令牌'}
							class={errors.password ? 'border-destructive focus-visible:ring-destructive' : ''}
							oninput={() => errors.password = undefined}
						/>
						{#if errors.password}
							<p class="text-xs text-destructive">{errors.password}</p>
						{:else if isEditing && credential?.hasPassword}
							<p class="text-xs text-muted-foreground">当前密码已设置，留空即可保留。</p>
						{/if}
					</div>
				{:else if formAuthType === 'ssh'}
					<div class="space-y-2">
						<Label for="cred-ssh-key">SSH 私钥</Label>
						<textarea
							id="cred-ssh-key"
							bind:value={formSshKey}
							class="w-full h-32 px-3 py-2 text-sm border rounded-md font-mono bg-background {errors.sshKey ? 'border-destructive focus-visible:ring-destructive' : ''}"
							placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
							oninput={() => errors.sshKey = undefined}
						></textarea>
						{#if errors.sshKey}
							<p class="text-xs text-destructive">{errors.sshKey}</p>
						{:else if isEditing && credential?.hasSshKey}
							<p class="text-xs text-muted-foreground">当前 SSH 密钥已设置，留空即可保留。</p>
						{/if}
					</div>
					<div class="space-y-2">
						<Label for="cred-ssh-passphrase">SSH 密码 (可选)</Label>
						<Input id="cred-ssh-passphrase" type="password" bind:value={formSshPassphrase} placeholder="加密密钥的密码" />
					</div>
				{/if}
			</div>

			{#if formError}
				<p class="text-sm text-destructive">{formError}</p>
			{/if}

			<Dialog.Footer>
				<Button variant="outline" type="button" onclick={onClose}>取消</Button>
				<Button type="submit" disabled={formSaving}>
					{formSaving ? '保存中...' : (isEditing ? '保存更改' : '添加凭据')}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
