<script lang='ts' module>
	export interface SecretProvider {
		id: number;
		type: string;
		name: string;
		createdAt: string;
		updatedAt?: string;
	}

	interface ProviderField {
		key: string;
		label: string;
		type: 'text' | 'password';
		required: boolean;
		/** When present, overrides `required` based on the current form values (e.g. a
		 *  field that is only required for some auth shapes). */
		requiredWhen?: (config: Record<string, string>) => boolean;
		placeholder?: string;
		hint?: string;
	}

	// Selectable provider types + their labels. Mirrors the registered providers
	// in src/lib/server/secretproviders (index.ts / shared.ts).
	export const PROVIDER_TYPES: { value: string; label: string }[] = [
		{ value: 'op-service-account', label: '1Password 服务账号' },
		{ value: 'op-connect', label: '1Password Connect' },
		{ value: 'infisical', label: 'Infisical' },
		{ value: 'vault', label: 'HashiCorp Vault' },
		{ value: 'doppler', label: 'Doppler' },
		{ value: 'bitwarden', label: 'Bitwarden Secrets Manager' },
		{ value: 'proton', label: 'Proton Pass' },
	];

	// Config fields per provider type, matching the config shapes in
	// secretproviders/shared.ts. Non-required fields are optional overrides.
	export const PROVIDER_FIELDS: Record<string, ProviderField[]> = {
		'op-service-account': [
			{ key: 'token', label: '服务账号令牌', type: 'password', required: true, placeholder: 'ops_eyJ...', hint: '1Password 服务账号令牌(以 ops_ 开头)。' },
		],
		'op-connect': [
			{ key: 'host', label: 'Connect 主机地址', type: 'text', required: true, placeholder: 'https://connect.example.com', hint: '你的 1Password Connect 服务器地址。' },
			{ key: 'token', label: 'Connect 令牌', type: 'password', required: true, placeholder: 'eyJ...', hint: '具备保险箱读取权限的 Connect 访问令牌。' },
		],
		infisical: [
			{ key: 'host', label: 'API 主机地址', type: 'text', required: true, placeholder: 'https://app.infisical.com', hint: 'Infisical Cloud 或你的自建服务地址。' },
			{ key: 'token', label: '访问令牌', type: 'password', required: false, placeholder: 'st...', hint: '静态服务/访问令牌。留空则使用下方的 Universal Auth(客户端ID + 密钥)。' },
			{ key: 'clientId', label: 'Universal Auth 客户端ID', type: 'text', required: false, placeholder: 'machine identity client id', hint: '机器身份客户端ID。与客户端密钥配对使用；使用静态令牌时请留空。' },
			{ key: 'clientSecret', label: 'Universal Auth 客户端密钥', type: 'password', required: false, placeholder: 'machine identity client secret', hint: '机器身份客户端密钥。通过 Universal Auth 换取短期令牌。' },
			// A single‑scope service token (st.*) carries its own project + environment, so
			// both are optional for it. A multi‑scope or glob‑path service token, and every
			// other auth shape (Universal Auth, static non‑st token), still need them.
			{ key: 'projectId', label: '项目ID', type: 'text', required: true, requiredWhen: (c) => !(c.token ?? '').trim().startsWith('st.'), placeholder: 'workspace / project id', hint: '密钥所在的工作空间/项目。单作用域服务令牌 (st.) 为可选项，该类令牌已绑定指定项目；多作用域令牌仍需要填写此项。' },
			{ key: 'environment', label: '环境', type: 'text', required: true, requiredWhen: (c) => !(c.token ?? '').trim().startsWith('st.'), placeholder: 'prod', hint: '环境标识，例如：prod / staging。单作用域服务令牌 (st.) 为可选项。' },
			{ key: 'path', label: '密钥路径', type: 'text', required: false, placeholder: '/', hint: '项目内的文件夹路径。默认为 /。' },
		],
		vault: [
			{ key: 'address', label: 'Vault 地址', type: 'text', required: true, placeholder: 'https://vault.example.com', hint: 'Vault 服务器基础地址。' },
			{ key: 'token', label: 'Vault 令牌', type: 'password', required: true, placeholder: 'hvs...', hint: '拥有 KV 路径读取权限的令牌。' },
			{ key: 'namespace', label: '命名空间', type: 'text', required: false, placeholder: 'admin (Enterprise / HCP)', hint: '仅 Vault Enterprise / HCP 可用。' },
			{ key: 'mount', label: 'KV 挂载点', type: 'text', required: false, placeholder: 'secret', hint: 'KV v2 挂载路径，默认为 "secret"。' },
		],
		doppler: [
			{ key: 'token', label: '令牌', type: 'password', required: true, placeholder: 'dp.st.... or dp.pt....', hint: '服务令牌 (dp.st.) 已绑定配置。个人令牌 (dp.pt.) 还需要填写下方项目与配置。' },
			{ key: 'project', label: '项目', type: 'text', required: false, placeholder: '仅用于个人令牌 (dp.pt.)', hint: 'Doppler 项目标识，仅个人令牌需要填写。' },
			{ key: 'config', label: '配置', type: 'text', required: false, placeholder: '例如：prd', hint: '项目内的配置，仅个人令牌需要填写。' },
		],
		bitwarden: [
			{ key: 'token', label: '机器账户访问令牌', type: 'password', required: true, placeholder: '机器账户访问令牌', hint: 'Bitwarden Secrets Manager 机器账户令牌，需拥有项目的读取权限。' },
			{ key: 'serverUrl', label: '服务端地址', type: 'text', required: false, placeholder: 'https://vault.bitwarden.com', hint: '适用于欧盟区域或自建 Bitwarden，Bitwarden 美国云服务可留空。' },
		],
		proton: [
			{ key: 'token', label: '个人访问令牌', type: 'password', required: true, placeholder: 'pst_...::...', hint: 'Proton Pass 个人访问令牌(pst_...)，由已部署的 pass‑cli 调用。' },
		],
	};

	export function providerTypeLabel(type: string): string {
		return PROVIDER_TYPES.find((t) => t.value === type)?.label ?? type;
	}

	// Per-stack bulk-selector field metadata (UI-only, like PROVIDER_FIELDS above).
	// A provider type with no entry shows no selector field: doppler ignores the
	// selector, connect has no bulk pull. The field's value is written to the stack
	// env as DOCKHAND_SECRET_SELECTOR (consumed by resolveProviderEnvVars).
	export type BulkSelectorField = { label: string; placeholder?: string; hint?: string };
	export const BULK_SELECTOR_FIELDS: Record<string, BulkSelectorField> = {
		'op-service-account': {
			label: '环境',
			placeholder: '1Password 环境 id',
			hint: '批量加载该 1Password 环境下全部密钥。留空则仅使用行内 op:// 引用。'
		},
		'vault': {
			label: 'KV v2 路径',
			placeholder: 'path/to/secret',
			hint: '批量加载该 KV v2 路径下的全部键 (基于已配置挂载点)。'
		},
		'infisical': {
			label: '密钥路径',
			placeholder: '/',
			hint: '批量加载该路径下全部密钥 (项目与环境取自提供商配置)。'
		},
		'bitwarden': {
			label: '项目',
			placeholder: 'Bitwarden Project UUID',
			hint: '批量加载该 Bitwarden Secrets Manager 项目下的全部密钥。'
		},
		'proton': {
			label: '密码库',
			placeholder: 'Proton Pass vault name',
			hint: '批量加载该 Proton Pass 密码库内的全部条目。留空则仅注入内联 pass:// 引用。'
		}
	};
