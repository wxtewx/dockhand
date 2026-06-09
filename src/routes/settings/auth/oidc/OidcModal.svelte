<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tabs from '$lib/components/ui/tabs';
	import * as Select from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { LogIn, Pencil, Plus, Check, RefreshCw, Crown, Key, Shield, Trash2, TriangleAlert } from 'lucide-svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { focusFirstInput } from '$lib/utils';
	import { getLabelText } from '$lib/types'

	export interface OidcConfig {
		id: number;
		name: string;
		enabled: boolean;
		issuerUrl: string;
		clientId: string;
		clientSecret: string;
		redirectUri: string;
		scopes: string;
		usernameClaim: string;
		emailClaim: string;
		displayNameClaim: string;
		adminClaim?: string;
		adminValue?: string;
		roleMappingsClaim?: string;
		roleMappings?: { claimValue: string; roleId: number }[];
	}

	export interface Role {
		id: number;
		name: string;
		description?: string;
		isSystem: boolean;
		permissions: any;
		createdAt: string;
	}

	interface Props {
		open: boolean;
		oidc?: OidcConfig | null;
		roles: Role[];
		isEnterprise: boolean;
		onClose: () => void;
		onSaved: () => void;
		onNavigateToLicense?: () => void;
	}

	let { open = $bindable(), oidc = null, roles, isEnterprise, onClose, onSaved, onNavigateToLicense }: Props = $props();

	const isEditing = $derived(oidc !== null);

	// Form state
	let formName = $state('');
	let formEnabled = $state(false);
	let formIssuerUrl = $state('');
	let formClientId = $state('');
	let formClientSecret = $state('');
	let formRedirectUri = $state('');
	let formScopes = $state('openid profile email');
	let formUsernameClaim = $state('preferred_username');
	let formEmailClaim = $state('email');
	let formDisplayNameClaim = $state('name');
	let formAdminClaim = $state('');
	let formAdminValue = $state('');
	let formRoleMappingsClaim = $state('groups');
	let formRoleMappings = $state<{ claim_value: string; role_id: number }[]>([]);
	let formActiveTab = $state('general');
	let formError = $state('');
	let formErrors = $state<{ name?: string; issuerUrl?: string; clientId?: string; clientSecret?: string; redirectUri?: string }>({});
	let formSaving = $state(false);

	function resetForm() {
		formName = '';
		formEnabled = false;
		formIssuerUrl = '';
		formClientId = '';
		formClientSecret = '';
		formRedirectUri = typeof window !== 'undefined' ? `${window.location.origin}/api/auth/oidc/callback` : '';
		formScopes = 'openid profile email';
		formUsernameClaim = 'preferred_username';
		formEmailClaim = 'email';
		formDisplayNameClaim = 'name';
		formAdminClaim = '';
		formAdminValue = '';
		formRoleMappingsClaim = 'groups';
		formRoleMappings = [];
		formActiveTab = 'general';
		formError = '';
		formErrors = {};
		formSaving = false;
	}

	// Initialize form when oidc changes or modal opens
	$effect(() => {
		if (open) {
			if (oidc) {
				formName = oidc.name;
				formEnabled = oidc.enabled;
				formIssuerUrl = oidc.issuerUrl;
				formClientId = oidc.clientId;
				formClientSecret = oidc.clientSecret;
				formRedirectUri = oidc.redirectUri;
				formScopes = oidc.scopes || 'openid profile email';
				formUsernameClaim = oidc.usernameClaim || 'preferred_username';
				formEmailClaim = oidc.emailClaim || 'email';
				formDisplayNameClaim = oidc.displayNameClaim || 'name';
				formAdminClaim = oidc.adminClaim || '';
				formAdminValue = oidc.adminValue || '';
				formRoleMappingsClaim = oidc.roleMappingsClaim || 'groups';
				formRoleMappings = oidc.roleMappings ? oidc.roleMappings.map(m => ({ claim_value: m.claimValue, role_id: m.roleId })) : [];
				formActiveTab = 'general';
				formError = '';
				formErrors = {};
				formSaving = false;
			} else {
				resetForm();
			}
		}
	});

	async function save() {
		formErrors = {};
		let hasErrors = false;

		if (!formName.trim()) {
			formErrors.name = '名称为必填项';
			hasErrors = true;
		}
		if (!formIssuerUrl.trim()) {
			formErrors.issuerUrl = '发行方 URL 为必填项';
			hasErrors = true;
		}
		if (!formClientId.trim()) {
			formErrors.clientId = '客户端 ID 为必填项';
			hasErrors = true;
		}
		if (!isEditing && !formClientSecret.trim()) {
			formErrors.clientSecret = '客户端密钥为必填项';
			hasErrors = true;
		}
		if (!formRedirectUri.trim()) {
			formErrors.redirectUri = '重定向 URI 为必填项';
			hasErrors = true;
		}

		if (hasErrors) return;

		formSaving = true;
		formError = '';

		try {
			const url = isEditing ? `/api/auth/oidc/${oidc!.id}` : '/api/auth/oidc';
			const method = isEditing ? 'PUT' : 'POST';

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: formName.trim(),
					enabled: formEnabled,
					issuerUrl: formIssuerUrl.trim(),
					clientId: formClientId.trim(),
					clientSecret: formClientSecret.trim(),
					redirectUri: formRedirectUri.trim(),
					scopes: formScopes.trim() || 'openid profile email',
					usernameClaim: formUsernameClaim.trim() || 'preferred_username',
					emailClaim: formEmailClaim.trim() || 'email',
					displayNameClaim: formDisplayNameClaim.trim() || 'name',
					adminClaim: formAdminClaim.trim() || undefined,
					adminValue: formAdminValue.trim() || undefined,
					roleMappings: formRoleMappings.length > 0 ? formRoleMappings.map(m => ({ claimValue: m.claim_value, roleId: m.role_id })) : undefined
				})
			});

			if (response.ok) {
				open = false;
				onSaved();
			} else {
				const data = await response.json();
				formError = data.error || `${isEditing ? '更新' : '创建'} OIDC 配置失败`;
			}
		} catch {
			formError = `${isEditing ? '更新' : '创建'} OIDC 配置失败`;
		} finally {
			formSaving = false;
		}
	}

	function handleClose() {
		open = false;
		onClose();
	}

	function addRoleMapping() {
		formRoleMappings = [...formRoleMappings, { claim_value: '', role_id: 0 }];
	}

	function removeRoleMapping(index: number) {
		formRoleMappings = formRoleMappings.filter((_, i) => i !== index);
	}

	function updateRoleMappingRole(index: number, roleId: number) {
		formRoleMappings[index].role_id = roleId;
		formRoleMappings = [...formRoleMappings];
	}
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (o) { formError = ''; formErrors = {}; focusFirstInput(); } }}>
	<Dialog.Content class="max-w-2xl h-[80vh] flex flex-col overflow-hidden">
		<Dialog.Header class="flex-shrink-0">
			<Dialog.Title class="flex items-center gap-2">
				{#if isEditing}
					<Pencil class="w-5 h-5" />
					编辑 OIDC 身份提供商
				{:else}
					<LogIn class="w-5 h-5" />
					添加 OIDC 身份提供商
				{/if}
			</Dialog.Title>
		</Dialog.Header>

		<Tabs.Root bind:value={formActiveTab} class="flex-1 flex flex-col overflow-hidden">
			<Tabs.List class="flex-shrink-0 grid w-full grid-cols-2">
				<Tabs.Trigger value="general">常规设置</Tabs.Trigger>
				<Tabs.Trigger value="role-mapping" class="flex items-center gap-1.5">
					<Crown class="w-3.5 h-3.5 text-amber-500" />
					角色映射
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="general" class="flex-1 overflow-y-auto space-y-4 py-2 mt-0">
				{#if formError}
					<Alert.Root variant="destructive">
						<TriangleAlert class="h-4 w-4" />
						<Alert.Description>{formError}</Alert.Description>
					</Alert.Root>
				{/if}

				<!-- Basic Settings -->
				<div class="space-y-4">
					<h4 class="text-sm font-medium text-muted-foreground">基础设置</h4>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label>名称 <span class="text-destructive">*</span></Label>
							<Input
								bind:value={formName}
								placeholder="Okta, Auth0, Azure AD..."
								class={formErrors.name ? 'border-destructive focus-visible:ring-destructive' : ''}
								oninput={() => formErrors.name = undefined}
							/>
							{#if formErrors.name}
								<p class="text-xs text-destructive">{formErrors.name}</p>
							{/if}
						</div>
						<div class="space-y-2">
							<Label>发行方 URL <span class="text-destructive">*</span></Label>
							<Input
								bind:value={formIssuerUrl}
								placeholder="https://example.okta.com"
								class={formErrors.issuerUrl ? 'border-destructive focus-visible:ring-destructive' : ''}
								oninput={() => formErrors.issuerUrl = undefined}
							/>
							{#if formErrors.issuerUrl}
								<p class="text-xs text-destructive">{formErrors.issuerUrl}</p>
							{/if}
						</div>
					</div>
					<div class="flex items-center gap-2">
						<Checkbox
							checked={formEnabled}
							onCheckedChange={(checked) => formEnabled = checked === true}
						/>
						<Label class="text-sm font-normal cursor-pointer" onclick={() => formEnabled = !formEnabled}>
							启用该 OIDC 身份提供商
						</Label>
					</div>
				</div>

				<!-- Client Credentials -->
				<div class="space-y-4">
					<h4 class="text-sm font-medium text-muted-foreground">客户端凭据</h4>
					<p class="text-xs text-muted-foreground">从您的身份提供商应用设置中获取这些信息。</p>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label>客户端 ID <span class="text-destructive">*</span></Label>
							<Input
								bind:value={formClientId}
								placeholder="your-client-id"
								class={formErrors.clientId ? 'border-destructive focus-visible:ring-destructive' : ''}
								oninput={() => formErrors.clientId = undefined}
							/>
							{#if formErrors.clientId}
								<p class="text-xs text-destructive">{formErrors.clientId}</p>
							{/if}
						</div>
						<div class="space-y-2">
							<Label>客户端密钥 {#if !isEditing}<span class="text-destructive">*</span>{/if}</Label>
							<Input
								type="password"
								bind:value={formClientSecret}
								placeholder={isEditing ? '留空保持现有密码' : 'your-client-secret'}
								class={formErrors.clientSecret ? 'border-destructive focus-visible:ring-destructive' : ''}
								oninput={() => formErrors.clientSecret = undefined}
							/>
							{#if formErrors.clientSecret}
								<p class="text-xs text-destructive">{formErrors.clientSecret}</p>
							{/if}
						</div>
					</div>
				</div>

				<!-- Redirect & Scopes -->
				<div class="space-y-4">
					<h4 class="text-sm font-medium text-muted-foreground">重定向设置</h4>
					<div class="space-y-2">
						<Label>重定向 URI <span class="text-destructive">*</span></Label>
						<Input
							bind:value={formRedirectUri}
							placeholder="https://dockhand.example.com/api/auth/oidc/callback"
							class={formErrors.redirectUri ? 'border-destructive focus-visible:ring-destructive' : ''}
							oninput={() => formErrors.redirectUri = undefined}
						/>
						{#if formErrors.redirectUri}
							<p class="text-xs text-destructive">{formErrors.redirectUri}</p>
						{:else}
							<p class="text-xs text-muted-foreground">将此 URI 添加到您身份提供商的允许回调 URL 列表中。</p>
						{/if}
					</div>
					<div class="space-y-2">
						<Label>权限范围</Label>
						<Input
							bind:value={formScopes}
							placeholder="OpenID 权限范围 (个人资料、邮箱)"
						/>
					</div>
				</div>

				<!-- Claim Mapping -->
				<div class="space-y-4">
					<h4 class="text-sm font-medium text-muted-foreground">声明映射</h4>
					<p class="text-xs text-muted-foreground">将 OIDC 声明映射到用户属性。</p>
					<div class="grid grid-cols-3 gap-4">
						<div class="space-y-2">
							<Label>用户名字段</Label>
							<Input
								bind:value={formUsernameClaim}
								placeholder="preferred_username"
							/>
						</div>
						<div class="space-y-2">
							<Label>邮箱字段</Label>
							<Input
								bind:value={formEmailClaim}
								placeholder="邮箱"
							/>
						</div>
						<div class="space-y-2">
							<Label>显示名称字段</Label>
							<Input
								bind:value={formDisplayNameClaim}
								placeholder="名称"
							/>
						</div>
					</div>
				</div>
			</Tabs.Content>

			<Tabs.Content value="role-mapping" class="flex-1 overflow-y-auto space-y-4 py-2 mt-0">
				{#if !isEnterprise}
					<!-- Enterprise Feature Notice (no license) -->
					<div class="flex-1 flex items-center justify-center py-8">
						<div class="text-center">
							<h3 class="text-lg font-medium mb-2 flex items-center justify-center gap-2">
								<Crown class="w-5 h-5 text-amber-500" />
								企业版功能
							</h3>
							<p class="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
								角色映射允许您根据身份提供商的用户组或声明自动分配系统角色，此功能需要企业版许可证。
							</p>
							{#if onNavigateToLicense}
								<Button onclick={() => { open = false; onNavigateToLicense?.(); }}>
									<Key class="w-4 h-4" />
									激活许可证
								</Button>
							{/if}
						</div>
					</div>
				{:else}
					<!-- Admin Mapping (Simple) -->
					<div class="space-y-4">
						<h4 class="text-sm font-medium text-muted-foreground">用户组/角色声明</h4>
						<p class="text-xs text-muted-foreground">根据身份提供商的声明值授予管理员权限。</p>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label>声明名称</Label>
								<Input
									bind:value={formAdminClaim}
									placeholder="groups, roles, etc."
								/>
								<p class="text-xs text-muted-foreground">包含角色/用户组的声明名称</p>
							</div>
							<div class="space-y-2">
								<Label>管理员值</Label>
								<Input
									bind:value={formAdminValue}
									placeholder="admin, Administrators"
								/>
								<p class="text-xs text-muted-foreground">授予管理员角色的逗号分隔值</p>
							</div>
						</div>
					</div>

					<!-- Role Mappings Grid -->
					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<div>
								<h4 class="text-sm font-medium text-muted-foreground">声明到角色的映射</h4>
								<p class="text-xs text-muted-foreground mt-0.5">将身份提供商的声明值映射到系统角色。</p>
							</div>
							<Button
								size="sm"
								variant="outline"
								onclick={addRoleMapping}
							>
								<Plus class="w-4 h-4" />
								添加映射
							</Button>
						</div>

						{#if formRoleMappings.length === 0}
							<div class="text-center py-6 text-muted-foreground text-sm border border-dashed rounded-lg">
								未配置任何角色映射，点击 “添加映射” 创建。
							</div>
						{:else}
							<div class="space-y-2">
								{#each formRoleMappings as mapping, index}
									<div class="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
										<div class="flex-1 grid grid-cols-2 gap-3">
											<div class="space-y-1">
												<Label class="text-xs">声明值</Label>
												<Input
													bind:value={mapping.claim_value}
													placeholder="例如：developers, admins"
													class="h-8"
												/>
											</div>
											<div class="space-y-1">
												<Label class="text-xs">系统角色</Label>
												<Select.Root
													type="single"
													value={mapping.role_id ? String(mapping.role_id) : undefined}
													onValueChange={(value) => {
														if (value) {
															updateRoleMappingRole(index, parseInt(value));
														}
													}}
												>
													<Select.Trigger class="h-8">
														{#if mapping.role_id}
															{roles.find(r => r.id === mapping.role_id)?.name || '选择角色...'}
														{:else}
															选择角色...
														{/if}
													</Select.Trigger>
													<Select.Content>
														{#each roles as role}
															<Select.Item value={String(role.id)}>
																<div class="flex items-center gap-2">
																	<Shield class="w-3.5 h-3.5 text-muted-foreground" />
																	{getLabelText(role.name)}
																</div>
															</Select.Item>
														{/each}
													</Select.Content>
												</Select.Root>
											</div>
										</div>
										<Button
											size="sm"
											variant="ghost"
											class="text-destructive hover:text-destructive h-8 w-8 p-0"
											onclick={() => removeRoleMapping(index)}
										>
											<Trash2 class="w-4 h-4" />
										</Button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</Tabs.Content>
		</Tabs.Root>

		<Dialog.Footer class="flex-shrink-0 border-t pt-4">
			<Button variant="outline" onclick={handleClose}>取消</Button>
			<Button onclick={save} disabled={formSaving}>
				{#if formSaving}
					<RefreshCw class="w-4 h-4 mr-1 animate-spin" />
				{:else if isEditing}
					<Check class="w-4 h-4" />
				{:else}
					<Plus class="w-4 h-4" />
				{/if}
				{isEditing ? '保存' : '添加提供商'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
