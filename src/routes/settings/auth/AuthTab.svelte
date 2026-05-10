<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Shield,
		User,
		Settings,
		Crown,
		KeyRound,
		Network,
		LogIn,
		RefreshCw,
		Save
	} from 'lucide-svelte';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import { canAccess, authStore } from '$lib/stores/auth';
	import { licenseStore } from '$lib/stores/license';

	// Sub-tab components
	import UsersSubTab from './users/UsersSubTab.svelte';
	import LdapSubTab from './ldap/LdapSubTab.svelte';
	import SsoSubTab from './oidc/SsoSubTab.svelte';
	import RolesSubTab from './roles/RolesSubTab.svelte';

	// Props
	interface Props {
		onTabChange?: (tab: string) => void;
	}

	let { onTabChange = (_tab: string) => {} }: Props = $props();

	// Role type for passing to sub-tabs
	interface Role {
		id: number;
		name: string;
		description?: string;
		isSystem: boolean;
		permissions: any;
		createdAt: string;
	}

	// Authentication state
	let authSubTab = $state<'general' | 'local' | 'ldap' | 'sso' | 'roles'>('general');
	let authEnabled = $state(false);
	let authLoading = $state(true);
	let sessionTimeout = $state(86400);
	let authSaving = $state(false);

	// Roles state (shared with sub-tabs that need it)
	let roles = $state<Role[]>([]);

	// === Authentication Functions ===
	async function fetchAuthSettings() {
		authLoading = true;
		try {
			const response = await fetch('/api/auth/settings');
			if (response.ok) {
				const data = await response.json();
				authEnabled = data.authEnabled;
				sessionTimeout = data.sessionTimeout || 86400;
			}
		} catch (error) {
			console.error('获取身份验证设置失败:', error);
		} finally {
			authLoading = false;
		}
	}

	async function fetchRoles() {
		try {
			const response = await fetch('/api/roles');
			if (response.ok) {
				roles = await response.json();
			}
		} catch (error) {
			console.error('获取角色失败:', error);
		}
	}

	async function handleAuthEnabledToggle(checked: boolean) {
		authSaving = true;
		try {
			const response = await fetch('/api/auth/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ authEnabled: checked })
			});
			if (response.ok) {
				// authEnabled already updated via binding
				toast.success(checked ? '身份验证已启用' : '身份验证已禁用');
				// Update global auth store so other components react immediately
				await authStore.check();
			} else {
				const data = await response.json();
				toast.error(data.error || '更新身份验证设置失败');
				// Revert toggle on error - checked is new value, so previous was !checked
				authEnabled = !checked;
			}
		} catch (error) {
			console.error('更新身份验证设置失败:', error);
			toast.error('更新身份验证设置失败');
			// Revert toggle on error
			authEnabled = !checked;
		} finally {
			authSaving = false;
		}
	}

	async function saveAuthSettings() {
		authSaving = true;
		try {
			const response = await fetch('/api/auth/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionTimeout: sessionTimeout })
			});
			if (response.ok) {
				toast.success('设置已保存');
			} else {
				console.error('保存身份验证设置失败');
				toast.error('保存设置失败');
			}
		} catch (error) {
			console.error('保存身份验证设置失败:', error);
			toast.error('保存设置失败');
		} finally {
			authSaving = false;
		}
	}

	// Initialize on mount
	onMount(() => {
		fetchAuthSettings();
	});

	// Fetch roles reactively when enterprise license is detected or when switching to users tab
	$effect(() => {
		if ($licenseStore.isEnterprise) {
			fetchRoles();
		}
	});

	// Refetch roles when switching to users tab (in case roles were added/modified)
	$effect(() => {
		if (authSubTab === 'local' && $licenseStore.isEnterprise) {
			fetchRoles();
		}
	});
</script>