</script>

<script lang='ts'>
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { FieldLabel } from '$lib/components/ui/field-label';
	import { Input } from '$lib/components/ui/input';
	import { Plus, Check, RefreshCw, PlugZap, KeyRound, Info } from 'lucide-svelte';
	import { scale } from 'svelte/transition';
	import { backOut, cubicIn } from 'svelte/easing';
	import { getProviderIcon } from '$lib/components/provider-icons';
	import { toast } from 'svelte-sonner';
	import { focusFirstInput } from '$lib/utils';

	interface Props {
		open: boolean;
		provider?: SecretProvider | null;
		onClose: () => void;
		onSaved: () => void;
	}

	let {
		open = $bindable(),
		provider = null,
		onClose,
		onSaved,
	}: Props = $props();

	const isEditing = $derived(provider !== null);

	let formName = $state('');
	let formType = $state('op-service-account');
	// One value per config field; blank means 'unset' (on edit: keep existing).
	let formConfig = $state<Record<string, string>>({});
	let formError = $state('');
	let formSaving = $state(false);
	let formTesting = $state(false);
	// Brief green tick on the Test connection button right after a successful test.
	let testOk = $state(false);
	let testOkTimer: ReturnType<typeof setTimeout> | undefined;

	const fields = $derived(PROVIDER_FIELDS[formType] ?? []);
	// Providers whose config fields read better stacked one per row rather than in the
	// 2-column grid (per-field hints, or fields long enough to want full width).
	const stackConfigFields = $derived(
		formType === 'op-connect' || formType === 'doppler'
	);

	function resetConfig() {
		formConfig = {};
	}

	function resetForm() {
		formName = '';
		formType = 'op-service-account';
		resetConfig();
		formError = '';
		formSaving = false;
		formTesting = false;
	}

	$effect(() => {
		if (open) {
			if (provider) {
				formName = provider.name;
				formType = provider.type;
				resetConfig();
				formError = '';
				// Pre-fill the NON-secret config fields (host, projectId, mount, ...) from
				// the server; the token stays blank ('keep existing'). The list only has a
				// summary, so fetch the single provider which returns the redacted config.
				void loadProviderConfig(provider.id);
			} else {
				resetForm();
			}
		}
	});

	async function loadProviderConfig(id: number) {
		try {
			const res = await fetch(`/api/secret-providers/${id}`);
			if (!res.ok) return;
			const data = await res.json();
			const cfg = (data?.config ?? {}) as Record<string, unknown>;
			const next: Record<string, string> = {};
			for (const [key, value] of Object.entries(cfg)) {
				if (value != null) next[key] = String(value);
			}
			formConfig = next; // secret fields (token) are absent -> stay blank
		} catch {
			// leave fields blank on failure - the user can re-enter them
		}
	}

	// A blank secret field on edit means "keep the stored value"; non-secret fields are
	// pre-filled (loadProviderConfig). Collect only the fields the user actually filled.
	function collectConfig(): Record<string, string> {
		const config: Record<string, string> = {};
		for (const field of fields) {
			const value = (formConfig[field.key] ?? '').trim();
			if (value) config[field.key] = value;
		}
		return config;
	}

	function fieldRequired(field: ProviderField, config: Record<string, string>): boolean {
		return field.requiredWhen ? field.requiredWhen(config) : field.required;
	}

	function missingRequired(config: Record<string, string>, editing = false): string | null {
		for (const field of fields) {
			// On edit a blank secret (password) field keeps the stored value, so it is
			// allowed to be empty; non-secret required fields still must be present.
			if (editing && field.type === 'password') continue;
			if (fieldRequired(field, config) && !config[field.key]) {
				return `${field.label} 为必填项`;
			}
		}
		return null;
	}

	function onTypeChange(value: string) {
		formType = value;
		// Fields differ per type; drop any stale values.
		resetConfig();
		formError = '';
	}

	async function testCurrent() {
		formTesting = true;
		formError = '';
		try {
			const config = collectConfig();
			const missing = missingRequired(config, isEditing);
			if (missing) {
				formError = missing;
				return;
			}

			let response: Response;
			if (isEditing) {
				// Test EXACTLY what a Save would persist: the typed non-secret fields, merged
				// server-side over the stored config (a blank token keeps the stored one). This
				// makes an edited address/mount/namespace actually get tested - not the old
				// stored config.
				response = await fetch(`/api/secret-providers/${provider!.id}/test`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ config }),
				});
			} else {
				response = await fetch('/api/secret-providers/test', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ type: formType, config }),
				});
			}
			const data = await response.json();
			if (data.ok) {
				toast.success('连接正常');
				clearTimeout(testOkTimer);
				testOk = true;
				testOkTimer = setTimeout(() => (testOk = false), 2000);
			} else {
				toast.error(data.error || '连接失败');
				formError = data.error || '连接失败';
			}
		} catch {
			toast.error('连接测试失败');
		} finally {
			formTesting = false;
		}
	}

	async function save() {
		if (!formName.trim()) {
			formError = '名称为必填项';
			return;
		}

		const config = collectConfig();

		// On create, every required field must be present. On EDIT, a blank SECRET
		// field (token) means "keep the stored value", so a required secret is allowed
		// to be blank; non-secret required fields (host, projectId, ...) are pre-filled
		// and still validated. The backend merges the stored secret over the blank.
		const missing = missingRequired(config, isEditing);
		if (missing) {
			formError = missing;
			return;
		}

		formSaving = true;
		formError = '';

		try {
			const body: Record<string, unknown> = {
				name: formName.trim(),
				type: formType,
				// Always send config; on edit the backend keeps the stored secret when a
				// secret field is blank (updateSecretProvider merges), and the non-secret
				// fields are pre-filled, so `config` is the full intended coordinates.
				config,
			};

			const url = isEditing
				? `/api/secret-providers/${provider!.id}`
				: '/api/secret-providers';
			const method = isEditing ? 'PUT' : 'POST';

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			if (response.ok) {
				open = false;
				onSaved();
			} else {
				const data = await response.json();
				formError =
					data.error ||
					`${isEditing ? '更新' : '创建'} 密钥提供程序失败`;
			}
		} catch {
			formError = `${isEditing ? '更新' : '创建'} 密钥提供程序失败`;
		} finally {
			formSaving = false;
		}
	}

	function handleClose() {
		clearTimeout(testOkTimer);
		testOk = false;
		open = false;
		onClose();
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(o) => {
		if (o) {
			formError = "";
			focusFirstInput();
		}
	}}
