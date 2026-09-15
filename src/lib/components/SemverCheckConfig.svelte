<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import { Tag, Info } from 'lucide-svelte';
	import { getLabelText } from '$lib/types';

	type Bump = 'patch' | 'minor' | 'major';

	interface Props {
		/** Master toggle: also detect newer version tags for pinned images. */
		enabled: boolean;
		/** Cap the surfaced bump. */
		maxBump: Bump;
		/** Require the same tag suffix (flavor) as the running tag. */
		matchFlavor: boolean;
		/** Consider -rc/-beta prerelease tags. */
		includePrerelease: boolean;
		/**
		 * When set, the current tag is floating (latest/stable/sha) so there is no
		 * version to compare — the toggle is disabled and this tag is shown in the hint.
		 * Container scope passes it; env scope leaves it undefined.
		 */
		floatingTag?: string;
	}

	let {
		enabled = $bindable(),
		maxBump = $bindable(),
		matchFlavor = $bindable(),
		includePrerelease = $bindable(),
		floatingTag
	}: Props = $props();

	const isFloating = $derived(!!floatingTag);
	const bumps: Bump[] = ['patch', 'minor', 'major'];
</script>

<div class="space-y-4">
	<div class="flex items-start gap-2" class:opacity-55={isFloating}>
		<Tag class="w-4 h-4 text-green-500 glow-green mt-0.5 shrink-0" />
		<div class="flex-1">
			<Label>检查新版本标签</Label>
			<p class="text-xs text-muted-foreground mt-0.5">
				对于已锁定版本标签的容器 (例如：<code>16.2</code>、<code>v3.0</code>)，检测是否发布了更新版本。仅作提示用途。
			</p>
		</div>
		<TogglePill bind:checked={enabled} disabled={isFloating} />
	</div>

	{#if isFloating}
		<div class="ml-6 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
			<Info class="w-3.5 h-3.5 mt-0.5 shrink-0" />
			<span><code>{floatingTag}</code> 属于浮动标签，请锁定版本标签 (例如：<code>1.26</code>) 后才可启用新版本检测功能。</span>
		</div>
	{:else if enabled}
		<!-- Indented under the header so it reads as "all this belongs to the toggle
		     above"; the boxes inside are full-width of THIS container so they line up. -->
		<div class="ml-6 space-y-4">
			<!-- max bump -->
			<div class="space-y-2">
				<div class="flex items-center gap-4">
					<Label class="flex-1">显示哪些更新</Label>
					<div class="inline-flex shrink-0 gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5">
						{#each bumps as bump}
							<button
								type="button"
								onclick={() => (maxBump = bump)}
								class="rounded-md px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors
									{maxBump === bump
										? 'bg-green-500/15 text-green-500 shadow-[inset_0_0_0_1px_rgba(34,197,94,0.3)]'
										: 'text-muted-foreground hover:text-foreground'}"
							>
								{getLabelText(bump)}
							</button>
						{/each}
					</div>
				</div>
				<div class="rounded-md border border-border bg-muted/40 p-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
					当前版本为 <code>1.4.2</code>，你将收到如下更新提示:<br />
					<span class="font-bold text-foreground">补丁版本</span> 仅漏洞与问题修复 → <code>1.4.3</code><br />
					<span class="font-bold text-foreground">次版本</span> 包含新增功能 → <code>1.4.3</code>, <code>1.5.0</code><br />
					<span class="font-bold text-foreground">主版本</span> 全部更新，包含不兼容变更 → <code>1.4.3</code>, <code>1.5.0</code>, <code>2.0.0</code>
				</div>
			</div>

			<!-- match flavor -->
			<div class="space-y-2 border-t border-border/60 pt-3">
				<div class="flex items-start gap-4">
					<div class="flex-1">
						<Label>匹配标签变体后缀</Label>
						<p class="text-xs text-muted-foreground mt-0.5">
							仅推荐与当前运行标签拥有相同后缀的版本，即变体后缀，例如
							<code>-alpine</code> 或 <code>-ls123</code>.
						</p>
					</div>
					<div class="shrink-0"><TogglePill bind:checked={matchFlavor} /></div>
				</div>
				<div class="rounded-md border border-border bg-muted/40 p-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
					<span class="font-bold text-foreground">开启</span> <code>1.2-alpine</code> → 仅匹配 <code>1.5-alpine</code>，不会匹配无后缀的 <code>1.5</code><br />
					<span class="font-bold text-foreground">关闭</span> 匹配任意新版本，允许不同变体后缀，提示会变多
				</div>
			</div>

			<!-- include prereleases -->
			<div class="flex items-start gap-4 border-t border-border/60 pt-3">
				<div class="flex-1">
					<Label>包含预发布版本</Label>
					<p class="text-xs text-muted-foreground mt-0.5">
						识别 <code>-rc</code> / <code>‑beta</code> 标签。关闭时仅接收稳定版本更新，保障部署稳定性。
					</p>
				</div>
				<div class="shrink-0"><TogglePill bind:checked={includePrerelease} /></div>
			</div>
		</div>
	{/if}

	{#if enabled && !isFloating}
		<div class="ml-6 flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
			<Info class="w-3.5 h-3.5 mt-0.5 shrink-0" />
			<span>新版本将在容器上以徽章形式展示，<strong class="text-foreground font-semibold">不会自动执行更新</strong>。</span>
		</div>
	{/if}
</div>

<style>
	code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.9em;
		background: hsl(var(--muted));
		border: 1px solid hsl(var(--border));
		border-radius: 4px;
		padding: 0 4px;
	}
</style>
