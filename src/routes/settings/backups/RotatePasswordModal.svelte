<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { KeyRound, Loader2, AlertTriangle } from 'lucide-svelte';

	interface Props {
		open: boolean;
		destinationId: number;
		destinationName: string;
	}

	let { open = $bindable(), destinationId, destinationName }: Props = $props();

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let submitting = $state(false);
	let dbOutOfSync = $state(false);
	let errorMsg = $state<string | null>(null);

	// Reset when the dialog opens for a new destination
	$effect(() => {
		if (open) {
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
			dbOutOfSync = false;
			errorMsg = null;
		}
	});

	const passwordsMatch = $derived(newPassword.length > 0 && newPassword === confirmPassword);
	const canSubmit = $derived(
		!submitting &&
		currentPassword.length > 0 &&
		newPassword.length > 0 &&
		passwordsMatch &&
		newPassword !== currentPassword
	);

	async function submit() {
		errorMsg = null;
		dbOutOfSync = false;
		submitting = true;
		try {
			const res = await fetch(`/api/backup/destinations/${destinationId}/rotate-key`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok && data.success) {
				toast.success(`已为 "${destinationName}" 轮换仓库密码`);
				open = false;
				return;
			}
			if (data.dbOutOfSync) {
				dbOutOfSync = true;
				errorMsg = data.error || '仓库密码已轮换，但 Dockhand 无法保存新密码。';
				return;
			}
			errorMsg = data.error || `密码轮换失败 (HTTP ${res.status})`;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : String(err);
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<KeyRound class="w-4 h-4" />
				轮换仓库密码
			</Dialog.Title>
			<Dialog.Description>
				修改 <strong>{destinationName}</strong> 的 restic 加密密码。需要输入当前密码进行验证。
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-3 py-2">
			<div class="space-y-1">
				<Label for="rotate-current">当前密码</Label>
				<Input id="rotate-current" type="password" bind:value={currentPassword} autocomplete="current-password" />
			</div>
			<div class="space-y-1">
				<Label for="rotate-new">新密码</Label>
				<Input id="rotate-new" type="password" bind:value={newPassword} autocomplete="new-password" />
			</div>
			<div class="space-y-1">
				<Label for="rotate-confirm">确认新密码</Label>
				<Input id="rotate-confirm" type="password" bind:value={confirmPassword} autocomplete="new-password" />
				{#if confirmPassword.length > 0 && !passwordsMatch}
					<p class="text-xs text-destructive">两次输入的密码不一致</p>
				{/if}
				{#if newPassword.length > 0 && newPassword === currentPassword}
					<p class="text-xs text-destructive">新密码不能与当前密码相同</p>
				{/if}
			</div>

			{#if errorMsg}
				<div class="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
					<div class="flex items-start gap-2">
						<AlertTriangle class="w-4 h-4 mt-0.5 text-destructive shrink-0" />
						<div>
							<p class="font-medium text-destructive">
								{#if dbOutOfSync}
									仓库密码已更新，但数据库同步失败
								{:else}
									密码轮换失败
								{/if}
							</p>
							<p class="text-muted-foreground mt-1 break-words">{errorMsg}</p>
							{#if dbOutOfSync}
								<p class="text-muted-foreground mt-2">
									打开 <strong>编辑存储目标</strong>，手动填入新密码，否则 Dockhand 无法访问该仓库。
								</p>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={submitting}>取消</Button>
			<Button onclick={submit} disabled={!canSubmit}>
				{#if submitting}
					<Loader2 class="w-3 h-3 mr-2 animate-spin" />
					轮换中…
				{:else}
					轮换密码
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
