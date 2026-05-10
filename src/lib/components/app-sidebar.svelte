<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { useSidebar } from '$lib/components/ui/sidebar';
	import {
		LayoutDashboard,
		Box,
		Layers,
		Images,
		ScrollText,
		HardDrive,
		Network,
		PanelLeftClose,
		PanelLeft,
		Download,
		Settings,
		Terminal,
		Info,
		Crown,
		LogOut,
		User,
		ClipboardList,
		Activity,
		Timer
	} from 'lucide-svelte';
	import { licenseStore } from '$lib/stores/license';
	import { authStore, hasAnyAccess } from '$lib/stores/auth';
	import * as Avatar from '$lib/components/ui/avatar';

	import type { Permissions } from '$lib/stores/auth';

	// TypeScript interface for menu items
	interface MenuItem {
		href: string;
		Icon: typeof LayoutDashboard;
		label: string;
		// Permission resource required to see this menu item (enterprise only)
		// Show menu if user has ANY permission for this resource, or 'always' (no check)
		permission?: keyof Permissions | 'always';
		// If true, item is only visible with enterprise license
		enterpriseOnly?: boolean;
	}

	const currentPath = $derived($page.url.pathname);
	const sidebar = useSidebar();

	function isActive(path: string): boolean {
		if (path === '/') return currentPath === '/';
		return currentPath === path || currentPath.startsWith(`${path}/`);
	}

	async function handleLogout() {
		sidebar.setOpenMobile(false);
		await authStore.logout();
		goto('/login');
	}

	/**
	 * Check if a menu item should be visible based on permissions
	 * - Enterprise-only items require enterprise license
	 * - FREE edition: all non-enterprise items visible (no permission checks)
	 * - ENTERPRISE edition: check if user has ANY permission for the resource
	 */
	function canSeeMenuItem(item: MenuItem): boolean {
		// Enterprise-only items are hidden without enterprise license
		if (item.enterpriseOnly && !$licenseStore.isEnterprise) {
			return false;
		}

		// FREE edition or auth disabled = all items visible (except enterprise-only)
		if (!$licenseStore.isEnterprise || !$authStore.authEnabled) {
			return true;
		}

		// ENTERPRISE edition: check permissions
		// Admins see everything
		if ($authStore.user?.isAdmin) {
			return true;
		}

		// No permission specified = always visible
		if (!item.permission || item.permission === 'always') {
			return true;
		}

		// Check if user has ANY permission for this resource
		return $hasAnyAccess(item.permission);
	}

	const menuItems: readonly MenuItem[] = [
		{ href: '/', Icon: LayoutDashboard, label: '仪表盘', permission: 'always' },
		{ href: '/containers', Icon: Box, label: '容器', permission: 'containers' },
		{ href: '/logs', Icon: ScrollText, label: '日志', permission: 'containers' },
		{ href: '/terminal', Icon: Terminal, label: '终端', permission: 'containers' },
		{ href: '/stacks', Icon: Layers, label: '堆栈', permission: 'stacks' },
		{ href: '/images', Icon: Images, label: '镜像', permission: 'images' },
		{ href: '/volumes', Icon: HardDrive, label: '数据卷', permission: 'volumes' },
		{ href: '/networks', Icon: Network, label: '网络', permission: 'networks' },
		{ href: '/registry', Icon: Download, label: '镜像仓库', permission: 'registries' },
		{ href: '/activity', Icon: Activity, label: '活动记录', permission: 'activity' },
		{ href: '/schedules', Icon: Timer, label: '定时任务', permission: 'schedules' },
		{ href: '/audit', Icon: ClipboardList, label: '审计日志', permission: 'audit_logs', enterpriseOnly: true },
		{ href: '/settings', Icon: Settings, label: '设置', permission: 'settings' }
	] as const;
</script>

