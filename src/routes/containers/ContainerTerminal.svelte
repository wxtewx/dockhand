<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Terminal as TerminalIcon, X, ExternalLink, Shell, User, Loader2, AlertCircle } from 'lucide-svelte';
	import { detectShells, getBestShell, hasAvailableShell, USER_OPTIONS, type ShellDetectionResult } from '$lib/utils/shell-detection';

	// Dynamic imports for browser-only xterm
	let Terminal: any;
	let FitAddon: any;
	let WebLinksAddon: any;
	let xtermLoaded = $state(false);

	interface Props {
		open: boolean;
		containerId: string;
		containerName: string;
		envId?: number | null;
		onClose: () => void;
	}

	let { open = $bindable(), containerId, containerName, envId = null, onClose }: Props = $props();

	let terminalRef: HTMLDivElement;
	let terminal: Terminal | null = null;
	let fitAddon: FitAddon | null = null;
	let ws: WebSocket | null = null;
	let connected = $state(false);
	let error = $state<string | null>(null);

	// Shell detection state
	let shellDetection = $state<ShellDetectionResult | null>(null);
	let detectingShells = $state(false);

	// Derived: check if any shell is available
	const anyShellAvailable = $derived(
		!shellDetection || hasAvailableShell(shellDetection)
	);

	let selectedShell = $state('/bin/bash');
	let selectedUser = $state('root');
	let showConfig = $state(true);

	function initTerminal() {
		if (!terminalRef || terminal) return;

		terminal = new Terminal({
			cursorBlink: true,
			fontFamily: 'Menlo, Monaco, "Courier New", monospace',
			fontSize: 14,
			theme: {
				background: '#0c0c0c',
				foreground: '#cccccc',
				cursor: '#ffffff',
				cursorAccent: '#000000',
				selectionBackground: '#264f78',
				black: '#0c0c0c',
				red: '#c50f1f',
				green: '#13a10e',
				yellow: '#c19c00',
				blue: '#0037da',
				magenta: '#881798',
				cyan: '#3a96dd',
				white: '#cccccc',
				brightBlack: '#767676',
				brightRed: '#e74856',
				brightGreen: '#16c60c',
				brightYellow: '#f9f1a5',
				brightBlue: '#3b78ff',
				brightMagenta: '#b4009e',
				brightCyan: '#61d6d6',
				brightWhite: '#f2f2f2'
			}
		});

		fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new WebLinksAddon());

		terminal.open(terminalRef);
		fitAddon.fit();

		// Handle terminal input
		terminal.onData((data) => {
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'input', data }));
			}
		});

		// Handle resize
		terminal.onResize(({ cols, rows }) => {
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'resize', cols, rows }));
			}
		});

		// Connect to container
		connect();
	}

	function connect() {
		if (!terminal) return;

		error = null;
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		let wsUrl = `${protocol}//${window.location.host}/api/containers/${containerId}/exec?shell=${encodeURIComponent(selectedShell)}&user=${encodeURIComponent(selectedUser)}`;
		if (envId) {
			wsUrl += `&envId=${envId}`;
		}

		terminal.writeln(`\x1b[90m正在连接到 ${containerName}...\x1b[0m`);
		terminal.writeln(`\x1b[90mShell: ${selectedShell}, 用户：${selectedUser || '默认'}\x1b[0m`);
		terminal.writeln('');

		ws = new WebSocket(wsUrl);

		ws.onopen = () => {
			connected = true;
			terminal?.focus();
			// Send initial resize
			if (fitAddon && terminal) {
				const dims = fitAddon.proposeDimensions();
				if (dims) {
					ws?.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
				}
			}
		};

		ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);
				if (msg.type === 'output') {
					terminal?.write(msg.data);
				} else if (msg.type === 'error') {
					error = msg.message;
					terminal?.writeln(`\x1b[31m错误：${msg.message}\x1b[0m`);
				} else if (msg.type === 'exit') {
					terminal?.writeln('\x1b[90m\r\n会话已结束。\x1b[0m');
					connected = false;
					// Close the dialog after a brief delay so user sees the message
					setTimeout(() => {
						handleClose();
					}, 500);
				}
			} catch (e) {
				terminal?.write(event.data);
			}
		};

		ws.onerror = (e) => {
			console.error('WebSocket 错误:', e);
			error = '连接错误';
			terminal?.writeln('\x1b[31m连接错误\x1b[0m');
		};

		ws.onclose = () => {
			connected = false;
			terminal?.writeln('\x1b[90m已断开连接。\x1b[0m');
		};
	}

	function startSession() {
		if (!xtermLoaded || !anyShellAvailable) return;
		showConfig = false;
		// Wait for DOM update then init terminal
		setTimeout(() => {
			initTerminal();
		}, 100);
	}

	function openInNewWindow() {
		const params = new URLSearchParams({
			shell: selectedShell,
			user: selectedUser,
			name: containerName
		});
		const url = `/terminal?container=${containerId}`;
		window.open(url, `terminal_${containerId}`, 'width=900,height=600,resizable=yes,scrollbars=no');
		handleClose();
	}

	function disconnect() {
		if (ws) {
			ws.close();
			ws = null;
		}
	}

	function cleanup() {
		disconnect();
		if (terminal) {
			terminal.dispose();
			terminal = null;
		}
		fitAddon = null;
		showConfig = true;
		connected = false;
		error = null;
	}

	function handleClose() {
		cleanup();
		onClose();
	}

	// Handle window resize
	function handleResize() {
		if (fitAddon && terminal) {
			fitAddon.fit();
		}
	}

	// Detect shells when dialog opens
	async function detectContainerShells() {
		if (!containerId) return;

		detectingShells = true;
		shellDetection = null;
		try {
			shellDetection = await detectShells(containerId, envId);

			// Auto-select best available shell if current is not available
			const bestShell = getBestShell(shellDetection, selectedShell);
			if (bestShell && bestShell !== selectedShell) {
				selectedShell = bestShell;
			}
		} catch (error) {
			console.error('检测终端失败:', error);
		} finally {
			detectingShells = false;
		}
	}

	onMount(async () => {
		window.addEventListener('resize', handleResize);

		// Dynamically load xterm modules (browser only)
		const xtermModule = await import('@xterm/xterm');
		const fitModule = await import('@xterm/addon-fit');
		const webLinksModule = await import('@xterm/addon-web-links');

		// Handle both ESM and CommonJS exports
		Terminal = xtermModule.Terminal || xtermModule.default?.Terminal;
		FitAddon = fitModule.FitAddon || fitModule.default?.FitAddon;
		WebLinksAddon = webLinksModule.WebLinksAddon || webLinksModule.default?.WebLinksAddon;

		// Load CSS
		await import('@xterm/xterm/css/xterm.css');
		xtermLoaded = true;
	});

	onDestroy(() => {
		window.removeEventListener('resize', handleResize);
		cleanup();
	});

	// Detect shells when dialog opens, reset when it closes
	$effect(() => {
		if (open) {
			detectContainerShells();
		} else {
			cleanup();
			shellDetection = null;
		}
	});
