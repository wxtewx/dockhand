<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Plus, Check, RefreshCw } from 'lucide-svelte';
	import { focusFirstInput } from '$lib/utils';

	export interface Registry {
		id: number;
		name: string;
		url: string;
		username?: string;
		createdAt: string;
	}

	interface Props {
		open: boolean;
		registry?: Registry | null;
		onClose: () => void;
		onSaved: () => void;
	}

	let { open = $bindable(), registry = null, onClose, onSaved }: Props = $props();

	const isEditing = $derived(registry !== null);

	// Form state
	let formName = $state('');
	let formUrl = $state('');
	let formUsername = $state('');
	let formPassword = $state('');
	let formError = $state('');
	let formSaving = $state(false);

	function resetForm() {
		formName = '';
		formUrl = '';
		formUsername = '';
		formPassword = '';
		formError = '';
		formSaving = false;
	}

	// Initialize form when registry changes or modal opens
	$effect(() => {
		if (open) {
			if (registry) {
				formName = registry.name;
				formUrl = registry.url;
				formUsername = registry.username || '';
				formPassword = '';
				formError = '';
			} else {
				resetForm();
			}
		}
	});

	async function save() {
		if (!formName.trim() || !formUrl.trim()) {
			formError = '名称和 URL 为必填项';
			return;
		}

		formSaving = true;
		formError = '';

		try {
			const body: Record<string, string | undefined> = {
				name: formName.trim(),
				url: formUrl.trim(),
				username: formUsername.trim() || undefined
			};

			// Only include password if provided (for edit, empty means keep existing)
			if (formPassword || !isEditing) {
				body.password = formPassword || undefined;
			}

			const url = isEditing ? `/api/registries/${registry!.id}` : '/api/registries';
			const method = isEditing ? 'PUT' : 'POST';

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (response.ok) {
				open = false;
				onSaved();
			} else {
				const data = await response.json();
				formError = data.error || `${isEditing ? '更新' : '创建'}镜像仓库失败`;
			}
		} catch {
			formError = `${isEditing ? '更新' : '创建'}镜像仓库失败`;
		} finally {
			formSaving = false;
		}
	}

	function handleClose() {
		open = false;
		onClose();
	}
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (o) { formError = ''; focusFirstInput(); } }}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>{isEditing ? '编辑' : '添加'}镜像仓库</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-4">
			{#if formError}
				<div class="text-sm text-red-600 dark:text-red-400">{formError}</div>
			{/if}
			<div class="space-y-2">
				<Label for="reg-name">名称</Label>
				<Input id="reg-name" bind:value={formName} placeholder="我的私有仓库" />
			</div>
			<div class="space-y-2">
				<Label for="reg-url">URL</Label>
				<Input id="reg-url" bind:value={formUrl} placeholder="https://registry.example.com" />
			</div>
			<div class="space-y-4 pt-2 border-t">
				<p class="text-xs text-muted-foreground">凭据 {isEditing ? '(留空密码以保留现有设置)' : '(可选)'}</p>
				<div class="space-y-2">
					<Label for="reg-username">用户名</Label>
					<Input id="reg-username" bind:value={formUsername} placeholder="用户名" />
				</div>
				<div class="space-y-2">
					<Label for="reg-password">密码 / 令牌</Label>
					<Input id="reg-password" type="password" bind:value={formPassword} placeholder={isEditing ? '留空以保留现有密码' : '密码或访问令牌'} />
				</div>
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