>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<KeyRound class="w-5 h-5 text-muted-foreground" />
				{isEditing ? "编辑" : "添加"} 密钥提供程序
			</Dialog.Title>
		</Dialog.Header>
		<div class="space-y-4">
			{#if formError}
				<div class="text-sm text-red-600 dark:text-red-400">
					{formError}
				</div>
			{/if}
			<div class="space-y-2">
				<FieldLabel label="名称" forId="provider-name" required showOptional={false} />
				<Input
					id="provider-name"
					bind:value={formName}
					placeholder="生产环境密钥"
				/>
			</div>
			<div class="space-y-2">
				<FieldLabel label="提供程序" forId="provider-type" required showOptional={false} />
				<Select.Root
					type="single"
					value={formType}
					onValueChange={onTypeChange}
					disabled={isEditing}
				>
					<Select.Trigger id="provider-type" class="w-full justify-between gap-2">
						{@const TriggerIcon = getProviderIcon(formType)}
						<span class="flex items-center gap-2 min-w-0">
							<TriggerIcon class="w-4 h-4 shrink-0 text-muted-foreground" />
							<span class="truncate">{providerTypeLabel(formType)}</span>
						</span>
					</Select.Trigger>
					<Select.Content>
						{#each PROVIDER_TYPES as t (t.value)}
							{@const ItemIcon = getProviderIcon(t.value)}
							<Select.Item value={t.value} label={t.label}>
								<span class="flex items-center gap-2">
									<ItemIcon class="w-4 h-4 shrink-0 text-muted-foreground" />
									{t.label}
								</span>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<!-- Provider config fields: a 2-column grid, or one per row for providers whose
			     fields read better stacked (Vault, Connect, Doppler). min-height +
			     content-start keep the dialog a stable height while laying rows top-aligned. -->
			<div class="grid {stackConfigFields ? 'grid-cols-1' : 'grid-cols-2'} gap-x-4 gap-y-3 content-start" style="min-height: 21rem;">
				{#each fields as field (field.key)}
					<div class="space-y-1.5 self-start {fields.length === 1 ? 'col-span-full' : ''}">
						<FieldLabel label={field.label} forId={`provider-${field.key}`} required={fieldRequired(field, formConfig)} />
						<Input
							id={`provider-${field.key}`}
							type={field.type}
							bind:value={formConfig[field.key]}
							placeholder={isEditing && field.type === "password"
								? "留空保留原有值"
								: field.placeholder}
						/>
						{#if field.hint}
							<p class="text-xs text-muted-foreground">{field.hint}</p>
						{/if}
					</div>
				{/each}
			</div>
			{#if formType === 'bitwarden' || formType === 'proton'}
				<!-- Fixed min-height so switching between the bitwarden (shorter) and proton
				     (taller) external-CLI notes doesn't jump the dialog's vertical size. -->
				<div class="min-h-16">
					{#if formType === 'bitwarden'}
						<p class="flex items-start gap-2 text-xs text-muted-foreground">
							<Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
							<span>
								Bitwarden Secrets Manager 需要外部安装或挂载官方
								<code>bws</code> 客户端至 <code>/usr/local/bin/bws</code> (或通过环境变量
								<code>DOCKHAND_BWS_PATH</code> 指定绝对路径覆盖)。
							</span>
						</p>
					{:else}
						<p class="flex items-start gap-2 text-xs text-muted-foreground">
							<Info class="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" />
							<span>
								Proton Pass 需要外部安装或挂载官方
								<code>pass-cli</code> 客户端至 <code>/usr/local/bin/pass-cli</code> (或通过环境变量
								<code>DOCKHAND_PASS_CLI_PATH</code> 指定绝对路径覆盖)。 支持密码库批量拉取
								以及内联 <code>pass://</code> 引用。
							</span>
						</p>
					{/if}
				</div>
			{/if}
			<p class="text-xs text-muted-foreground">
				配置将加密存储。{#if isEditing}
					密钥字段留空将保留原有数值。{/if}
			</p>
		</div>
		<Dialog.Footer>
			<Button
				variant="outline"
				onclick={testCurrent}
				disabled={formTesting || formSaving}
				class={`transition-colors duration-300 ${testOk ? 'border-green-500/60 text-green-600 dark:text-green-400' : ''}`}
			>
				<span class="inline-flex w-4 h-4 mr-1 items-center justify-center shrink-0">
					{#if formTesting}
						<RefreshCw class="w-4 h-4 animate-spin" />
					{:else if testOk}
						<span in:scale={{ duration: 260, start: 0.4, easing: backOut }} out:scale={{ duration: 150, start: 0.6, easing: cubicIn }}>
							<Check class="w-4 h-4 text-green-600 dark:text-green-400" />
						</span>
					{:else}
						<PlugZap class="w-4 h-4" />
					{/if}
				</span>
				测试连接
			</Button>
			<div class="flex-1"></div>
			<Button variant="outline" onclick={handleClose}>取消</Button>
			<Button onclick={save} disabled={formSaving}>
				{#if formSaving}
					<RefreshCw class="w-4 h-4 mr-1 animate-spin" />
				{:else if isEditing}
					<Check class="w-4 h-4" />
				{:else}
					<Plus class="w-4 h-4" />
				{/if}
				{isEditing ? "保存" : "添加"}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
