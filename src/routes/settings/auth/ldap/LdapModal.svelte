<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Select from '$lib/components/ui/select';
	import { Network, Pencil, Plus, Check, RefreshCw, TriangleAlert, Trash2, Star } from 'lucide-svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { focusFirstInput } from '$lib/utils';

	export interface LdapRoleMapping {
		groupDn: string;
		roleId: number;
	}

	export interface LdapConfig {
		id: number;
		name: string;
		enabled: boolean;
		serverUrl: string;
		bindDn?: string;
		bindPassword?: string;
		baseDn: string;
		userFilter: string;
		usernameAttribute: string;
		emailAttribute: string;
		displayNameAttribute: string;
		groupBaseDn?: string;
		groupFilter?: string;
		adminGroup?: string;
		roleMappings?: LdapRoleMapping[];
		tlsEnabled: boolean;
		tlsCa?: string;
	}

	interface Role {
		id: number;
		name: string;
		isSystem: boolean;
	}

	interface Props {
		open: boolean;
		ldap?: LdapConfig | null;
		roles?: Role[];
		isEnterprise?: boolean;
		onClose: () => void;
		onSaved: () => void;
	}

	let { open = $bindable(), ldap = null, roles = [], isEnterprise = false, onClose, onSaved }: Props = $props();

	const isEditing = $derived(ldap !== null);

	// Form state
	let formName = $state('');
	let formEnabled = $state(false);
	let formServerUrl = $state('');
	let formBindDn = $state('');
	let formBindPassword = $state('');
	let formBaseDn = $state('');
	let formUserFilter = $state('(uid={{username}})');
	let formUsernameAttr = $state('uid');
	let formEmailAttr = $state('mail');
	let formDisplayNameAttr = $state('cn');
	let formGroupBaseDn = $state('');
	let formGroupFilter = $state('');
	let formAdminGroup = $state('');
	let formRoleMappings = $state<LdapRoleMapping[]>([]);
	let formTlsEnabled = $state(false);
	let formTlsCa = $state('');
	let formError = $state('');
	let formErrors = $state<{ name?: string; serverUrl?: string; baseDn?: string }>({});
	let formSaving = $state(false);
	let formModalTab = $state<'connection' | 'groups'>('connection');

	// Role mapping helpers
	function addRoleMapping() {
		formRoleMappings = [...formRoleMappings, { groupDn: '', roleId: 0 }];
	}

	function removeRoleMapping(index: number) {
		formRoleMappings = formRoleMappings.filter((_, i) => i !== index);
	}

	function updateRoleMappingRole(index: number, roleId: number) {
		formRoleMappings = formRoleMappings.map((mapping, i) =>
			i === index ? { ...mapping, roleId } : mapping
		);
	}

	function updateRoleMappingGroupDn(index: number, groupDn: string) {
		formRoleMappings = formRoleMappings.map((mapping, i) =>
			i === index ? { ...mapping, groupDn } : mapping
		);
	}

	function resetForm() {
		formName = '';
		formEnabled = false;
		formServerUrl = '';
		formBindDn = '';
		formBindPassword = '';
		formBaseDn = '';
		formUserFilter = '(uid={{username}})';
		formUsernameAttr = 'uid';
		formEmailAttr = 'mail';
		formDisplayNameAttr = 'cn';
		formGroupBaseDn = '';
		formGroupFilter = '';
		formAdminGroup = '';
		formRoleMappings = [];
		formTlsEnabled = false;
		formTlsCa = '';
		formError = '';
		formErrors = {};
		formSaving = false;
		formModalTab = 'connection';
	}

	// Initialize form when ldap changes or modal opens
	$effect(() => {
		if (open) {
			if (ldap) {
				formName = ldap.name;
				formEnabled = ldap.enabled;
				formServerUrl = ldap.serverUrl;
				formBindDn = ldap.bindDn || '';
				formBindPassword = ldap.bindPassword || '';
				formBaseDn = ldap.baseDn;
				formUserFilter = ldap.userFilter || '(uid={{username}})';
				formUsernameAttr = ldap.usernameAttribute || 'uid';
				formEmailAttr = ldap.emailAttribute || 'mail';
				formDisplayNameAttr = ldap.displayNameAttribute || 'cn';
				formGroupBaseDn = ldap.groupBaseDn || '';
				formGroupFilter = ldap.groupFilter || '';
				formAdminGroup = ldap.adminGroup || '';
				formRoleMappings = ldap.roleMappings || [];
				formTlsEnabled = ldap.tlsEnabled || false;
				formTlsCa = ldap.tlsCa || '';
				formError = '';
				formErrors = {};
				formSaving = false;
				formModalTab = 'connection';
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
		if (!formServerUrl.trim()) {
			formErrors.serverUrl = '服务器 URL 为必填项';
			hasErrors = true;
		}
		if (!formBaseDn.trim()) {
			formErrors.baseDn = '基准 DN 为必填项';
			hasErrors = true;
		}

		if (hasErrors) return;

		formSaving = true;
		formError = '';

		try {
			const url = isEditing ? `/api/auth/ldap/${ldap!.id}` : '/api/auth/ldap';
			const method = isEditing ? 'PUT' : 'POST';

			// Filter valid role mappings (both groupDn and roleId must be set)
			const validRoleMappings = formRoleMappings.filter(m => m.groupDn.trim() && m.roleId);

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: formName.trim(),
					enabled: formEnabled,
					serverUrl: formServerUrl.trim(),
					bindDn: formBindDn.trim() || undefined,
					bindPassword: formBindPassword || undefined,
					baseDn: formBaseDn.trim(),
					userFilter: formUserFilter.trim() || '(uid={{username}})',
					usernameAttribute: formUsernameAttr.trim() || 'uid',
					emailAttribute: formEmailAttr.trim() || 'mail',
					displayNameAttribute: formDisplayNameAttr.trim() || 'cn',
					groupBaseDn: formGroupBaseDn.trim() || undefined,
					groupFilter: formGroupFilter.trim() || undefined,
					adminGroup: formAdminGroup.trim() || undefined,
					roleMappings: validRoleMappings.length > 0 ? validRoleMappings : undefined,
					tlsEnabled: formTlsEnabled,
					tlsCa: formTlsCa.trim() || undefined
				})
			});

			if (response.ok) {
				open = false;
				onSaved();
			} else {
				const data = await response.json();
				formError = data.error || `${isEditing ? '更新' : '创建'} LDAP 配置失败`;
			}
		} catch {
			formError = `${isEditing ? '更新' : '创建'} LDAP 配置失败`;
		} finally {
			formSaving = false;
		}
	}

	function handleClose() {
		open = false;
		onClose();
	}
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (o) { formError = ''; formErrors = {}; formModalTab = 'connection'; focusFirstInput(); } }}>
	<Dialog.Content class="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
		<Dialog.Header class="flex-shrink-0">
			<Dialog.Title class="flex items-center gap-2">
				{#if isEditing}
					<Pencil class="w-5 h-5" />
					编辑 LDAP 配置
				{:else}
					<Network class="w-5 h-5" />
					添加 LDAP 配置
				{/if}
			</Dialog.Title>
		</Dialog.Header>
		<div class="flex-1 overflow-y-auto py-2">
			{#if formError}
				<Alert.Root variant="destructive" class="mb-4">
					<TriangleAlert class="h-4 w-4" />
					<Alert.Description>{formError}</Alert.Description>
				</Alert.Root>
			{/if}

			<Tabs.Root bind:value={formModalTab}>
				<Tabs.List class="grid w-full grid-cols-2 mb-4">
					<Tabs.Trigger value="connection">连接配置</Tabs.Trigger>
					<Tabs.Trigger value="groups">用户组设置</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="connection" class="space-y-4">
					<!-- Basic Settings -->
					<div class="space-y-4">
						<h4 class="text-sm font-medium text-muted-foreground">基础设置</h4>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label>名称 <span class="text-destructive">*</span></Label>
								<Input
									bind:value={formName}
									placeholder="企业 LDAP"
									class={formErrors.name ? 'border-destructive focus-visible:ring-destructive' : ''}
									oninput={() => formErrors.name = undefined}
								/>
								{#if formErrors.name}
									<p class="text-xs text-destructive">{formErrors.name}</p>
								{/if}
							</div>
							<div class="space-y-2">
								<Label>服务器 URL <span class="text-destructive">*</span></Label>
								<Input
									bind:value={formServerUrl}
									placeholder="ldap://ldap.example.com:389"
									class={formErrors.serverUrl ? 'border-destructive focus-visible:ring-destructive' : ''}
									oninput={() => formErrors.serverUrl = undefined}
								/>
								{#if formErrors.serverUrl}
									<p class="text-xs text-destructive">{formErrors.serverUrl}</p>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-2">
							<Checkbox
								checked={formEnabled}
								onCheckedChange={(checked) => formEnabled = checked === true}
							/>
							<Label class="text-sm font-normal cursor-pointer" onclick={() => formEnabled = !formEnabled}>
								启用该 LDAP 配置
							</Label>
						</div>
					</div>

					<!-- Bind Credentials -->
					<div class="space-y-4">
						<h4 class="text-sm font-medium text-muted-foreground">绑定凭据 (可选)</h4>
						<p class="text-xs text-muted-foreground">用于搜索用户的服务账号，留空则使用匿名绑定。</p>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label>绑定 DN</Label>
								<Input
									bind:value={formBindDn}
									placeholder="cn=admin,dc=example,dc=com"
								/>
							</div>
							<div class="space-y-2">
								<Label>绑定密码</Label>
								<Input
									type="password"
									bind:value={formBindPassword}
									placeholder={isEditing ? '留空保持现有密码' : '输入密码'}
								/>
							</div>
						</div>
					</div>

					<!-- Search Settings -->
					<div class="space-y-4">
						<h4 class="text-sm font-medium text-muted-foreground">用户搜索设置</h4>
						<div class="space-y-2">
							<Label>基准 DN <span class="text-destructive">*</span></Label>
							<Input
								bind:value={formBaseDn}
								placeholder="dc=example,dc=com"
								class={formErrors.baseDn ? 'border-destructive focus-visible:ring-destructive' : ''}
								oninput={() => formErrors.baseDn = undefined}
							/>
							{#if formErrors.baseDn}
								<p class="text-xs text-destructive">{formErrors.baseDn}</p>
							{:else}
								<p class="text-xs text-muted-foreground">搜索用户的基准 DN。</p>
							{/if}
						</div>
						<div class="space-y-2">
							<Label>用户过滤器</Label>
							<Input
								bind:value={formUserFilter}
								placeholder={`(uid={{username}})`}
							/>
							<p class="text-xs text-muted-foreground">
								用于查找用户的 LDAP 过滤器，使用 <code class="text-xs bg-muted px-1 rounded">{`{{username}}`}</code> 作为占位符。<br />
								<span class="text-muted-foreground/70">OpenLDAP: <code class="text-xs bg-muted px-1 rounded">(uid={`{{username}}`})</code> &bull; AD: <code class="text-xs bg-muted px-1 rounded">(sAMAccountName={`{{username}}`})</code></span>
							</p>
						</div>
					</div>

					<!-- Attribute Mapping -->
					<div class="space-y-4">
						<h4 class="text-sm font-medium text-muted-foreground">属性映射</h4>
						<div class="grid grid-cols-3 gap-4">
							<div class="space-y-2">
								<Label>用户名字段</Label>
								<Input
									bind:value={formUsernameAttr}
									placeholder="uid"
								/>
							</div>
							<div class="space-y-2">
								<Label>邮箱字段</Label>
								<Input
									bind:value={formEmailAttr}
									placeholder="邮箱"
								/>
							</div>
							<div class="space-y-2">
								<Label>显示名称字段</Label>
								<Input
									bind:value={formDisplayNameAttr}
									placeholder="cn"
								/>
							</div>
						</div>
					</div>

					<!-- TLS Settings -->
					<div class="space-y-4">
						<h4 class="text-sm font-medium text-muted-foreground">TLS 设置</h4>
						<div class="flex items-center gap-2">
							<Checkbox
								checked={formTlsEnabled}
								onCheckedChange={(checked) => formTlsEnabled = checked === true}
							/>
							<Label class="text-sm font-normal cursor-pointer" onclick={() => formTlsEnabled = !formTlsEnabled}>
								启用 TLS (LDAPS 或 StartTLS)
							</Label>
						</div>
						{#if formTlsEnabled}
							<div class="space-y-2">
								<Label>CA 证书 (可选)</Label>
								<textarea
									bind:value={formTlsCa}
									class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
									placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
								></textarea>
							</div>
						{/if}
					</div>
				</Tabs.Content>

				<Tabs.Content value="groups" class="space-y-4">
					<!-- Group Settings -->
					<div class="space-y-4">
						<h4 class="text-sm font-medium text-muted-foreground">用户组设置</h4>
						<p class="text-xs text-muted-foreground">>配置基于用户组的访问控制，该设置为可选。</p>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label>用户组基准 DN</Label>
								<Input
									bind:value={formGroupBaseDn}
									placeholder="ou=groups,dc=example,dc=com"
								/>
								<p class="text-xs text-muted-foreground">搜索用户组的基准 DN。</p>
							</div>
							<div class="space-y-2">
								<Label>管理员组</Label>
								<Input
									bind:value={formAdminGroup}
									placeholder="cn=admins,ou=groups,dc=example,dc=com"
								/>
								<p class="text-xs text-muted-foreground">该组内成员将被授予管理员权限。</p>
							</div>
						</div>
						<div class="space-y-2">
							<Label>成员过滤器</Label>
							<Input
								bind:value={formGroupFilter}
								placeholder={'(&(objectClass=groupOfNames)(member={{user_dn}}))'}
							/>
							<p class="text-xs text-muted-foreground">
								查找用户所属用户组的过滤器，使用 <code class="text-xs bg-muted px-1 rounded">{'{{user_dn}}'}</code> 作为占位符。
							</p>
						</div>
					</div>

					<!-- Role Mappings (Enterprise) -->
					{#if isEnterprise}
						<div class="space-y-4">
							<div class="flex items-center gap-2">
								<h4 class="text-sm font-medium text-muted-foreground">用户组到角色的映射</h4>
								<Star class="w-3.5 h-3.5 text-amber-500" />
							</div>
							<p class="text-xs text-muted-foreground">将 LDAP 用户组映射到系统角色，组内用户将自动分配对应角色。</p>

							{#if formRoleMappings.length > 0}
								<div class="space-y-2">
									{#each formRoleMappings as mapping, index}
										<div class="flex items-center gap-2">
											<Input
												value={mapping.groupDn}
												placeholder="cn=developers,ou=groups,dc=example,dc=com"
												class="flex-1"
												oninput={(e) => updateRoleMappingGroupDn(index, e.currentTarget.value)}
											/>
											<Select.Root
												type="single"
												value={mapping.roleId ? String(mapping.roleId) : undefined}
												onValueChange={(value) => updateRoleMappingRole(index, parseInt(value))}
											>
												<Select.Trigger class="w-40">
													{#if mapping.roleId}
														{@const role = roles.find(r => r.id === mapping.roleId)}
														{role?.name || '选择角色'}
													{:else}
														选择角色
													{/if}
												</Select.Trigger>
												<Select.Content>
													{#each roles.filter(r => !r.isSystem || r.name !== 'Admin') as role}
														<Select.Item value={String(role.id)}>{role.name}</Select.Item>
													{/each}
												</Select.Content>
											</Select.Root>
											<Button
												variant="ghost"
												size="icon"
												class="h-9 w-9 text-muted-foreground hover:text-destructive"
												onclick={() => removeRoleMapping(index)}
											>
												<Trash2 class="w-4 h-4" />
											</Button>
										</div>
									{/each}
								</div>
							{/if}

							<Button variant="outline" size="sm" onclick={addRoleMapping}>
								<Plus class="w-4 h-4" />
								添加映射
							</Button>
						</div>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		</div>
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
				{isEditing ? '保存' : '添加配置'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
