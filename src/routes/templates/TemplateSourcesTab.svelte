<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import { Plus, Trash2, Globe, Loader2, CheckCircle2, XCircle, ShieldCheck } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import type { TemplateSource } from '$lib/server/templates';

	interface Props {
		onSourcesChanged: () => void;
	}

	let { onSourcesChanged }: Props = $props();

	let sources = $state<TemplateSource[]>([]);
	let loading = $state(true);
	let addingNew = $state(false);
	let newName = $state('');
	let newUrl = $state('');
	let validating = $state(false);
	let validationResults = $state<Map<string, { ok: boolean; count?: number; error?: string }>>(new Map());

	async function loadSources() {
		loading = true;
		try {
			const response = await fetch('/api/templates/sources');
			if (response.ok) {
				sources = await response.json();
			}
		} catch {
			toast.error('加载模板源失败');
		} finally {
			loading = false;
		}
	}

	async function toggleSource(source: TemplateSource) {
		const newEnabled = !source.enabled;
		source.enabled = newEnabled;
		sources = sources;
		try {
			const response = await fetch('/api/templates/sources', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: source.id, enabled: newEnabled })
			});
			if (!response.ok) throw new Error();
			onSourcesChanged();
		} catch {
			source.enabled = !newEnabled;
			sources = sources;
			toast.error('更新模板源状态失败');
		}
	}

	async function removeSource(source: TemplateSource) {
		try {
			const response = await fetch(`/api/templates/sources?id=${source.id}`, { method: 'DELETE' });
			if (!response.ok) throw new Error();
			sources = sources.filter(s => s.id !== source.id);
			toast.success('模板源已移除');
			onSourcesChanged();
		} catch {
			toast.error('删除模板源失败');
		}
	}

	async function addSource() {
		if (!newName.trim() || !newUrl.trim()) return;
		try {
			const response = await fetch('/api/templates/sources', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newName.trim(), url: newUrl.trim() })
			});
			if (!response.ok) throw new Error();
			const newSource = await response.json();
			sources = [...sources, newSource];
			newName = '';
			newUrl = '';
			addingNew = false;
			toast.success('模板源添加成功');
			onSourcesChanged();
		} catch {
			toast.error('添加模板源失败');
		}
	}

	async function validateAllSources() {
		validating = true;
		validationResults = new Map();
		let failedCount = 0;

		const checks = sources.map(async (source) => {
			const key = source.sourceId;
			try {
				const response = await fetch(source.url, {
					signal: AbortSignal.timeout(15000)
				});
				if (!response.ok) {
					validationResults.set(key, { ok: false, error: `HTTP ${response.status}` });
					failedCount++;
					return;
				}
				const data = await response.json();
				const templates = Array.isArray(data) ? data : (data.templates || []);
				validationResults.set(key, { ok: true, count: templates.length });
			} catch (error) {
				const msg = error instanceof Error ? error.message : '连接失败';
				validationResults.set(key, { ok: false, error: msg });
				failedCount++;
			}
		});

		await Promise.allSettled(checks);
		validationResults = new Map(validationResults);
		validating = false;

		if (failedCount > 0) {
			toast.warning(`${failedCount} 个模板源校验未通过`);
		} else {
			toast.success('所有模板源均可正常访问');
		}
	}

	async function disableInactive() {
		let disabled = 0;
		for (const source of sources) {
			const result = validationResults.get(source.sourceId);
			if (result && !result.ok && source.enabled) {
				await fetch('/api/templates/sources', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: source.id, enabled: false })
				});
				source.enabled = false;
				disabled++;
			}
		}
		sources = sources;
		if (disabled > 0) {
			toast.success(`已禁用 ${disabled} 个不可用模板源`);
			onSourcesChanged();
		}
	}

	$effect(() => {
		loadSources();
	});
</script>

<div class="space-y-4 max-w-3xl">
	<div class="flex items-center justify-between">
		<p class="text-sm text-muted-foreground">
			配置模板仓库源。模板数据拉取后会缓存一小时。
		</p>
		<div class="flex items-center gap-2">
			<Button size="sm" variant="outline" onclick={validateAllSources} disabled={validating}>
				{#if validating}
					<Loader2 class="w-3.5 h-3.5 mr-1.5 animate-spin" />
					正在校验...
				{:else}
					<ShieldCheck class="w-3.5 h-3.5 mr-1.5" />
					校验全部
				{/if}
			</Button>
			{#if validationResults.size > 0 && [...validationResults.values()].some(v => !v.ok)}
				<Button size="sm" variant="outline" onclick={disableInactive}>
					<XCircle class="w-3.5 h-3.5 mr-1.5" />
					禁用不可用源
				</Button>
			{/if}
			<Button size="sm" onclick={() => addingNew = !addingNew}>
				<Plus class="w-3.5 h-3.5 mr-1.5" />
				添加模板源
			</Button>
		</div>
	</div>

	{#if addingNew}
		<Card.Root class="gap-0 py-0 border-dashed border-primary/50">
			<Card.Content class="p-3">
				<div class="flex items-end gap-3">
					<div class="flex-1 space-y-1">
						<label for="new-source-name" class="text-xs font-medium text-muted-foreground">名称</label>
						<Input id="new-source-name" bind:value={newName} placeholder="自定义模板库" class="h-8 text-sm" />
					</div>
					<div class="flex-[2] space-y-1">
						<label for="new-source-url" class="text-xs font-medium text-muted-foreground">URL</label>
						<Input id="new-source-url" bind:value={newUrl} placeholder="https://example.com/templates.json" class="h-8 text-sm" />
					</div>
					<Button size="sm" onclick={addSource} disabled={!newName.trim() || !newUrl.trim()}>添加</Button>
					<Button size="sm" variant="ghost" onclick={() => addingNew = false}>取消</Button>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if loading}
		<div class="flex items-center justify-center py-8 text-muted-foreground">
			<Loader2 class="w-5 h-5 animate-spin mr-2" />
			正在加载模板源...
		</div>
	{:else}
		<div class="space-y-2">
			{#each sources as source (source.id)}
				{@const validation = validationResults.get(source.sourceId)}
				<Card.Root class="gap-0 py-0">
					<Card.Content class="py-3 px-4">
						<div class="flex items-center gap-4">
							<div class="w-8 h-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
								{#if validation}
									{#if validation.ok}
										<CheckCircle2 class="w-4 h-4 text-emerald-500" />
									{:else}
										<XCircle class="w-4 h-4 text-destructive" />
									{/if}
								{:else}
									<Globe class="w-4 h-4 text-muted-foreground" />
								{/if}
							</div>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<span class="text-sm font-medium">{source.name}</span>
									{#if validation?.ok && validation.count !== undefined}
										<span class="text-xs text-muted-foreground">(共 {validation.count} 个模板)</span>
									{/if}
								</div>
								<div class="text-xs text-muted-foreground truncate">{source.url}</div>
								{#if validation && !validation.ok}
									<div class="text-xs text-destructive mt-0.5">{validation.error}</div>
								{/if}
							</div>
							<TogglePill
								checked={source.enabled}
								onchange={() => toggleSource(source)}
							/>
							{#if !source.builtin}
								<Button
									size="icon-sm"
									variant="ghost"
									onclick={() => removeSource(source)}
								>
									<Trash2 class="w-3.5 h-3.5 text-destructive" />
								</Button>
							{/if}
						</div>
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>
