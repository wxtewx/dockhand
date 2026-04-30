<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Crown, Building2, Key, RefreshCw, ShieldCheck, XCircle } from 'lucide-svelte';
	import { canAccess } from '$lib/stores/auth';
	import { licenseStore } from '$lib/stores/license';
	import { formatDate } from '$lib/stores/settings';

	// License state
	interface LicenseInfo {
		valid: boolean;
		active: boolean;
		hostname?: string;
		payload?: {
			name: string;
			host: string;
			issued: string;
			expires: string | null;
			type: string;
		};
		stored?: {
			name: string;
			key: string;
			activated_at: string;
		};
		error?: string;
	}

	let licenseInfo = $state<LicenseInfo | null>(null);
	let licenseLoading = $state(true);
	let licenseFormName = $state('');
	let licenseFormKey = $state('');
	let licenseFormError = $state('');
	let licenseFormSaving = $state(false);

	async function fetchLicenseInfo() {
		licenseLoading = true;
		try {
			const response = await fetch('/api/license');
			licenseInfo = await response.json();
		} catch (error) {
			console.error('获取许可证信息失败:', error);
			licenseInfo = { valid: false, active: false, error: '获取许可证信息失败' };
		} finally {
			licenseLoading = false;
		}
	}

	async function activateLicense() {
		if (!licenseFormName.trim() || !licenseFormKey.trim()) {
			licenseFormError = '名称和许可证密钥为必填项';
			return;
		}

		licenseFormSaving = true;
		licenseFormError = '';

		try {
			const response = await fetch('/api/license', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: licenseFormName.trim(),
					key: licenseFormKey.trim()
				})
			});

			const result = await response.json();

			if (!response.ok || result.error) {
				licenseFormError = result.error || '激活许可证失败';
				return;
			}

			// Refresh license info and update global store
			await fetchLicenseInfo();
			await licenseStore.check();
			toast.success('许可证激活成功');

			// Clear form
			licenseFormName = '';
			licenseFormKey = '';
		} catch (error) {
			licenseFormError = '激活许可证失败';
			toast.error('激活许可证失败');
		} finally {
			licenseFormSaving = false;
		}
	}

	async function deactivateLicense() {
		try {
			await fetch('/api/license', { method: 'DELETE' });
			await fetchLicenseInfo();
			await licenseStore.check();
			toast.success('许可证已注销');
		} catch (error) {
			console.error('注销许可证失败:', error);
			toast.error('注销许可证失败');
		}
	}

	onMount(() => {
		fetchLicenseInfo();
	});
</script>

<div class="space-y-4">
	<Card.Root class="border-dashed">
		<Card.Content class="pt-4">
			<div class="flex items-start gap-3">
				<Crown class="w-5 h-5 text-amber-500 mt-0.5" />
				<div>
					<p class="text-sm font-medium">许可证管理</p>
					<p class="text-xs text-muted-foreground">
						激活许可证以验证商业使用权限。<span class="font-medium">企业版</span> 许可证解锁高级功能，包括 RBAC、LDAP 和审计日志。
					</p>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	{#if licenseLoading}
		<Card.Root>
			<Card.Content class="py-8 text-center">
				<RefreshCw class="w-6 h-6 mx-auto mb-2 animate-spin text-muted-foreground" />
				<p class="text-sm text-muted-foreground">正在加载许可证信息...</p>
			</Card.Content>
		</Card.Root>
	{:else if licenseInfo?.valid && licenseInfo?.active}
		<!-- Active License Display -->
		{@const isEnterprise = licenseInfo.payload?.type === 'enterprise'}
		<Card.Root class={isEnterprise ? 'border-amber-500/50 bg-amber-500/5' : 'border-blue-500/50 bg-blue-500/5'}>
			<Card.Header>
				<Card.Title class="text-sm font-medium flex items-center gap-2">
					{#if isEnterprise}
						<Crown class="w-4 h-4 text-amber-500" />
						企业版许可证已激活
					{:else}
						<Building2 class="w-4 h-4 text-blue-500" />
						中小企业版许可证已激活
					{/if}
				</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="grid grid-cols-2 gap-4 text-sm">
					<div>
						<p class="text-muted-foreground">授权对象</p>
						<p class="font-medium">{licenseInfo.payload?.name}</p>
					</div>
					<div>
						<p class="text-muted-foreground">许可证类型</p>
						<p class="font-medium flex items-center gap-1">
							{#if isEnterprise}
								<Crown class="w-3.5 h-3.5 text-amber-500" />
								<span class="text-amber-600 dark:text-amber-400">企业版</span>
							{:else}
								<Building2 class="w-3.5 h-3.5 text-blue-500" />
								<span class="text-blue-600 dark:text-blue-400">中小企业版</span>
							{/if}
						</p>
					</div>
					<div>
						<p class="text-muted-foreground">授权主机</p>
						<p class="font-medium font-mono text-xs">{licenseInfo.payload?.host}</p>
					</div>
					<div>
						<p class="text-muted-foreground">签发时间</p>
						<p class="font-medium">{formatDate(licenseInfo.payload?.issued || '')}</p>
					</div>
					<div>
						<p class="text-muted-foreground">到期时间</p>
						<p class="font-medium">{licenseInfo.payload?.expires ? formatDate(licenseInfo.payload.expires) : '永久有效'}</p>
					</div>
				</div>
				<div class="pt-2 border-t">
					<p class="text-xs text-muted-foreground mb-2">当前主机名</p>
					<code class="text-xs bg-muted px-2 py-1 rounded">{licenseInfo.hostname}</code>
				</div>
				{#if $canAccess('settings', 'edit')}
				<div class="flex justify-end">
					<Button variant="outline" size="sm" onclick={deactivateLicense}>
						<XCircle class="w-4 h-4" />
						注销许可证
					</Button>
				</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{:else}
		<!-- License Activation Form -->
		<Card.Root>
			<Card.Header>
				<Card.Title class="text-sm font-medium flex items-center gap-2">
					<Key class="w-4 h-4" />
					激活许可证
				</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if licenseFormError}
					<div class="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 rounded p-2">
						{licenseFormError}
					</div>
				{/if}

				{#if licenseInfo?.error && !licenseFormError}
					<div class="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 rounded p-2">
						{licenseInfo.error}
					</div>
				{/if}

				<div class="space-y-2">
					<Label for="license-name">许可证名称</Label>
					<Input
						id="license-name"
						bind:value={licenseFormName}
						placeholder="您的公司名称"
						disabled={!$canAccess('settings', 'edit')}
					/>
					<p class="text-xs text-muted-foreground">请输入与许可证提供的名称完全一致的内容</p>
				</div>

				<div class="space-y-2">
					<Label for="license-key">许可证密钥</Label>
					<textarea
						id="license-key"
						bind:value={licenseFormKey}
						placeholder="请在此粘贴您的许可证密钥..."
						class="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
						disabled={!$canAccess('settings', 'edit')}
					></textarea>
				</div>

				<div class="pt-2 border-t">
					<p class="text-xs text-muted-foreground mb-2">当前主机名 (用于许可证验证)</p>
					<code class="text-xs bg-muted px-2 py-1 rounded">{licenseInfo?.hostname || '未知'}</code>
				</div>

				{#if $canAccess('settings', 'edit')}
				<div class="flex justify-end">
					<Button onclick={activateLicense} disabled={licenseFormSaving}>
						{#if licenseFormSaving}
							<RefreshCw class="w-4 h-4 mr-1 animate-spin" />
						{:else}
							<ShieldCheck class="w-4 h-4" />
						{/if}
						激活许可证
					</Button>
				</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