<div class="flex flex-col flex-1 min-h-0">
<!-- Auth Enable/Disable Toggle at Top -->
<div class="flex items-start gap-3 p-3 mb-3 border rounded-md bg-muted/30 flex-shrink-0">
	<Shield class="w-5 h-5 text-muted-foreground mt-0.5" />
	<div class="flex-1">
		<div class="flex items-center gap-3">
			<p class="text-sm font-medium">身份验证</p>
			<TogglePill
				bind:checked={authEnabled}
				onchange={(checked) => handleAuthEnabledToggle(checked)}
				disabled={authLoading || authSaving || !$canAccess('settings', 'edit')}
			/>
		</div>
		<p class="text-xs text-muted-foreground mt-1">
			{authEnabled
				? '用户必须登录才能访问系统'
				: '身份验证已关闭 - 允许公开访问'}
		</p>
		<p class="text-xs text-muted-foreground mt-1 flex items-center gap-1">
			<Crown class="w-3 h-3 text-amber-500" />
			{#if $licenseStore.isEnterprise}
				{authEnabled
					? '审计日志已启用 - 所有操作均已记录'
					: '启用身份验证以激活审计日志'}
			{:else}
				启用身份验证以激活审计日志
			{/if}
		</p>
	</div>
</div>

<!-- Auth Subtabs Navigation -->
<div class="inline-flex gap-1 p-1 bg-muted/50 rounded-lg mb-3 flex-shrink-0">
	<button
		class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all {authSubTab ===
		'general'
			? 'bg-background text-foreground shadow-sm'
			: 'text-muted-foreground hover:text-foreground'}"
		onclick={() => (authSubTab = 'general')}
	>
		<Settings class="w-4 h-4" />
		常规设置
	</button>
	<button
		class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all {authSubTab ===
		'local'
			? 'bg-background text-foreground shadow-sm'
			: 'text-muted-foreground hover:text-foreground'}"
		onclick={() => (authSubTab = 'local')}
	>
		<User class="w-4 h-4" />
		用户管理
	</button>
	<button
		class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all {authSubTab ===
		'sso'
			? 'bg-background text-foreground shadow-sm'
			: 'text-muted-foreground hover:text-foreground'}"
		onclick={() => (authSubTab = 'sso')}
	>
		<LogIn class="w-4 h-4" />
		SSO / OIDC
	</button>
	<button
		class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all {authSubTab ===
		'ldap'
			? 'bg-background text-foreground shadow-sm'
			: 'text-muted-foreground hover:text-foreground'}"
		onclick={() => (authSubTab = 'ldap')}
	>
		<Network class="w-4 h-4" />
		LDAP / AD
		<Crown class="w-3 h-3 text-amber-500" />
	</button>
	<button
		class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all {authSubTab ===
		'roles'
			? 'bg-background text-foreground shadow-sm'
			: 'text-muted-foreground hover:text-foreground'}"
		onclick={() => (authSubTab = 'roles')}
	>
		<Shield class="w-4 h-4" />
		角色权限
		<Crown class="w-3 h-3 text-amber-500" />
	</button>
</div>

<!-- Sub-tab Content -->
<div class="flex flex-col flex-1 min-h-0 overflow-hidden">
<!-- General Settings Subtab -->
{#if authSubTab === 'general'}
	<div class="flex-1 min-h-0 overflow-y-auto space-y-4">
		{#if authEnabled}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-sm font-medium flex items-center gap-2">
						<KeyRound class="w-4 h-4" />
						会话设置
					</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="space-y-1.5">
						<Label class="text-sm">会话超时时间</Label>
						<p class="text-xs text-muted-foreground mb-2">
							非活动会话过期前的持续时长
						</p>
						<div class="flex items-center gap-2">
							<Input
								type="number"
								value={sessionTimeout}
								min={3600}
								max={604800}
								onchange={(e) => {
									const val = parseInt(e.currentTarget.value);
									sessionTimeout = Math.max(3600, Math.min(604800, isNaN(val) ? 86400 : val));
									e.currentTarget.value = String(sessionTimeout);
								}}
								class="w-32"
								disabled={!$canAccess('settings', 'edit')}
							/>
							<span class="text-sm text-muted-foreground">秒</span>
							<span class="text-xs text-muted-foreground">
								({Math.floor(sessionTimeout / 3600)} 小时)
							</span>
						</div>
					</div>
					{#if $canAccess('settings', 'edit')}
						<Button size="sm" onclick={saveAuthSettings} disabled={authSaving}>
							{#if authSaving}
								<RefreshCw class="w-4 h-4 mr-1 animate-spin" />
							{:else}
								<Save class="w-4 h-4" />
							{/if}
							保存设置
						</Button>
					{/if}
				</Card.Content>
			</Card.Root>
		{:else}
			<div class="text-center py-12 text-muted-foreground">
				<Shield class="w-12 h-12 mx-auto mb-3 opacity-30" />
				<p class="text-sm">启用身份验证后可配置会话设置</p>
			</div>
		{/if}
	</div>
{/if}

<!-- Local Users Subtab -->
{#if authSubTab === 'local'}
	<div class="flex flex-col flex-1 min-h-0">
		<UsersSubTab {roles} />
	</div>
{/if}

<!-- LDAP / AD Subtab -->
{#if authSubTab === 'ldap'}
	<div class="flex-1 min-h-0 overflow-y-auto">
		<LdapSubTab {onTabChange} />
	</div>
{/if}

<!-- SSO / OIDC Subtab -->
{#if authSubTab === 'sso'}
	<div class="flex-1 min-h-0 overflow-y-auto">
		<SsoSubTab {roles} />
	</div>
{/if}

<!-- Roles Subtab -->
{#if authSubTab === 'roles'}
	<div class="flex-1 min-h-0 overflow-y-auto">
		<RolesSubTab {onTabChange} />
	</div>
{/if}
</div>
</div>
