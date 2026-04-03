<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Sun, Moon } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { onDarkModeChange } from '$lib/stores/theme';

	let isDark = $state(false);

	onMount(() => {
		// Check for saved preference or system preference
		const saved = localStorage.getItem('theme');
		if (saved) {
			isDark = saved === 'dark';
		} else {
			isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		}
		updateTheme();
	});

	function updateTheme() {
		if (isDark) {
			document.documentElement.classList.add('dark');
		} else {
			document.documentElement.classList.remove('dark');
		}
		localStorage.setItem('theme', isDark ? 'dark' : 'light');
		// Apply the correct theme colors for the new mode
		onDarkModeChange();
	}

	function toggleTheme() {
		isDark = !isDark;
		updateTheme();
	}
</script>

<Button variant="ghost" size="icon" onclick={toggleTheme} class="h-9 w-9">
	{#if isDark}
		<Sun class="h-4 w-4" />
	{:else}
		<Moon class="h-4 w-4" />
	{/if}
	<span class="sr-only">切换主题</span>
</Button>
