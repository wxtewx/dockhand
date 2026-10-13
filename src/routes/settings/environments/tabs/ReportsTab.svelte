<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { TogglePill } from '$lib/components/ui/toggle-pill';
	import CronEditor from '$lib/components/cron-editor.svelte';
	import { Button } from '$lib/components/ui/button';
	import { FileText, RefreshCw, Mail, FileDown, Download } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	interface SmtpChannel {
		id: number;
		name: string;
	}

	interface Props {
		/** The environment this tab belongs to, so the report can be downloaded here. */
		environmentId: number | null;
		reportLoading: boolean;
		reportEnabled: boolean;
		reportCron: string;
		reportFormat: 'pdf' | 'csv';
		reportNotificationId: number | null;
		/** Only SMTP channels: nothing else can carry the attachment. */
		smtpChannels: SmtpChannel[];
		/** A paid licence of either tier; without one the report cannot be built at all. */
		licensed: boolean;
	}

	let {
		environmentId,
		reportLoading,
		reportEnabled = $bindable(),
		reportCron = $bindable(),
		reportFormat = $bindable(),
		reportNotificationId = $bindable(),
		smtpChannels,
		licensed
	}: Props = $props();

	let downloading = $state(false);

	/** Download the report for this environment now, in the format the schedule would send. */
	async function downloadNow(format: 'pdf' | 'csv') {
		if (environmentId === null) return;
		downloading = true;
		try {
			const response = await fetch(`/api/environments/report?format=${format}&env=${environmentId}`);
			if (!response.ok) {
				const message = await response.json().then((b) => b?.error).catch(() => null);
				toast.error(message || '生成报告失败');
				return;
			}
			const blob = await response.blob();
			const name =
				response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
				`dockhand-report.${format}`;
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = name;
			link.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('下载报告失败:', error);
			toast.error('生成报告失败');
		} finally {
			downloading = false;
		}
	}

	const formatLabel = $derived(reportFormat === 'csv' ? 'CSV' : 'PDF');
	const channelLabel = $derived(
		smtpChannels.find((c) => c.id === reportNotificationId)?.name ?? '选择通道'
	);
</script>

<div class="space-y-4">
	<div class="flex items-center gap-2 text-sm font-medium">
		<FileText class="w-4 h-4" />
		定时状态报告
	</div>
	<p class="text-xs text-muted-foreground">
		按计划发送此环境运行资源的报告，包含漏洞数量与扫描覆盖率。
	</p>

	{#if !licensed}
		<div class="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
			生成状态报告需要商业许可证。
		</div>
	{:else if reportLoading}
		<div class="flex items-center justify-center py-4">
			<RefreshCw class="w-5 h-5 animate-spin text-muted-foreground" />
		</div>
	{:else}
		<!-- Downloading is the common case; the schedule below is the standing arrangement. -->
		<div class="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3">
			<Download class="w-4 h-4 text-muted-foreground shrink-0" />
			<div class="flex-1 min-w-0">
				<Label>下载此环境的报告</Label>
				<p class="text-xs text-muted-foreground">立即生成，仅包含当前环境。</p>
			</div>
			<Button size="sm" variant="outline" disabled={downloading || environmentId === null}
				onclick={() => downloadNow('pdf')}>PDF</Button>
			<Button size="sm" variant="outline" disabled={downloading || environmentId === null}
				onclick={() => downloadNow('csv')}>CSV</Button>
		</div>

		<div class="flex items-start gap-2 pt-1">
			<FileDown class="w-4 h-4 text-sky-500 mt-0.5 shrink-0" />
			<div class="flex-1">
				<Label>按计划发送报告</Label>
				<p class="text-xs text-muted-foreground">
					报告会列出所有容器及其镜像已知漏洞，并以邮件附件形式从本实例发出。
				</p>
			</div>
			<TogglePill bind:checked={reportEnabled} />
		</div>

		{#if reportEnabled}
			<div class="flex items-start gap-2">
				<div class="w-4 shrink-0"></div>
				<div class="flex-1 space-y-2">
					<Label>调度计划</Label>
					<CronEditor value={reportCron} onchange={(cron) => (reportCron = cron)} />
				</div>
			</div>

			<div class="flex items-start gap-2">
				<div class="w-4 shrink-0"></div>
				<div class="flex-1 space-y-2">
					<Label>格式</Label>
					<Select.Root type="single" bind:value={reportFormat}>
						<Select.Trigger class="w-full">{formatLabel}</Select.Trigger>
						<Select.Content>
							<Select.Item value="pdf">PDF - 适合阅读与归档</Select.Item>
							<Select.Item value="csv">CSV - 用于电子表格或其他工具</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			<div class="flex items-start gap-2">
				<Mail class="w-4 h-4 text-muted-foreground mt-7 shrink-0" />
				<div class="flex-1 space-y-2">
					<Label>发送至</Label>
					{#if smtpChannels.length === 0}
						<p class="text-xs text-amber-600 dark:text-amber-400">
							尚未配置 SMTP 通道。前往 设置 > 通知 新增；Webhook
                            通道无法携带附件。在此之前，请关闭上方的定时任务：
                            未配置通道时无法保存。
						</p>
					{:else}
						<Select.Root
							type="single"
							value={reportNotificationId === null ? '' : String(reportNotificationId)}
							onValueChange={(v) => (reportNotificationId = v ? parseInt(v, 10) : null)}
						>
							<Select.Trigger class="w-full">{channelLabel}</Select.Trigger>
							<Select.Content>
								{#each smtpChannels as channel (channel.id)}
									<Select.Item value={String(channel.id)}>{channel.name}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<p class="text-xs text-muted-foreground">
							列表仅展示 SMTP 通道；报告将作为附件发送。
						</p>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>