<Sidebar.Root collapsible="icon">
	<Sidebar.Header class="overflow-visible flex items-center justify-center p-0">
		<!-- Expanded state: logo + collapse button -->
		<div class="relative flex items-center justify-center w-full group-data-[state=collapsed]:hidden">
			<a href="/" class="flex justify-center relative">
				<img src="/logo-light.webp" alt="Dockhand 标志" class="h-[52px] w-auto object-contain mt-2 mb-1 dark:hidden" style="filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.3)) drop-shadow(-1px -1px 1px rgba(255,255,255,0.9));" />
				<img src="/logo-dark.webp" alt="Dockhand 标志" class="h-[52px] w-auto object-contain mt-2 mb-1 hidden dark:block" style="filter: drop-shadow(2px 2px 3px rgba(0,0,0,0.6)) drop-shadow(-1px -1px 1px rgba(255,255,255,0.2));" />
				{#if $licenseStore.isEnterprise}
					<Crown class="w-4 h-4 absolute top-0 -right-[6px] text-amber-500 fill-amber-400 drop-shadow-sm rotate-[20deg]" />
				{/if}
			</a>
			<button
				type="button"
				onclick={() => sidebar.toggle()}
				class="absolute right-1 p-1.5 rounded-md hover:bg-sidebar-accent text-gray-300 hover:text-gray-400 transition-colors"
				title="收起侧边栏"
				aria-label="收起侧边栏"
			>
				<PanelLeftClose class="w-4 h-4" aria-hidden="true" />
			</button>
		</div>
		<!-- Collapsed state: expand button only -->
		<button
			type="button"
			onclick={() => sidebar.toggle()}
			class="hidden group-data-[state=collapsed]:flex p-1.5 rounded-md hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors"
			title="展开侧边栏"
			aria-label="展开侧边栏"
		>
			<PanelLeft class="w-4 h-4" aria-hidden="true" />
		</button>
	</Sidebar.Header>

	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.Menu>
				{#each menuItems as item}
					{#if canSeeMenuItem(item)}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton href={item.href} isActive={isActive(item.href)} tooltipContent={item.label} onclick={() => sidebar.setOpenMobile(false)}>
							<item.Icon aria-hidden="true" />
							<span class="group-data-[state=collapsed]:hidden">{item.label}</span>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
					{/if}
				{/each}
			</Sidebar.Menu>
		</Sidebar.Group>
	</Sidebar.Content>

	<!-- User info footer (only when auth is enabled) -->
	{#if $authStore.authEnabled && $authStore.authenticated && $authStore.user}
		<Sidebar.Footer class="border-t">
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<a
						href="/profile"
						onclick={() => sidebar.setOpenMobile(false)}
						class="flex items-center gap-2 px-2 py-1.5 group-data-[state=collapsed]:px-1 group-data-[state=collapsed]:py-1 rounded-md hover:bg-sidebar-accent transition-colors group-data-[state=collapsed]:justify-center"
						title="查看个人资料"
					>
						<Avatar.Root class="w-8 h-8 group-data-[state=collapsed]:w-6 group-data-[state=collapsed]:h-6 shrink-0 transition-all">
							<Avatar.Image src={$authStore.user.avatar} alt={$authStore.user.username} />
							<Avatar.Fallback class="bg-primary/10 text-primary text-xs">
								{($authStore.user.displayName || $authStore.user.username)?.slice(0, 2).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
						<div class="flex flex-col min-w-0 group-data-[state=collapsed]:hidden">
							<span class="text-sm font-medium truncate">{$authStore.user.displayName || $authStore.user.username}</span>
							<span class="text-xs text-muted-foreground truncate">{$authStore.user.isAdmin ? '管理员' : '普通用户'}</span>
						</div>
					</a>
				</Sidebar.MenuItem>
				<Sidebar.MenuItem>
					<button
						type="button"
						onclick={handleLogout}
						class="flex items-center gap-2 w-full px-2 py-1.5 group-data-[state=collapsed]:px-1 group-data-[state=collapsed]:py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded-md transition-colors group-data-[state=collapsed]:justify-center"
						title="退出登录"
					>
						<LogOut class="w-4 h-4 shrink-0 group-data-[state=collapsed]:w-3.5 group-data-[state=collapsed]:h-3.5" />
						<span class="group-data-[state=collapsed]:hidden">退出登录</span>
					</button>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Footer>
	{/if}
</Sidebar.Root>
