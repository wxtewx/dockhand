<script lang="ts">
	import { tick } from 'svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Popover from '$lib/components/ui/popover';
	import { Tags as TagsIcon, Plus, Trash2, Check, Pencil } from 'lucide-svelte';
	import ConfirmPopover from '$lib/components/ConfirmPopover.svelte';
	import TagIconPicker from '$lib/components/TagIconPicker.svelte';
	import TagLucideIcon from '$lib/components/TagLucideIcon.svelte';
	import { toast } from 'svelte-sonner';
	import { isAdmin } from '$lib/stores/auth';
	import { TAG_COLORS, tagHex, normalizeTag, type Tag, type TagColor } from '$lib/utils/tags-core';
	import { Tag as TagIcon } from 'lucide-svelte';

	let tags = $state<Tag[]>([]);
	let loading = $state(false);
	// The tag catalog is global and shared; only admins may create/rename/recolour/delete.
	const canEdit = $derived($isAdmin);

	// New-tag form
	let newName = $state('');
	let newColor = $state<TagColor>('blue');
	let newIcon = $state<string | null>(null);
	let creating = $state(false);

	// Inline edit state
	let editId = $state<number | null>(null);
	let editName = $state('');
	let editInput = $state<HTMLInputElement | null>(null);

	async function startRename(tag: { id: number; name: string }) {
		editId = tag.id;
		editName = tag.name;
		await tick();
		editInput?.focus();
		editInput?.select();
	}
	let colorPopoverId = $state<number | null>(null);

	async function load() {
		loading = true;
		try {
			const res = await fetch(`/api/tags`);
			tags = res.ok ? (await res.json()).tags : [];
		} catch { tags = []; } finally { loading = false; }
	}

	$effect(() => { load(); });

	async function create() {
		const name = normalizeTag(newName);
		if (!name || creating) return;
		creating = true;
		try {
			const res = await fetch(`/api/tags`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, color: newColor, icon: newIcon })
			});
			if (!res.ok) { toast.error('创建标签失败'); return; }
			newName = ''; newColor = 'blue'; newIcon = null;
			await load();
		} finally { creating = false; }
	}

	async function saveEdit(tag: Tag) {
		const name = normalizeTag(editName);
		if (!name) { editId = null; return; }
		// Keep the editor open when the rename is rejected (e.g. duplicate name).
		if (await patch(tag.id, { name })) editId = null;
	}

	async function setColor(tag: Tag, color: TagColor) {
		colorPopoverId = null;
		await patch(tag.id, { color });
	}

	async function setIcon(tag: Tag, icon: string | null) {
		await patch(tag.id, { icon });
	}

	async function patch(id: number, body: Record<string, unknown>): Promise<boolean> {
		try {
			const res = await fetch(`/api/tags/${id}`, {
				method: 'PUT', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const msg = await res.json().then((d) => d?.error).catch(() => null);
				toast.error(msg || '更新标签失败');
				return false;
			}
			await load();
			return true;
		} catch { toast.error('更新标签失败'); return false; }
	}

	async function remove(tag: Tag) {
		try {
			const res = await fetch(`/api/tags/${tag.id}`, { method: 'DELETE' });
			if (!res.ok) { toast.error('删除标签失败'); return; }
			toast.success(`已删除 "${tag.name}"`);
			await load();
		} catch { toast.error('删除标签失败'); }
	}
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-start justify-between gap-3">
			<div class="flex items-center gap-2">
				<TagsIcon class="w-4 h-4 text-muted-foreground" />
				<div>
					<Card.Title class="text-base">标签</Card.Title>
					<Card.Description>
						使用自定义标签整理容器和堆栈。标签在所有环境之间共享；在各个环境中分别设置哪些容器和堆栈使用该标签。
						{#if !canEdit} 只有管理员可以创建或编辑标签。{/if}
					</Card.Description>
				</div>
			</div>
		</div>
	</Card.Header>
	<Card.Content class="space-y-4">
		{#if canEdit}
			<!-- Create -->
			<div class="flex items-center gap-2">
				<Input bind:value={newName} placeholder="新建标签名称" class="h-9 max-w-xs"
					onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') create(); }} />
				<Popover.Root>
					<Popover.Trigger>
						{#snippet child({ props })}
							<button {...props} type="button" title="选择颜色"
								class="h-9 w-9 shrink-0 rounded-md border flex items-center justify-center">
								<span class="h-4 w-4 rounded-full" style="background-color: {tagHex(newColor)};"></span>
							</button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content class="w-auto p-2">
						<div class="grid grid-cols-8 gap-1">
							{#each TAG_COLORS as c}
								<button type="button" title={c} onclick={() => (newColor = c)}
									class="h-5 w-5 rounded-full ring-offset-1 ring-offset-background {newColor === c ? 'ring-2 ring-foreground' : ''}"
									style="background-color: {tagHex(c)};"></button>
							{/each}
						</div>
					</Popover.Content>
				</Popover.Root>
				<TagIconPicker icon={newIcon} hex={tagHex(newColor)} onSelect={(i) => (newIcon = i)} />
				<Button size="sm" onclick={create} disabled={creating || !normalizeTag(newName)}>
					<Plus class="w-4 h-4" /> 添加标签
				</Button>
			</div>
		{/if}

		{#if loading}
			<p class="text-sm text-muted-foreground">正在加载...</p>
		{:else if tags.length === 0}
			<div class="py-6 text-center text-sm text-muted-foreground">尚未创建任何标签</div>
		{:else}
			<div class="flex flex-wrap gap-2">
				{#each tags as tag (tag.id)}
					<div class="flex items-center gap-1.5 rounded-md border px-2 py-1">
						{#if editId === tag.id}
							<Input bind:value={editName} bind:ref={editInput} class="h-6 w-32 text-sm"
								onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') saveEdit(tag); if (e.key === 'Escape') editId = null; }} />
							<button type="button" class="text-primary" onclick={() => saveEdit(tag)}><Check class="w-3.5 h-3.5" /></button>
						{:else}
							{@const hex = tagHex(tag.color)}
							<span class="inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-2xs font-medium"
								style="color: {hex}; background-color: {hex}1a; border-color: {hex}33;">
								{#if tag.icon}<TagLucideIcon name={tag.icon} class="h-2.5 w-2.5" />{:else}<TagIcon class="h-2.5 w-2.5" />{/if}
								{tag.name}
							</span>
							{#if canEdit}
								<!-- Recolour -->
								<Popover.Root open={colorPopoverId === tag.id} onOpenChange={(o) => colorPopoverId = o ? tag.id : null}>
									<Popover.Trigger>
										{#snippet child({ props })}
											<button {...props} type="button" title="修改颜色" class="text-muted-foreground hover:text-foreground">
												<span class="h-3 w-3 rounded-full block" style="background-color: {hex};"></span>
											</button>
										{/snippet}
									</Popover.Trigger>
									<Popover.Content class="w-auto p-2">
										<div class="grid grid-cols-8 gap-1">
											{#each TAG_COLORS as c}
												<button type="button" title={c} onclick={() => setColor(tag, c)}
													class="h-5 w-5 rounded-full ring-offset-1 ring-offset-background {tag.color === c ? 'ring-2 ring-foreground' : ''}"
													style="background-color: {tagHex(c)};"></button>
											{/each}
										</div>
									</Popover.Content>
								</Popover.Root>
								<!-- Change icon -->
								<TagIconPicker icon={tag.icon ?? null} hex={hex} triggerClass="h-5 w-5 border-0"
									onSelect={(i) => setIcon(tag, i)} />
								<button type="button" title="重命名" class="text-muted-foreground hover:text-foreground"
									onclick={() => startRename(tag)}><Pencil class="w-3 h-3" /></button>
								<ConfirmPopover
									action="删除"
									itemType="标签"
									itemName={tag.name}
									title="是否从所有容器和堆栈中删除此标签？"
									confirmText="删除"
									variant="destructive"
									onConfirm={() => remove(tag)}
								>
									{#snippet children({ open })}
										<Trash2 class="w-3 h-3 {open ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}" />
									{/snippet}
								</ConfirmPopover>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
