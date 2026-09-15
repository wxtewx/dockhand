<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import { Plus, Check, RefreshCw, Mail, Zap, Send, CheckCircle2, XCircle, Bell, HelpCircle, Settings } from 'lucide-svelte';
	import * as Tabs from '$lib/components/ui/tabs';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { toast } from 'svelte-sonner';
	import { focusFirstInput } from '$lib/utils';

	// System-only events (configured at channel level, not per-environment)
	const SYSTEM_EVENTS = [
		{ id: 'license_expiring', label: '许可证即将到期', description: '企业版许可证即将到期' },
		{ id: 'repo_prune_success', label: '备份仓库清理成功', description: '定时仓库清理任务已成功完成' },
		{ id: 'repo_prune_failed', label: '备份仓库清理失败', description: '定时仓库清理任务执行失败' },
		{ id: 'repo_check_success', label: '备份仓库检测成功', description: '定时完整性检测已成功完成' },
		{ id: 'repo_check_failed', label: '备份仓库检测失败', description: '定时完整性检测发现错误或执行失败' },
		{ id: 'repo_verify_success', label: '备份仓库数据校验成功', description: '定时数据校验已成功完成' },
		{ id: 'repo_verify_failed', label: '备份仓库数据校验失败', description: '定时数据校验检测到损坏或执行失败' }
	] as const;

	export interface NotificationSetting {
		id: number;
		name: string;
		type: 'smtp' | 'apprise';
		enabled: boolean;
		config: Record<string, any>;
		eventTypes: string[];
		createdAt: string;
	}

	interface Props {
		open: boolean;
		notification?: NotificationSetting | null;
		onClose: () => void;
		onSaved: () => void;
	}

	let { open = $bindable(), notification = null, onClose, onSaved }: Props = $props();

	const isEditing = $derived(notification !== null);

	// Form state
	let formType = $state<'smtp' | 'apprise'>('smtp');
	let formName = $state('');
	let formEnabled = $state(true);
	// SMTP specific
	let formSmtpHost = $state('');
	let formSmtpPort = $state(587);
	let formSmtpSecure = $state(false);
	let formSmtpSkipTlsVerify = $state(false);
	let formSmtpUsername = $state('');
	let formSmtpPassword = $state('');
	let formSmtpFromEmail = $state('');
	let formSmtpFromName = $state('');
	let formSmtpToEmails = $state('');
	// Apprise specific
	let formAppriseUrls = $state('');
	// System events
	let formSystemEvents = $state<string[]>([]);
	let activeTab = $state<'channel' | 'events'>('channel');
	let formError = $state('');
	let formSaving = $state(false);
	let formTesting = $state(false);
	let testResult = $state<'idle' | 'success' | 'error'>('idle');
	let initializedForId = $state<number | null>(null);

	function resetForm() {
		formType = 'smtp';
		formName = '';
		formEnabled = true;
		formSmtpHost = '';
		formSmtpPort = 587;
		formSmtpSecure = false;
		formSmtpSkipTlsVerify = false;
		formSmtpUsername = '';
		formSmtpPassword = '';
		formSmtpFromEmail = '';
		formSmtpFromName = '';
		formSmtpToEmails = '';
		formAppriseUrls = '';
		formSystemEvents = [];
		activeTab = 'channel';
		formError = '';
		formSaving = false;
		formTesting = false;
		testResult = 'idle';
	}

	// Initialize form when notification changes or modal opens
	$effect(() => {
		if (open) {
			if (notification) {
				// Only initialize if this is a different notification than before
				if (initializedForId === notification.id) return;
				initializedForId = notification.id;

				formType = notification.type;
				formName = notification.name;
				formEnabled = notification.enabled;

				if (notification.type === 'smtp') {
					formSmtpHost = notification.config.host || '';
					formSmtpPort = notification.config.port || 587;
					formSmtpSecure = notification.config.secure || false;
					formSmtpSkipTlsVerify = notification.config.skipTlsVerify || false;
					formSmtpUsername = notification.config.username || '';
					formSmtpPassword = '';
					formSmtpFromEmail = notification.config.from_email || '';
					formSmtpFromName = notification.config.from_name || '';
					formSmtpToEmails = notification.config.to_emails?.join(', ') || '';
				} else {
					formAppriseUrls = notification.config.urls?.join('\n') || '';
				}

				// Load system events (filter to only system-scoped events)
				const systemEventIds = SYSTEM_EVENTS.map(e => e.id);
				formSystemEvents = (notification.eventTypes || []).filter(e => systemEventIds.includes(e as typeof SYSTEM_EVENTS[number]['id']));
				activeTab = 'channel';

				formError = '';
				formSaving = false;
			} else {
				// New notification - only reset if we haven't already
				if (initializedForId !== -1) {
					initializedForId = -1; // Use -1 to mark "new notification" mode
					resetForm();
				}
			}
		} else {
			// Modal closed - reset the guard so next open will initialize
			initializedForId = null;
		}
	});

	function getFormConfig() {
		if (formType === 'smtp') {
			return {
				host: formSmtpHost.trim(),
				port: formSmtpPort,
				secure: formSmtpSecure,
				skipTlsVerify: formSmtpSkipTlsVerify || undefined,
				username: formSmtpUsername.trim() || undefined,
				password: formSmtpPassword || undefined,
				from_email: formSmtpFromEmail.trim(),
				from_name: formSmtpFromName.trim() || undefined,
				to_emails: formSmtpToEmails.split(',').map(e => e.trim()).filter(Boolean)
			};
		} else {
			return {
				urls: formAppriseUrls.split('\n').map(u => u.trim()).filter(Boolean)
			};
		}
	}

	function validateConfig(): string | null {
		const config = getFormConfig();
		if (formType === 'smtp') {
			if (!config.host || !config.from_email || !config.to_emails?.length) {
				return '服务器地址、发件邮箱和至少一个收件人是必填项';
			}
		} else {
			if (!config.urls?.length) {
				return '至少需要填写一条 Webhook 地址';
			}
		}
		return null;
	}

	async function testConfig() {
		const validationError = validateConfig();
		if (validationError) {
			formError = validationError;
			return;
		}

		formTesting = true;
		formError = '';
		testResult = 'idle';

		try {
			// When editing with no password entered, use stored credentials via [id]/test
			// to avoid sending blank password and getting "Missing credentials" from SMTP server
			const useStoredCredentials = isEditing && formType === 'smtp' && !formSmtpPassword && notification?.id;

			let response: Response;
			if (useStoredCredentials) {
				response = await fetch(`/api/notifications/${notification!.id}/test`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' }
				});
			} else {
				const config = getFormConfig();
				response = await fetch('/api/notifications/test', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						type: formType,
						name: formName.trim() || 'Test',
						config
					})
				});
			}

			const data = await response.json();

			if (data.success) {
				testResult = 'success';
				toast.success('测试通知发送成功');
				setTimeout(() => { testResult = 'idle'; }, 3000);
			} else {
				testResult = 'error';
				formError = data.error || '发送测试通知失败';
				setTimeout(() => { testResult = 'idle'; }, 3000);
			}
		} catch {
			testResult = 'error';
			formError = '测试通知失败';
			setTimeout(() => { testResult = 'idle'; }, 3000);
		} finally {
			formTesting = false;
		}
	}

	async function save() {
		if (!formName.trim()) {
			formError = '名称为必填项';
			return;
		}

		const config = getFormConfig();
		if (formType === 'smtp') {
			if (!config.host || !config.from_email || !config.to_emails?.length) {
				formError = '服务器地址、发件邮箱和至少一个收件人是必填项';
				return;
			}
		} else {
			if (!config.urls?.length) {
				formError = '至少需要填写一条 Webhook 地址';
				return;
			}
		}

		formSaving = true;
		formError = '';

		try {
			const url = isEditing ? `/api/notifications/${notification!.id}` : '/api/notifications';
			const method = isEditing ? 'PUT' : 'POST';

			const body: Record<string, any> = {
				name: formName.trim(),
				enabled: formEnabled,
				config,
				eventTypes: formSystemEvents
			};

			// Only include type for new notifications
			if (!isEditing) {
				body.type = formType;
			}

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (response.ok) {
				open = false;
				onSaved();
			} else {
				const data = await response.json();
				formError = data.error || `${isEditing ? '更新' : '创建'}通知失败`;
			}
		} catch {
			formError = `${isEditing ? '更新' : '创建'}通知失败`;
		} finally {
			formSaving = false;
		}
	}

	function handleClose() {
		open = false;
		onClose();
	}

	function toggleSystemEvent(eventId: string, checked: boolean) {
		if (checked) {
			formSystemEvents = [...formSystemEvents, eventId];
		} else {
			formSystemEvents = formSystemEvents.filter(e => e !== eventId);
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (o) { formError = ''; focusFirstInput(); } }}>
	<Dialog.Content class="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
		<Dialog.Header>
			<Dialog.Title>{isEditing ? '编辑' : '添加'}通知渠道</Dialog.Title>
		</Dialog.Header>

		{#if formError}
			<div class="text-sm text-red-600 dark:text-red-400">{formError}</div>
		{/if}

		<Tabs.Root bind:value={activeTab} class="flex-1 flex flex-col overflow-hidden mt-2">
			<Tabs.List class="flex-shrink-0 mb-0 w-full grid grid-cols-2">
				<Tabs.Trigger value="channel" class="flex items-center justify-center gap-1.5">
					<Settings class="w-3.5 h-3.5" />
					通道
				</Tabs.Trigger>
				<Tabs.Trigger value="events" class="flex items-center justify-center gap-1.5">
					<Bell class="w-3.5 h-3.5" />
					系统事件
					{#if formSystemEvents.length > 0}
						<Badge variant="secondary" class="ml-1 h-4 px-1.5 text-[10px]">{formSystemEvents.length}</Badge>
					{/if}
				</Tabs.Trigger>
			</Tabs.List>

			<div class="overflow-y-auto pb-4 pr-2 h-[530px]">
				<Tabs.Content value="channel" class="space-y-4 mt-0">
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="notif-name">名称 *</Label>
					<Input id="notif-name" bind:value={formName} placeholder="我的通知渠道" />
				</div>
				<div class="space-y-2">
					<Label>类型</Label>
					{#if isEditing}
						<Badge variant="secondary" class="h-9 flex items-center justify-center">
							{formType === 'smtp' ? 'SMTP (Email)' : 'Webhooks'}
						</Badge>
					{:else}
						<Select.Root
							type="single"
							value={formType}
							onValueChange={(v) => formType = v as 'smtp' | 'apprise'}
						>
							<Select.Trigger class="w-full">
								<span class="flex items-center gap-2">
									{#if formType === 'smtp'}
										<Mail class="w-4 h-4" />SMTP (邮件)
									{:else}
										<Zap class="w-4 h-4" />Webhooks
									{/if}
								</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="smtp">
									<span class="flex items-center gap-2"><Mail class="w-4 h-4" />SMTP (邮件)</span>
								</Select.Item>
								<Select.Item value="apprise">
									<span class="flex items-center gap-2"><Zap class="w-4 h-4" />Webhooks</span>
								</Select.Item>
							</Select.Content>
						</Select.Root>
					{/if}
				</div>
			</div>

			<div class="flex items-center gap-2">
				<Label>状态</Label>
				<TogglePill bind:checked={formEnabled} onLabel="启用" offLabel="禁用" />
			</div>

			{#if formType === 'smtp'}
				<div class="space-y-4 border-t pt-4 min-h-[380px]">
					<div class="flex items-center gap-2">
						<p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SMTP 配置</p>
						<Tooltip.Root>
							<Tooltip.Trigger>
								<HelpCircle class="w-3.5 h-3.5 text-muted-foreground hover:text-foreground cursor-help" />
							</Tooltip.Trigger>
							<Tooltip.Portal>
								<Tooltip.Content side="right" class="w-80">
									<p class="text-xs"><span class="font-semibold">Gmail：</span>smtp.gmail.com，端口 587，关闭 TLS/SSL。使用应用专用密码。</p>
									<p class="text-xs mt-1"><span class="font-semibold">Outlook：</span>smtp.office365.com，端口 587，关闭 TLS/SSL。</p>
								</Tooltip.Content>
							</Tooltip.Portal>
						</Tooltip.Root>
					</div>
					<div class="grid grid-cols-3 gap-4">
						<div class="space-y-2 col-span-2">
							<Label for="notif-smtp-host">SMTP 服务器 *</Label>
							<Input id="notif-smtp-host" bind:value={formSmtpHost} placeholder="smtp.gmail.com" />
						</div>
						<div class="space-y-2">
							<Label for="notif-smtp-port">端口 *</Label>
							<Input id="notif-smtp-port" type="number" bind:value={formSmtpPort} />
						</div>
					</div>
					<div class="flex items-center gap-4">
						<div class="flex items-center gap-2">
							<Label>TLS/SSL</Label>
							<TogglePill bind:checked={formSmtpSecure} onLabel="开启" offLabel="关闭" />
						</div>
						<div class="flex items-center gap-2">
							<Label class="text-muted-foreground">跳过 TLS 验证</Label>
							<TogglePill bind:checked={formSmtpSkipTlsVerify} onLabel="开启" offLabel="关闭" />
						</div>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="notif-smtp-username">用户名</Label>
							<Input id="notif-smtp-username" bind:value={formSmtpUsername} placeholder="user@example.com" />
						</div>
						<div class="space-y-2">
							<Label for="notif-smtp-password">密码</Label>
							<Input id="notif-smtp-password" type="password" bind:value={formSmtpPassword} placeholder={isEditing ? '留空以保留现有密码' : '应用密码或令牌'} />
						</div>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="notif-smtp-from-email">发件邮箱 *</Label>
							<Input id="notif-smtp-from-email" bind:value={formSmtpFromEmail} placeholder="alerts@example.com" />
						</div>
						<div class="space-y-2">
							<Label for="notif-smtp-from-name">发件人名称</Label>
							<Input id="notif-smtp-from-name" bind:value={formSmtpFromName} placeholder="系统通知" />
						</div>
					</div>
					<div class="space-y-2">
						<Label for="notif-smtp-to">收件人 * (英文逗号分隔)</Label>
						<Input id="notif-smtp-to" bind:value={formSmtpToEmails} placeholder="admin@example.com, ops@example.com" />
					</div>
				</div>
			{:else}
				<div class="space-y-4 border-t pt-4 min-h-[380px]">
					<p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Webhook 配置</p>
					<div class="space-y-2">
						<Label for="notif-apprise-urls">Webhook 地址 * (每行填写一条)</Label>
						<textarea
							id="notif-apprise-urls"
							bind:value={formAppriseUrls}
							placeholder="gotify://hostname/app-token
gotifys://hostname/app-token?priority=5
discord://webhook_id/webhook_token
slack://token_a/token_b/token_c
mmost://hostname/webhook-token
tgram://bot_token/chat_id
tgram://bot_token/chat_id:topic_id
ntfy://my-topic
ntfy://host/topic?auth=base64token&priority=3
ntfys://host/topic?auth=base64token
pushover://user_key/api_token
pushover://user_key/api_token/device1/device2
pover://user_key@api_token/device1/device2
mqtt://user:pass@broker-host:1883/dockhand/events?qos=1&amp;retain=true
mqtts://broker-host:8883/dockhand/events
workflows://hostname/workflow/signature
bark://bark_key
bark://host/bark_key
barks://host/bark_key
signal://host:8080/+sender/+recipient
apprise://host:8000/your-key
jsons://hostname/webhook/path
zabbix://hostname/api_jsonrpc.php?token=TOKEN&amp;host=HOST&amp;key=ITEM_KEY
zabbixs://hostname/api_jsonrpc.php?token=TOKEN&amp;host=HOST&amp;key=ITEM_KEY"
						class="flex min-h-[220px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					></textarea>
					<p class="text-xs text-muted-foreground">
						内置通知通道：Discord、Slack、Mattermost、Telegram、ntfy、Gotify、Pushover、MQTT、Bark、Signal (通过 signal-cli-rest-api)、Microsoft Teams (通过 Workflows)、Zabbix (通过 history.push) 以及通用 JSON。
					</p>
					<p class="flex gap-1.5 text-xs text-muted-foreground">
						<HelpCircle class="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
						<span>需要列表之外的通知服务商 (Matrix、Nextcloud、Pushbullet、Home Assistant……)？部署一台 <a href="https://github.com/caronc/apprise-api" target="_blank" rel="noopener">caronc/apprise‑api</a> 服务端，在该服务端配置对应服务商，然后在 Dockhand 使用 <code>apprise://host/key</code> (TLS 加密使用 <code>apprises://</code>) 指向该服务。即可使用 Apprise 支持的全部通知服务商。</span>
					</p>
					</div>
				</div>
			{/if}

				</Tabs.Content>

				<Tabs.Content value="events" class="space-y-3 mt-0">
					<p class="text-xs text-muted-foreground">
						此类事件不归属特定环境，在此处进行全局配置。
						独立环境事件 (容器、堆栈、自动更新) 请在对应环境设置中配置。
					</p>
					<div class="space-y-1">
						{#each SYSTEM_EVENTS as event}
							<div class="flex items-center gap-3 p-2 rounded hover:bg-muted/50">
								<TogglePill
									checked={formSystemEvents.includes(event.id)}
									onchange={() => toggleSystemEvent(event.id, !formSystemEvents.includes(event.id))}
								/>
								<div class="flex-1 min-w-0">
									<span class="text-sm font-medium">{event.label}</span>
									<p class="text-xs text-muted-foreground">{event.description}</p>
								</div>
							</div>
						{/each}
					</div>
				</Tabs.Content>
			</div>
		</Tabs.Root>

		<Dialog.Footer class="flex justify-between sm:justify-between">
			<Button variant="outline" onclick={testConfig} disabled={formTesting || formSaving}>
				{#if formTesting}
					<RefreshCw class="w-4 h-4 mr-1 animate-spin" />
					测试中...
				{:else if testResult === 'success'}
					<CheckCircle2 class="w-4 h-4 mr-1 text-green-500" />
					已发送！
				{:else if testResult === 'error'}
					<XCircle class="w-4 h-4 mr-1 text-destructive" />
					失败
				{:else}
					<Send class="w-4 h-4" />
					测试
				{/if}
			</Button>
			<div class="flex gap-2">
				<Button variant="outline" onclick={handleClose}>取消</Button>
				<Button onclick={save} disabled={formSaving || formTesting}>
					{#if formSaving}
						<RefreshCw class="w-4 h-4 mr-1 animate-spin" />
					{:else if isEditing}
						<Check class="w-4 h-4" />
					{:else}
						<Plus class="w-4 h-4" />
					{/if}
					{isEditing ? '保存' : '添加'}
				</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
