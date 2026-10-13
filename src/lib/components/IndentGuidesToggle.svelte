<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import { themeStore } from '$lib/stores/theme';
	import { authStore } from '$lib/stores/auth';
	import { resolveToggleValue, shouldSkipApply } from '$lib/utils/theme-preference';
	import { toast } from 'svelte-sonner';

	interface Props {
		userId?: number; // omit for global default (login page / auth-disabled)
		// When set, the toggle reflects and saves this global default instead of the profile.
		globalValue?: boolean;
	}

	let { userId, globalValue }: Props = $props();

	// Same "skip applying" rule as ThemeSelector: don't touch the live editor when the
	// admin is editing the global default while logged in (their own per-user preference
	// still drives their session).
	const skipApply = $derived(shouldSkipApply($authStore.loading, $authStore.authEnabled, userId));

	let checked = $state(false);
	$effect(() => {
		checked = resolveToggleValue(globalValue, $themeStore.editorIndentGuides);
	});

	function onToggle(value: boolean) {
		checked = value;
		themeStore.setPreference('editorIndentGuides', value, userId, skipApply);
		toast.success(value ? '已启用缩进参考线' : '已关闭缩进参考线');
	}
</script>

<div class="space-y-1">
	<div class="flex items-center gap-3">
		<Label>缩进参考线</Label>
		<TogglePill {checked} onchange={onToggle} />
	</div>
	<p class="text-xs text-muted-foreground">在代码编辑器中显示代表嵌套层级的垂直参考线。</p>
</div>
