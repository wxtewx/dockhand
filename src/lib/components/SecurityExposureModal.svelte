<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { ShieldAlert } from 'lucide-svelte';

	interface Props {
		open: boolean;
		onDismiss: (dontShowAgain: boolean) => void;
	}

	let { open = $bindable(), onDismiss }: Props = $props();

	let dontShowAgain = $state(false);

	function close() {
		onDismiss(dontShowAgain);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<ShieldAlert class="w-5 h-5 text-destructive" />
				不安全暴露警告
			</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-3 text-sm">
			<p>
				当前 Dockhand 在 localhost 以外地址监听，认证已关闭，且 Docker socket 以读写方式挂载。在此状态下，任何能够访问该服务的人都可以在主机上创建容器 — 意味着可以完全控制这台机器。
			</p>
			<p>
				如果该实例可从公网访问，请在
                <span class="font-medium">设置 > 认证</span>
                中启用认证并创建管理员用户。即使已开启认证，也请将 Dockhand 部署在防火墙或 VPN 后方 — 它是 Docker 的管理界面，不应直接对外暴露。
			</p>
		</div>

		<Dialog.Footer class="flex items-center justify-between gap-3 sm:justify-between">
			<label class="flex items-center gap-2 text-sm text-muted-foreground">
				<Checkbox bind:checked={dontShowAgain} />
				我已了解，不再提示
			</label>
			<Button onclick={close}>知道了</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