</script>

<Dialog.Root bind:open onOpenChange={(isOpen) => !isOpen && handleClose()}>
	<Dialog.Content class="max-w-6xl w-[90vw] h-[80vh] flex flex-col p-0 gap-0">
		<Dialog.Header class="px-4 py-3 border-b flex-shrink-0">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<TerminalIcon class="w-5 h-5" />
					<Dialog.Title>终端 - {containerName}</Dialog.Title>
					{#if connected}
						<span class="inline-flex items-center gap-1 text-xs text-green-500">
							<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
							已连接
						</span>
					{/if}
				</div>
				<button
					onclick={handleClose}
					class="p-1 rounded hover:bg-muted transition-colors"
				>
					<X class="w-4 h-4" />
				</button>
			</div>
		</Dialog.Header>

		{#if showConfig}
			<div class="flex-1 flex items-center justify-center p-6">
				{#if detectingShells}
					<div class="text-center">
						<Loader2 class="w-12 h-12 mx-auto mb-4 text-muted-foreground animate-spin" />
						<h3 class="text-lg font-medium">正在检测可用终端...</h3>
					</div>
				{:else if !anyShellAvailable}
					<div class="text-center">
						<AlertCircle class="w-12 h-12 mx-auto mb-4 text-amber-500" />
						<h3 class="text-lg font-medium text-amber-500">无可用终端</h3>
						<p class="text-sm text-muted-foreground mt-2">
							该容器未安装任何终端程序。
						</p>
						<p class="text-xs text-muted-foreground/70 mt-1">
							基于空白镜像或极简镜像构建的容器通常不包含终端。
						</p>
						<Button onclick={handleClose} variant="outline" class="mt-6">
							关闭
						</Button>
					</div>
				{:else}
					<div class="w-full max-w-md space-y-6">
						<div class="text-center">
							<TerminalIcon class="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
							<h3 class="text-lg font-medium">打开终端会话</h3>
							<p class="text-sm text-muted-foreground mt-1">
								配置本次会话使用的终端和用户
							</p>
						</div>

						<div class="space-y-4">
							<div class="space-y-2">
								<Label>Shell</Label>
								<Select.Root type="single" bind:value={selectedShell}>
									<Select.Trigger class="w-full h-10">
										<Shell class="w-4 h-4 mr-2 text-muted-foreground" />
										<span>{shellDetection?.allShells.find(o => o.path === selectedShell)?.label || '选择 shell'}</span>
									</Select.Trigger>
									<Select.Content>
										{#if shellDetection}
											{#each shellDetection.allShells as option}
												<Select.Item
													value={option.path}
													label={option.label}
													disabled={!option.available}
												>
													<Shell class="w-4 h-4 mr-2 {option.available ? 'text-green-500' : 'text-muted-foreground/40'}" />
													<span class={option.available ? 'text-foreground' : 'text-muted-foreground/60'}>
														{option.label}
														{#if !option.available}
															<span class="text-xs ml-1">(不可用)</span>
														{/if}
													</span>
												</Select.Item>
											{/each}
										{/if}
									</Select.Content>
								</Select.Root>
							</div>

							<div class="space-y-2">
								<Label>用户</Label>
								<Select.Root type="single" bind:value={selectedUser}>
									<Select.Trigger class="w-full h-10">
										<User class="w-4 h-4 mr-2 text-muted-foreground" />
										<span>{USER_OPTIONS.find(o => o.value === selectedUser)?.label || '选择用户'}</span>
									</Select.Trigger>
									<Select.Content>
										{#each USER_OPTIONS as option}
											<Select.Item value={option.value} label={option.label}>
												<User class="w-4 h-4 mr-2 text-muted-foreground" />
												{option.label}
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						</div>

						<div class="flex gap-2">
							<Button onclick={startSession} class="flex-1" disabled={!xtermLoaded || !anyShellAvailable}>
								<TerminalIcon class="w-4 h-4" />
								{xtermLoaded ? '连接' : '加载中...'}
							</Button>
							<Button onclick={openInNewWindow} variant="outline" disabled={!xtermLoaded} title="在新窗口打开">
								<ExternalLink class="w-4 h-4" />
							</Button>
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex-1 bg-[#0c0c0c] p-2 overflow-hidden">
				<div bind:this={terminalRef} class="h-full w-full"></div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<style>
	:global(.xterm) {
		height: 100%;
		padding: 8px;
	}

	:global(.xterm-viewport) {
		overflow-y: auto !important;
	}
</style>
