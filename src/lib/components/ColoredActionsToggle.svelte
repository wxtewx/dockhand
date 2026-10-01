<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import { themeStore } from '$lib/stores/theme';
	import { authStore } from '$lib/stores/auth';
	import { resolveToggleValue, shouldSkipApply } from '$lib/utils/theme-preference';
	import { toast } from 'svelte-sonner';

	interface Props {
		userId?: number; // omit for global default (login page / auth-disabled)
		// When set, the toggle reflects and saves this global default (the General settings
		// editor) instead of the current user's profile preference. Omit elsewhere.
		globalValue?: boolean;
	}

	let { userId, globalValue }: Props = $props();

	const skipApply = $derived(shouldSkipApply($authStore.loading, $authStore.authEnabled, userId));

	let checked = $state(false);
	$effect(() => {
		checked = resolveToggleValue(globalValue, $themeStore.coloredActionButtons);
	});

	function onToggle(value: boolean) {
		checked = value;
		themeStore.setPreference('coloredActionButtons', value, userId, skipApply);
		toast.success(value ? '操作按钮已启用彩色样式' : '操作按钮已恢复默认灰色样式');
	}
</script>

<div class="space-y-1">
	<div class="flex items-center gap-3">
		<Label>彩色网格按钮</Label>
		<TogglePill {checked} onchange={onToggle} />
	</div>
	<p class="text-xs text-muted-foreground">使用语义化色彩替代暗淡灰色</p>
</div>
