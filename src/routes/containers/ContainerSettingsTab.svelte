<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import * as Popover from '$lib/components/ui/popover';
	import * as Command from '$lib/components/ui/command';
	import { tick } from 'svelte';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { TogglePill, ToggleGroup } from '$lib/components/ui/toggle-pill';
	import { Plus, Trash2, Settings2, RefreshCw, Network, X, Ban, RotateCw, AlertTriangle, PauseCircle, Share2, Server, CircleOff, Box, ChevronDown, ChevronsUpDown, Check, ChevronRight, Cpu, Shield, HeartPulse, Wifi, HardDrive, Lock, Loader2, CheckCircle2, Package, Gpu, Search, CircleHelp } from 'lucide-svelte';
	import { parseHostPort, validatePort, validateIp, formatHostPort, expandPortBindings } from '$lib/utils/port-parse';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { currentEnvironment } from '$lib/stores/environment';
	import { Badge } from '$lib/components/ui/badge';
	import AutoUpdateSettings from './AutoUpdateSettings.svelte';
	import type { VulnerabilityCriteria } from '$lib/components/VulnerabilityCriteriaSelector.svelte';
	import type { SystemContainerType, getLabelText } from '$lib/types';

	// Detect system containers (must match server-side logic in update-utils.ts)
	function detectSystemContainer(imageName: string): SystemContainerType | null {
		const lower = imageName.toLowerCase();
		if (lower.includes('fnsys/dockhand')) return 'dockhand';
		if (lower.includes('finsys/hawser') || lower.includes('ghcr.io/finsys/hawser')) return 'hawser';
		return null;
	}

	// Protocol options for ports
	const protocolOptions = [
		{ value: 'tcp', label: 'TCP' },
		{ value: 'udp', label: 'UDP' }
	];

	// Mode options for volumes
	const volumeModeOptions = [
		{ value: 'rw', label: '读写' },
		{ value: 'ro', label: '只读' }
	];

	const commonCapabilities = [
		'SYS_ADMIN', 'SYS_PTRACE', 'SYS_RAWIO', 'NET_ADMIN', 'NET_RAW', 'IPC_LOCK',
		'SYS_TIME', 'SYS_RESOURCE', 'MKNOD', 'AUDIT_WRITE', 'SETFCAP',
		'CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID', 'KILL', 'SETGID',
		'SETUID', 'SETPCAP', 'NET_BIND_SERVICE', 'SYS_CHROOT', 'AUDIT_CONTROL'
	];

	const commonUlimits = ['nofile', 'nproc', 'core', 'memlock', 'stack', 'cpu', 'fsize', 'locks'];

	const commonGpuCapabilities = ['gpu', 'compute', 'utility', 'graphics', 'video', 'display'];

	interface ConfigSet {
		id: number;
		name: string;
		description?: string;
		envVars?: { key: string; value: string }[];
		labels?: { key: string; value: string }[];
		ports?: { hostPort: string; containerPort: string; protocol: string }[];
		volumes?: { hostPath: string; containerPath: string; mode: string }[];
		networkMode: string;
		restartPolicy: string;
	}

	interface DockerNetwork {
		id: string;
		name: string;
		driver: string;
	}

	interface ContainerItem {
		id: string;
		name: string;
		image: string;
		state: string;
	}

	interface NetworkEndpointConfig {
		ipv4Address: string;
		ipv6Address: string;
		aliases: string;
	}

	interface Props {
		mode: 'create' | 'edit';
		// Basic settings
		name: string;
		image: string;
		command: string;
		restartPolicy: string;
		restartMaxRetries: number | '';
		networkMode: string;
		startAfterCreate?: boolean;
		repullImage?: boolean;
		// Port mappings
		portMappings: { hostPort: string; containerPort: string; protocol: string }[];
		// Volume mappings
		volumeMappings: { hostPath: string; containerPath: string; mode: string }[];
		// Environment variables
		envVars: { key: string; value: string }[];
		// Labels
		labels: { key: string; value: string }[];
		// Networks
		selectedNetworks: string[];
		networkConfigs: Record<string, NetworkEndpointConfig>;
		macAddress: string;
		// User/Group
		containerUser: string;
		// Privileged mode
		privilegedMode: boolean;
		// Healthcheck settings
		healthcheckEnabled: boolean;
		healthcheckCommand: string;
		healthcheckInterval: number;
		healthcheckTimeout: number;
		healthcheckRetries: number;
		healthcheckStartPeriod: number;
		// Resource limits
		memoryLimit: string;
		memoryReservation: string;
		cpuShares: string;
		nanoCpus: string;
		cpuQuota: string;
		cpuPeriod: string;
		// Capabilities
		capAdd: string[];
		capDrop: string[];
		// Security options
		securityOptions: string[];
		// Devices
		deviceMappings: { hostPath: string; containerPath: string; permissions: string }[];
		// GPU settings
		gpuEnabled: boolean;
		gpuMode: 'all' | 'count' | 'specific';
		gpuCount: number;
		gpuDeviceIds: string[];
		gpuDriver: string;
		gpuCapabilities: string[];
		runtime: string;
		// DNS settings
		dnsServers: string[];
		dnsSearch: string[];
		dnsOptions: string[];
		// Ulimits
		ulimits: { name: string; soft: string; hard: string }[];
		// Auto-update
		autoUpdateEnabled: boolean;
		autoUpdateCronExpression: string;
		vulnerabilityCriteria: VulnerabilityCriteria;
		// Config sets
		configSets: ConfigSet[];
		selectedConfigSetId: string;
		// Errors
		errors: { name?: string; image?: string };
		// Create mode specific
		imageSummary?: {
			isPulling: boolean;
			isScanning: boolean;
			imageReady: boolean;
			scanResults?: { summary: { critical: number; high: number } }[];
			totalVulnerabilities?: number;
			hasCriticalOrHigh?: boolean;
		};
	}

	let {
		mode,
		name = $bindable(),
		image = $bindable(),
		command = $bindable(),
		restartPolicy = $bindable(),
		restartMaxRetries = $bindable(),
		networkMode = $bindable(),
		startAfterCreate = $bindable(true),
		repullImage = $bindable(true),
		portMappings = $bindable(),
		volumeMappings = $bindable(),
		envVars = $bindable(),
		labels = $bindable(),
		selectedNetworks = $bindable(),
		networkConfigs = $bindable(),
		macAddress = $bindable(),
		containerUser = $bindable(),
		privilegedMode = $bindable(),
		healthcheckEnabled = $bindable(),
		healthcheckCommand = $bindable(),
		healthcheckInterval = $bindable(),
		healthcheckTimeout = $bindable(),
		healthcheckRetries = $bindable(),
		healthcheckStartPeriod = $bindable(),
		memoryLimit = $bindable(),
		memoryReservation = $bindable(),
		cpuShares = $bindable(),
		nanoCpus = $bindable(),
		cpuQuota = $bindable(),
		cpuPeriod = $bindable(),
		capAdd = $bindable(),
		capDrop = $bindable(),
		securityOptions = $bindable(),
		deviceMappings = $bindable(),
		gpuEnabled = $bindable(),
		gpuMode = $bindable(),
		gpuCount = $bindable(),
		gpuDeviceIds = $bindable(),
		gpuDriver = $bindable(),
		gpuCapabilities = $bindable(),
		runtime = $bindable(),
		dnsServers = $bindable(),
		dnsSearch = $bindable(),
		dnsOptions = $bindable(),
		ulimits = $bindable(),
		autoUpdateEnabled = $bindable(),
		autoUpdateCronExpression = $bindable(),
		vulnerabilityCriteria = $bindable(),
		configSets,
		selectedConfigSetId = $bindable(),
		errors = $bindable(),
		imageSummary
	}: Props = $props();

	// Fetch networks and containers from current environment
	let availableNetworks = $state<DockerNetwork[]>([]);
	let availableContainers = $state<ContainerItem[]>([]);

	// Container picker (Popover + Command combobox)
	let containerPickerOpen = $state(false);
	let containerPickerTriggerRef = $state<HTMLButtonElement>(null!);

	function closeAndFocusContainerPicker() {
		containerPickerOpen = false;
		tick().then(() => containerPickerTriggerRef?.focus());
	}

	// Networks picker (Popover + Command combobox)
	let networkPickerOpen = $state(false);
	let networkPickerTriggerRef = $state<HTMLButtonElement>(null!);

	function closeAndFocusNetworkPicker() {
		networkPickerOpen = false;
		tick().then(() => networkPickerTriggerRef?.focus());
	}

	async function fetchNetworks() {
		try {
			const envParam = $currentEnvironment ? `?env=${$currentEnvironment.id}` : '';
			const response = await fetch(`/api/networks${envParam}`);
			if (response.ok) {
				availableNetworks = await response.json();
			}
		} catch (err) {
			console.error('获取网络列表失败:', err);
		}
	}

	async function fetchContainers() {
		try {
			const envParam = $currentEnvironment ? `?env=${$currentEnvironment.id}` : '';
			const response = await fetch(`/api/containers${envParam}`);
			if (response.ok) {
				const containers: any[] = await response.json();
				availableContainers = containers
					.map(c => ({
						id: c.id,
						name: c.name,
						image: c.image,
						state: c.state
					}))
					.filter(c => c.name && c.name !== name);
			}
		} catch (err) {
			console.error('获取容器列表失败:', err);
		}
	}

	// Fetch both on mount so the dropdowns are ready when the user opens them
	fetchNetworks();
	fetchContainers();

	// Container network mode helpers
	// `networkModeType` reduces the raw NetworkMode to a logical group for branching:
	//   bridge | host | none | container | custom
	const networkModeType = $derived.by(() => {
		if (networkMode.startsWith('container:')) return 'container';
		if (['bridge', 'host', 'none'].includes(networkMode)) return networkMode;
		return 'custom';
	});
	// Raw value from networkMode — Docker stores either a name or a 64-char container ID
	const containerRefRaw = $derived(networkMode.startsWith('container:') ? networkMode.slice('container:'.length) : '');
	// Resolve ID → name when possible so the trigger shows "container:redis" not "container:<sha>"
	const containerRef = $derived.by(() => {
		if (!containerRefRaw) return '';
		const match = availableContainers.find(c => c.id === containerRefRaw || c.id.startsWith(containerRefRaw));
		return match ? match.name : containerRefRaw;
	});

	// Network mode picker (Popover + Command combobox) — flat list of bridge/host/none/Container + custom networks
	let networkModePickerOpen = $state(false);
	let networkModePickerTriggerRef = $state<HTMLButtonElement>(null!);

	function closeAndFocusNetworkModePicker() {
		networkModePickerOpen = false;
		tick().then(() => networkModePickerTriggerRef?.focus());
	}

	// Additional networks: custom networks NOT used as the primary mode and NOT already attached
	const selectableNetworks = $derived(
		availableNetworks.filter(n =>
			!selectedNetworks.includes(n.name) &&
			!['bridge', 'host', 'none'].includes(n.name) &&
			n.name !== networkMode  // exclude the primary
		)
	);

	// Custom networks available for the primary mode picker
	const customNetworks = $derived(
		availableNetworks.filter(n => !['bridge', 'host', 'none'].includes(n.name))
	);

	// Display label for the current network mode in the trigger
	const networkModeLabel = $derived.by(() => {
		if (networkModeType === 'bridge') return '桥接';
		if (networkModeType === 'host') return '主机';
		if (networkModeType === 'none') return '无';
		if (networkModeType === 'container') return containerRef ? `容器: ${containerRef}` : '容器';
		return networkMode;  // custom network name
	});

	// Expanded network config rows
	let expandedNetworks = $state<Set<string>>(new Set());

	function toggleNetworkExpand(networkName: string) {
		const next = new Set(expandedNetworks);
		if (next.has(networkName)) {
			next.delete(networkName);
		} else {
			next.add(networkName);
		}
		expandedNetworks = next;
	}

	function ensureNetworkConfig(networkName: string) {
		if (!networkConfigs[networkName]) {
			networkConfigs[networkName] = { ipv4Address: '', ipv6Address: '', aliases: '' };
			networkConfigs = { ...networkConfigs };
		}
	}

	function hasNetworkConfig(networkName: string): boolean {
		const cfg = networkConfigs[networkName];
		return !!cfg && !!(cfg.ipv4Address || cfg.ipv6Address || cfg.aliases);
	}

	// Validation helpers
	const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
	const ipv6Regex = /^[0-9a-fA-F:]+$/;
	const macRegex = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

	function validateIpv4(value: string): string | null {
		if (!value) return null;
		return ipv4Regex.test(value) ? null : '无效的 IPv4 地址';
	}

	function validateIpv6(value: string): string | null {
		if (!value) return null;
		return ipv6Regex.test(value) ? null : '无效的 IPv6 地址';
	}

	function validateMac(value: string): string | null {
		if (!value) return null;
		return macRegex.test(value) ? null : '无效的 MAC 地址 (例如：02:42:ac:11:00:02)';
	}

	// Auto-expand networks that have config
	$effect(() => {
		for (const net of selectedNetworks) {
			if (hasNetworkConfig(net) && !expandedNetworks.has(net)) {
				expandedNetworks = new Set([...expandedNetworks, net]);
			}
		}
	});

	// Collapsible sections state
	let showResources = $state(false);
	let showSecurity = $state(false);
	let showHealth = $state(false);
	let showDns = $state(false);
	let showDevices = $state(false);
	let showGpu = $state(false);
	let showUlimits = $state(false);

	// DNS input fields
	let dnsInput = $state('');
	let dnsSearchInput = $state('');
	let dnsOptionInput = $state('');

	// Security options input
	let securityOptionInput = $state('');

	// GPU device ID input
	let gpuDeviceIdInput = $state('');
	let customRuntimeInput = $state('');

	// Find free port
	let findingFreePort = $state(false);

	async function findFreePort(index: number) {
		findingFreePort = true;
		try {
			const envParam = $currentEnvironment ? `?env=${$currentEnvironment.id}` : '';
			const res = await fetch(`/api/containers${envParam}`);
			if (!res.ok) return;

			const containers: any[] = await res.json();
			const usedPorts = new Set<number>();
			for (const c of containers) {
				if (c.ports) {
					for (const p of c.ports) {
						const pub = p.PublicPort || p.publicPort;
						if (pub) usedPorts.add(pub);
					}
				}
			}
			// Also consider ports already typed in the form
			for (let i = 0; i < portMappings.length; i++) {
				if (i !== index && portMappings[i].hostPort) {
					const p = parseHostPort(portMappings[i].hostPort);
					const num = parseInt(p.hostPort);
					if (!isNaN(num)) usedPorts.add(num);
				}
			}

			const currentParsed = parseHostPort(portMappings[index].hostPort);
			const startFrom = parseInt(currentParsed.hostPort) || 8080;
			let port = startFrom;
			while (usedPorts.has(port) && port < 65535) port++;
			if (port <= 65535) {
				// Preserve IP prefix if present
				portMappings[index].hostPort = formatHostPort(currentParsed.hostIp, String(port));
			}
		} catch {
			// Silently fail
		} finally {
			findingFreePort = false;
		}
	}

	// Helper functions for form
	function addPortMapping() {
		portMappings = [...portMappings, { hostPort: '', containerPort: '', protocol: 'tcp' }];
	}

	function removePortMapping(index: number) {
		portMappings = portMappings.filter((_, i) => i !== index);
	}

	function addVolumeMapping() {
		volumeMappings = [...volumeMappings, { hostPath: '', containerPath: '', mode: 'rw' }];
	}

	function removeVolumeMapping(index: number) {
		volumeMappings = volumeMappings.filter((_, i) => i !== index);
	}

	function addEnvVar() {
		envVars = [...envVars, { key: '', value: '' }];
	}

	function removeEnvVar(index: number) {
		envVars = envVars.filter((_, i) => i !== index);
	}

	function addLabel() {
		labels = [...labels, { key: '', value: '' }];
	}

	function removeLabel(index: number) {
		labels = labels.filter((_, i) => i !== index);
	}

	function addNetwork(networkId: string) {
		if (networkId && !selectedNetworks.includes(networkId)) {
			selectedNetworks = [...selectedNetworks, networkId];
		}
	}

	function removeNetwork(networkId: string) {
		selectedNetworks = selectedNetworks.filter((n) => n !== networkId);
		const { [networkId]: _, ...rest } = networkConfigs;
		networkConfigs = rest;
		const next = new Set(expandedNetworks);
		next.delete(networkId);
		expandedNetworks = next;
	}

	function addDeviceMapping() {
		deviceMappings = [...deviceMappings, { hostPath: '', containerPath: '', permissions: 'rwm' }];
	}

	function removeDeviceMapping(index: number) {
		deviceMappings = deviceMappings.filter((_, i) => i !== index);
	}

	function addUlimit() {
		ulimits = [...ulimits, { name: 'nofile', soft: '', hard: '' }];
	}

	function removeUlimit(index: number) {
		ulimits = ulimits.filter((_, i) => i !== index);
	}

	function addGpuDeviceId() {
		if (gpuDeviceIdInput.trim() && !gpuDeviceIds.includes(gpuDeviceIdInput.trim())) {
			gpuDeviceIds = [...gpuDeviceIds, gpuDeviceIdInput.trim()];
			gpuDeviceIdInput = '';
		}
	}

	function removeGpuDeviceId(id: string) {
		gpuDeviceIds = gpuDeviceIds.filter(d => d !== id);
	}

	function addGpuCapability(cap: string) {
		if (cap && !gpuCapabilities.includes(cap)) {
			gpuCapabilities = [...gpuCapabilities, cap];
		}
	}

	function removeGpuCapability(cap: string) {
		gpuCapabilities = gpuCapabilities.filter(c => c !== cap);
	}

	function addCapability(type: 'add' | 'drop', cap: string) {
		if (!cap) return;
		const capUpper = cap.toUpperCase();
		if (type === 'add') {
			if (!capAdd.includes(capUpper)) {
				capAdd = [...capAdd, capUpper];
			}
		} else {
			if (!capDrop.includes(capUpper)) {
				capDrop = [...capDrop, capUpper];
			}
		}
	}

	function removeCapability(type: 'add' | 'drop', cap: string) {
		if (type === 'add') {
			capAdd = capAdd.filter(c => c !== cap);
		} else {
			capDrop = capDrop.filter(c => c !== cap);
		}
	}

	function addSecurityOption() {
		if (securityOptionInput.trim() && !securityOptions.includes(securityOptionInput.trim())) {
			securityOptions = [...securityOptions, securityOptionInput.trim()];
			securityOptionInput = '';
		}
	}

	function removeSecurityOption(option: string) {
		securityOptions = securityOptions.filter(o => o !== option);
	}

	function addDnsServer() {
		if (dnsInput.trim() && !dnsServers.includes(dnsInput.trim())) {
			dnsServers = [...dnsServers, dnsInput.trim()];
			dnsInput = '';
		}
	}

	function removeDnsServer(server: string) {
		dnsServers = dnsServers.filter(s => s !== server);
	}

	function addDnsSearch() {
		if (dnsSearchInput.trim() && !dnsSearch.includes(dnsSearchInput.trim())) {
			dnsSearch = [...dnsSearch, dnsSearchInput.trim()];
			dnsSearchInput = '';
		}
	}

	function removeDnsSearch(domain: string) {
		dnsSearch = dnsSearch.filter(d => d !== domain);
	}

	function addDnsOption() {
		if (dnsOptionInput.trim() && !dnsOptions.includes(dnsOptionInput.trim())) {
			dnsOptions = [...dnsOptions, dnsOptionInput.trim()];
			dnsOptionInput = '';
		}
	}

	function removeDnsOption(option: string) {
		dnsOptions = dnsOptions.filter(o => o !== option);
	}

	function applyConfigSet(configSetId: string) {
		selectedConfigSetId = configSetId;
		if (!configSetId) return;

		const configSet = configSets.find((c) => c.id === parseInt(configSetId));
		if (!configSet) return;

		if (configSet.envVars && configSet.envVars.length > 0) {
			if (mode === 'edit') {
				// Merge mode for edit
				const existingKeys = new Set(envVars.map(e => e.key).filter(k => k));
				const newEnvVars = configSet.envVars.filter(e => !existingKeys.has(e.key));
				envVars = [...envVars.filter(e => e.key), ...newEnvVars.map(e => ({ ...e }))];
				if (envVars.length === 0) envVars = [{ key: '', value: '' }];
			} else {
				envVars = configSet.envVars.map((e) => ({ ...e }));
			}
		}
		if (configSet.labels && configSet.labels.length > 0) {
			if (mode === 'edit') {
				const existingKeys = new Set(labels.map(l => l.key).filter(k => k));
				const newLabels = configSet.labels.filter(l => !existingKeys.has(l.key));
				labels = [...labels.filter(l => l.key), ...newLabels.map(l => ({ ...l }))];
				if (labels.length === 0) labels = [{ key: '', value: '' }];
			} else {
				labels = configSet.labels.map((l) => ({ ...l }));
			}
		}
		if (configSet.ports && configSet.ports.length > 0) {
			if (mode === 'edit') {
				const existingPorts = new Set(portMappings.map(p => `${p.hostPort}:${p.containerPort}`).filter(p => p !== ':'));
				const newPorts = configSet.ports.filter(p => !existingPorts.has(`${p.hostPort}:${p.containerPort}`));
				portMappings = [...portMappings.filter(p => p.hostPort || p.containerPort), ...newPorts.map(p => ({ ...p }))];
				if (portMappings.length === 0) portMappings = [{ hostPort: '', containerPort: '', protocol: 'tcp' }];
			} else {
				portMappings = configSet.ports.map((p) => ({ ...p }));
			}
		}
		if (configSet.volumes && configSet.volumes.length > 0) {
			if (mode === 'edit') {
				const existingPaths = new Set(volumeMappings.map(v => v.containerPath).filter(p => p));
				const newVolumes = configSet.volumes.filter(v => !existingPaths.has(v.containerPath));
				volumeMappings = [...volumeMappings.filter(v => v.hostPath || v.containerPath), ...newVolumes.map(v => ({ ...v }))];
				if (volumeMappings.length === 0) volumeMappings = [{ hostPath: '', containerPath: '', mode: 'rw' }];
			} else {
				volumeMappings = configSet.volumes.map((v) => ({ ...v }));
			}
		}
		if (configSet.networkMode) {
			networkMode = configSet.networkMode;
		}
		if (configSet.restartPolicy) {
			restartPolicy = configSet.restartPolicy;
		}
	}

	function getDriverBadgeClasses(driver: string): string {
		const base = 'text-2xs px-1.5 py-0.5 rounded font-medium';
		switch (driver.toLowerCase()) {
			case 'bridge': return `${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300`;
			case 'host': return `${base} bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300`;
			case 'null': case 'none': return `${base} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400`;
			case 'overlay': return `${base} bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300`;
			case 'macvlan': return `${base} bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300`;
			default: return `${base} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400`;
		}
	}
</script>

<div class="space-y-5">
	<!-- Image Summary (create mode only) -->
	{#if mode === 'create' && imageSummary}
		<div class="p-3 rounded-lg bg-muted/50 border">
			<div class="flex items-center gap-3">
				<Package class="w-5 h-5 text-muted-foreground" />
				<div>
					<p class="text-sm font-medium">镜像： <code class="bg-muted px-1.5 py-0.5 rounded">{image || '未设置'}</code></p>
					{#if imageSummary.isPulling || imageSummary.isScanning}
						<p class="text-xs text-blue-600 flex items-center gap-1 mt-0.5">
							<Loader2 class="w-3 h-3 animate-spin" />
							{imageSummary.isScanning ? '扫描中...' : '拉取中...'}
						</p>
					{:else if imageSummary.imageReady}
						<p class="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
							<CheckCircle2 class="w-3 h-3" />
							镜像已拉取并就绪
							{#if imageSummary.scanResults && imageSummary.scanResults.length > 0}
								• <span class="{imageSummary.hasCriticalOrHigh ? 'text-red-600' : (imageSummary.totalVulnerabilities ?? 0) > 0 ? 'text-amber-600' : 'text-green-600'}">{imageSummary.totalVulnerabilities ?? 0} 个漏洞</span>
							{/if}
						</p>
					{:else if !image}
						<p class="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
							<AlertTriangle class="w-3 h-3" />
							请前往 “拉取” 标签页设置镜像
						</p>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Config Set Selector -->
	{#if configSets.length > 0}
		<div class="space-y-2">
			<div class="flex items-center gap-2 pb-2 border-b">
				<Settings2 class="w-4 h-4 text-muted-foreground" />
				<h3 class="text-sm font-semibold text-foreground">{mode === 'edit' ? '应用配置集' : '配置集'}</h3>
			</div>
			<div class="flex gap-2 items-end">
				<div class="flex-1">
					<Select.Root type="single" value={selectedConfigSetId} onValueChange={applyConfigSet}>
						<Select.Trigger class="w-full h-9">
							<span>{selectedConfigSetId ? configSets.find(c => c.id === parseInt(selectedConfigSetId))?.name : (mode === 'edit' ? '选择配置集以合并参数...' : '选择配置集以预填充参数...')}</span>
						</Select.Trigger>
						<Select.Content>
							{#each configSets as configSet}
								<Select.Item value={String(configSet.id)} label={configSet.name}>
									<div class="flex flex-col">
										<span>{configSet.name}</span>
										{#if configSet.description}
											<span class="text-xs text-muted-foreground">{configSet.description}</span>
										{/if}
									</div>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>
			{#if mode === 'edit'}
				<p class="text-xs text-muted-foreground">注意：配置集中的参数将与现有设置合并，不会覆盖已有键值。</p>
			{/if}
		</div>
	{/if}

	<!-- Basic Settings -->
	<div class="space-y-3">
		<div class="flex items-center gap-2 pb-2 border-b">
			<h3 class="text-sm font-semibold text-foreground">基础设置</h3>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div class="space-y-1.5">
				<Label for="name" class="text-xs font-medium">容器名称 *</Label>
				<Input
					id="name"
					bind:value={name}
					placeholder="my-container"
					required
					class="h-9 {errors.name ? 'border-destructive focus-visible:ring-destructive' : ''}"
					oninput={() => errors.name = undefined}
				/>
				{#if errors.name}
					<p class="text-xs text-destructive">{errors.name}</p>
				{/if}
			</div>
			{#if mode === 'edit'}
				<div class="space-y-1.5">
					<Label for="image" class="text-xs font-medium">镜像 *</Label>
					<Input
						id="image"
						bind:value={image}
						placeholder="nginx:latest"
						required
						class="h-9 {errors.image ? 'border-destructive focus-visible:ring-destructive' : ''}"
						oninput={() => errors.image = undefined}
					/>
					{#if errors.image}
						<p class="text-xs text-destructive">{errors.image}</p>
					{/if}
				</div>
			{/if}
		</div>

		<div class="space-y-1.5">
			<Label for="command" class="text-xs font-medium">启动命令 (可选)</Label>
			<Input id="command" bind:value={command} placeholder="/bin/sh -c 'echo hello'" class="h-9" />
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div class="space-y-1.5">
				<Label class="text-xs font-medium">重启策略</Label>
				<Select.Root type="single" bind:value={restartPolicy}>
					<Select.Trigger id="restartPolicy" tabindex={0} class="w-full h-9">
						<span class="flex items-center">
							{#if restartPolicy === 'no'}
								<Ban class="w-3.5 h-3.5 mr-2 text-muted-foreground" />
							{:else if restartPolicy === 'always'}
								<RotateCw class="w-3.5 h-3.5 mr-2 text-green-500" />
							{:else if restartPolicy === 'on-failure'}
								<AlertTriangle class="w-3.5 h-3.5 mr-2 text-amber-500" />
							{:else}
								<PauseCircle class="w-3.5 h-3.5 mr-2 text-blue-500" />
							{/if}
							{restartPolicy === 'no' ? '不重启' : restartPolicy === 'always' ? '始终重启' : restartPolicy === 'on-failure' ? '失败时重启' : '除非手动停止'}
						</span>
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="no">
							{#snippet children()}
								<Ban class="w-3.5 h-3.5 mr-2 text-muted-foreground" />
								不重启
							{/snippet}
						</Select.Item>
						<Select.Item value="always">
							{#snippet children()}
								<RotateCw class="w-3.5 h-3.5 mr-2 text-green-500" />
								始终重启
							{/snippet}
						</Select.Item>
						<Select.Item value="on-failure">
							{#snippet children()}
								<AlertTriangle class="w-3.5 h-3.5 mr-2 text-amber-500" />
								失败时重启
							{/snippet}
						</Select.Item>
						<Select.Item value="unless-stopped">
							{#snippet children()}
								<PauseCircle class="w-3.5 h-3.5 mr-2 text-blue-500" />
								除非手动停止
							{/snippet}
						</Select.Item>
					</Select.Content>
				</Select.Root>
				{#if restartPolicy === 'on-failure'}
					<div class="space-y-1.5 mt-2">
						<Label class="text-xs font-medium">最大重试次数</Label>
						<Input
							type="number"
							bind:value={restartMaxRetries}
							placeholder="无限制"
							min="0"
							class="h-9"
						/>
						<p class="text-xs text-muted-foreground">留空表示无限制重试</p>
					</div>
				{/if}
			</div>

			<div class="space-y-1.5">
				<Label class="text-xs font-medium">网络</Label>
				<Popover.Root bind:open={networkModePickerOpen}>
					<Popover.Trigger bind:ref={networkModePickerTriggerRef}>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="outline"
								class="w-full justify-between font-normal"
								role="combobox"
								aria-expanded={networkModePickerOpen}
							>
								<span class="flex items-center min-w-0 flex-1">
									{#if networkModeType === 'bridge'}
										<Share2 class="w-3.5 h-3.5 mr-2 shrink-0 text-emerald-500" />
									{:else if networkModeType === 'host'}
										<Server class="w-3.5 h-3.5 mr-2 shrink-0 text-sky-500" />
									{:else if networkModeType === 'none'}
										<CircleOff class="w-3.5 h-3.5 mr-2 shrink-0 text-muted-foreground" />
									{:else if networkModeType === 'container'}
										<Box class="w-3.5 h-3.5 mr-2 shrink-0 text-violet-500" />
									{:else}
										<Network class="w-3.5 h-3.5 mr-2 shrink-0 text-orange-500" />
									{/if}
									<span class="truncate">{networkModeLabel}</span>
								</span>
								<ChevronsUpDown class="w-4 h-4 shrink-0 opacity-50" />
							</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content class="w-[var(--bits-popover-anchor-width)] p-0" align="start">
						<Command.Root>
							<Command.Input placeholder="筛选网络..." />
							<Command.List class="max-h-64">
								<Command.Empty>未找到网络。</Command.Empty>
								<Command.Group>
									<Command.Item value="bridge" onSelect={() => { networkMode = 'bridge'; closeAndFocusNetworkModePicker(); }}>
										<Share2 class="text-emerald-500" />
										<span>桥接</span>
									</Command.Item>
									<Command.Item value="host" onSelect={() => { networkMode = 'host'; closeAndFocusNetworkModePicker(); }}>
										<Server class="text-sky-500" />
										<span>主机</span>
									</Command.Item>
									<Command.Item value="none" onSelect={() => { networkMode = 'none'; closeAndFocusNetworkModePicker(); }}>
										<CircleOff class="text-muted-foreground" />
										<span>无</span>
									</Command.Item>
									<Command.Item value="container" onSelect={() => { if (!networkMode.startsWith('container:')) networkMode = 'container:'; closeAndFocusNetworkModePicker(); }}>
										<Box class="text-violet-500" />
										<span>容器</span>
									</Command.Item>
								</Command.Group>
								{#if customNetworks.length > 0}
									<Command.Separator />
									<Command.Group heading="自定义网络">
										{#each customNetworks as n (n.name)}
											<Command.Item value={n.name} onSelect={() => { networkMode = n.name; closeAndFocusNetworkModePicker(); }}>
												<Network class="text-orange-500" />
												<span class="font-medium">{n.name}</span>
												<span class="{getDriverBadgeClasses(n.driver)} ml-auto">{n.driver}</span>
											</Command.Item>
										{/each}
									</Command.Group>
								{/if}
							</Command.List>
						</Command.Root>
					</Popover.Content>
				</Popover.Root>
				{#if networkModeType === 'container'}
					<Popover.Root bind:open={containerPickerOpen}>
						<Popover.Trigger bind:ref={containerPickerTriggerRef}>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									class="w-full mt-2 justify-between font-normal"
									role="combobox"
									aria-expanded={containerPickerOpen}
								>
									<span class="truncate min-w-0 flex-1 text-left {containerRef ? '' : 'text-muted-foreground'}">
										{containerRef || '选择容器...'}
									</span>
									<ChevronsUpDown class="w-4 h-4 shrink-0 opacity-50" />
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-[var(--bits-popover-anchor-width)] p-0" align="start">
							<Command.Root>
								<Command.Input placeholder="按名称筛选..." />
								<Command.List class="max-h-64">
									<Command.Empty>未找到容器。</Command.Empty>
									<Command.Group>
										{#each availableContainers as c (c.id)}
											<Command.Item
												value={c.name}
												onSelect={() => {
													networkMode = `container:${c.name}`;
													closeAndFocusContainerPicker();
												}}
											>
												<Check class={containerRef !== c.name ? 'text-transparent' : ''} />
												<span class="w-1.5 h-1.5 shrink-0 rounded-full {c.state === 'running' ? 'bg-green-500' : 'bg-muted-foreground/40'}"></span>
												<span class="font-medium">{c.name}</span>
												<span class="text-muted-foreground text-xs ml-auto truncate">{c.image}</span>
											</Command.Item>
										{/each}
									</Command.Group>
								</Command.List>
							</Command.Root>
						</Popover.Content>
					</Popover.Root>
					{#if !containerRef}
						<p class="text-xs text-amber-600 mt-1">选择一个容器以共享其网络命名空间</p>
					{/if}
				{/if}
			</div>
		</div>

		<div class="flex items-center gap-3 pt-1">
			<Label class="text-xs font-normal">更新前拉取最新镜像</Label>
			<TogglePill bind:checked={repullImage} />
		</div>

		<div class="flex items-center gap-3 pt-1">
			<Label class="text-xs font-normal">{mode === 'create' ? '创建后' : '更新后'}启动容器</Label>
			<TogglePill bind:checked={startAfterCreate} />
		</div>
	</div>

	<!-- Additional networks (hidden for host/none/container:X modes — Docker rejects extras) -->
	{#if availableNetworks.length > 0 && networkModeType !== 'host' && networkModeType !== 'none' && networkModeType !== 'container'}
		<div class="space-y-2">
			<div class="flex justify-between items-center pb-2 border-b">
				<div class="flex items-center gap-2">
					<Network class="w-4 h-4 text-muted-foreground" />
					<h3 class="text-sm font-semibold text-foreground">附加网络</h3>
				</div>
			</div>

			<div class="space-y-2">
				{#if selectableNetworks.length === 0}
					<Button variant="outline" disabled class="w-full justify-start font-normal text-muted-foreground">
						所有网络已全部挂载
					</Button>
				{:else}
					<Popover.Root bind:open={networkPickerOpen}>
						<Popover.Trigger bind:ref={networkPickerTriggerRef}>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									class="w-full justify-between font-normal"
									role="combobox"
									aria-expanded={networkPickerOpen}
								>
									<span class="text-muted-foreground">选择要添加的网络...</span>
									<ChevronsUpDown class="w-4 h-4 opacity-50" />
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-[var(--bits-popover-anchor-width)] p-0" align="start">
							<Command.Root>
								<Command.Input placeholder="筛选网络..." />
								<Command.List class="max-h-64">
									<Command.Empty>未找到网络。</Command.Empty>
									<Command.Group>
										{#each selectableNetworks as network (network.name)}
											<Command.Item
												value={network.name}
												onSelect={() => {
													addNetwork(network.name);
													closeAndFocusNetworkPicker();
												}}
											>
												<span class="font-medium">{network.name}</span>
												<span class="{getDriverBadgeClasses(network.driver)} ml-auto">{network.driver}</span>
											</Command.Item>
										{/each}
									</Command.Group>
								</Command.List>
							</Command.Root>
						</Popover.Content>
					</Popover.Root>
				{/if}

				{#if selectedNetworks.filter(n => n !== networkMode).length > 0}
					<div class="space-y-1 pt-1">
						{#each selectedNetworks.filter(n => n !== networkMode) as networkName}
							{@const network = availableNetworks.find(n => n.name === networkName)}
							{@const isExpanded = expandedNetworks.has(networkName)}
							<div class="border rounded-md">
								<div class="flex items-center justify-between px-2.5 py-1.5">
									<button
										type="button"
										onclick={() => { ensureNetworkConfig(networkName); toggleNetworkExpand(networkName); }}
										class="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors"
									>
										{#if isExpanded}
											<ChevronDown class="w-3.5 h-3.5 text-muted-foreground" />
										{:else}
											<ChevronRight class="w-3.5 h-3.5 text-muted-foreground" />
										{/if}
										<span>{networkName}</span>
										{#if network}
											<span class={getDriverBadgeClasses(network.driver)}>{network.driver}</span>
										{/if}
										{#if hasNetworkConfig(networkName)}
											<Badge variant="secondary" class="text-2xs">已配置</Badge>
										{/if}
									</button>
									<button
										type="button"
										onclick={() => removeNetwork(networkName)}
										class="p-0.5 hover:bg-destructive/20 rounded text-muted-foreground hover:text-destructive"
									>
										<X class="w-3.5 h-3.5" />
									</button>
								</div>
								{#if isExpanded && networkConfigs[networkName]}
									<div class="px-2.5 pb-2.5 pt-1 border-t space-y-2">
										<div class="grid grid-cols-2 gap-2">
											<div class="space-y-1">
												<Label class="text-2xs font-medium text-muted-foreground">IPv4 地址</Label>
												<Input
													bind:value={networkConfigs[networkName].ipv4Address}
													placeholder="例如：172.28.0.100"
													class="h-8 text-xs"
												/>
												{#if validateIpv4(networkConfigs[networkName].ipv4Address)}
													<p class="text-2xs text-destructive">{validateIpv4(networkConfigs[networkName].ipv4Address)}</p>
												{/if}
											</div>
											<div class="space-y-1">
												<Label class="text-2xs font-medium text-muted-foreground">IPv6 地址</Label>
												<Input
													bind:value={networkConfigs[networkName].ipv6Address}
													placeholder="例如：fd00::100"
													class="h-8 text-xs"
												/>
												{#if validateIpv6(networkConfigs[networkName].ipv6Address)}
													<p class="text-2xs text-destructive">{validateIpv6(networkConfigs[networkName].ipv6Address)}</p>
												{/if}
											</div>
										</div>
										<div class="space-y-1">
											<Label class="text-2xs font-medium text-muted-foreground">别名 (逗号分隔)</Label>
											<Input
												bind:value={networkConfigs[networkName].aliases}
												placeholder="例如：myalias, web"
												class="h-8 text-xs"
											/>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<!-- MAC Address -->
				<div class="space-y-1 pt-1">
					<Label class="text-xs font-medium">MAC 地址</Label>
					<Input
						bind:value={macAddress}
						placeholder="例如：02:42:ac:11:00:02"
						class="h-9"
					/>
					{#if validateMac(macAddress)}
						<p class="text-xs text-destructive">{validateMac(macAddress)}</p>
					{/if}
				</div>

				{#if mode === 'edit'}
					<p class="text-xs text-muted-foreground">容器将连接到所选网络，同时保留上方设置的网络模式</p>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Port Mappings -->
	<div class="space-y-2">
		<div class="flex justify-between items-center pb-2 border-b">
			<h3 class="text-sm font-semibold text-foreground">端口映射</h3>
			<Button type="button" size="sm" variant="ghost" onclick={addPortMapping} class="h-7 text-xs">
				<Plus class="w-3.5 h-3.5" />
				添加
			</Button>
		</div>

		<div class="space-y-2">
			{#each portMappings as mapping, index}
				{@const parsed = parseHostPort(mapping.hostPort)}
				{@const hostPortError = validatePort(parsed.hostPort)}
				{@const hostIpError = validateIp(parsed.hostIp)}
				{@const containerPortError = validatePort(mapping.containerPort)}
				<div class="flex flex-col gap-1">
					<div class="flex gap-2 items-center">
						<div class="flex-1 relative group/port">
							<span class="absolute -top-2 left-2 text-2xs text-muted-foreground bg-background px-1">主机端口</span>
							<Input bind:value={mapping.hostPort} type="text" placeholder="例如：8080 或 127.0.0.1:8080" class="h-9 {(hostPortError || hostIpError) && mapping.hostPort ? 'border-destructive' : ''}" />
							<button
								type="button"
								class="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-primary transition-colors opacity-0 group-hover/port:opacity-100"
								onclick={() => findFreePort(index)}
								disabled={findingFreePort}
								title="查找下一个可用的 Docker 端口"
							>
								{#if findingFreePort}
									<Loader2 class="w-3.5 h-3.5 animate-spin" />
								{:else}
									<Search class="w-3.5 h-3.5" />
								{/if}
							</button>
						</div>
						<div class="flex-1 relative">
							<span class="absolute -top-2 left-2 text-2xs text-muted-foreground bg-background px-1">容器端口</span>
							<Input bind:value={mapping.containerPort} type="text" placeholder="例如：8080 或 8000-8005" class="h-9 {containerPortError && mapping.containerPort ? 'border-destructive' : ''}" />
						</div>
					<ToggleGroup
						value={mapping.protocol}
						options={protocolOptions}
						onchange={(v) => { portMappings[index].protocol = v; }}
					/>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						onclick={() => removePortMapping(index)}
						disabled={portMappings.length === 1}
						class="h-9 w-9 text-muted-foreground hover:text-destructive"
					>
						<Trash2 class="w-4 h-4" />
					</Button>
				</div>
				{#if (hostPortError && mapping.hostPort) || (hostIpError && mapping.hostPort) || (containerPortError && mapping.containerPort)}
					<p class="text-xs text-destructive pl-1">{hostIpError || hostPortError || containerPortError}</p>
				{/if}
				</div>
			{/each}
		</div>
		<p class="text-xs text-muted-foreground flex items-center gap-1.5">
			<Tooltip.Provider>
				<Tooltip.Root>
					<Tooltip.Trigger>
						<CircleHelp class="w-3.5 h-3.5 text-muted-foreground/70 cursor-help shrink-0" />
					</Tooltip.Trigger>
					<Tooltip.Content class="max-w-xs text-xs" side="right">
						<p class="font-medium mb-1">支持的主机端口格式：</p>
						<ul class="space-y-0.5 text-muted-foreground">
							<li><code class="text-foreground">8080</code> — 绑定到所有网卡</li>
							<li><code class="text-foreground">127.0.0.1:8080</code> — 绑定到指定IP</li>
							<li><code class="text-foreground">8000-8005</code> — 端口范围 (容器端口也必须为范围格式)</li>
							<li>主机端口留空将随机分配端口</li>
						</ul>
					</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
			将鼠标悬停在主机端口输入框并点击搜索图标，可查找下一个可用端口。
		</p>
	</div>

	<!-- Volume Mappings -->
	<div class="space-y-2">
		<div class="flex justify-between items-center pb-2 border-b">
			<h3 class="text-sm font-semibold text-foreground">数据卷映射</h3>
			<Button type="button" size="sm" variant="ghost" onclick={addVolumeMapping} class="h-7 text-xs">
				<Plus class="w-3.5 h-3.5" />
				添加
			</Button>
		</div>

		<div class="space-y-2">
			{#each volumeMappings as mapping, index}
				<div class="flex gap-2 items-center">
					<div class="flex-1 relative">
						<span class="absolute -top-2 left-2 text-2xs text-muted-foreground bg-background px-1">主机路径</span>
						<Input bind:value={mapping.hostPath} class="h-9" />
					</div>
					<div class="flex-1 relative">
						<span class="absolute -top-2 left-2 text-2xs text-muted-foreground bg-background px-1">容器路径</span>
						<Input bind:value={mapping.containerPath} class="h-9" />
					</div>
					<ToggleGroup
						value={mapping.mode}
						options={volumeModeOptions}
						onchange={(v) => { volumeMappings[index].mode = v; }}
					/>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						onclick={() => removeVolumeMapping(index)}
						disabled={volumeMappings.length === 1}
						class="h-9 w-9 text-muted-foreground hover:text-destructive"
					>
						<Trash2 class="w-4 h-4" />
					</Button>
				</div>
			{/each}
		</div>
	</div>

	<!-- Environment Variables -->
	<div class="space-y-2">
		<div class="flex justify-between items-center pb-2 border-b">
			<h3 class="text-sm font-semibold text-foreground">环境变量</h3>
			<Button type="button" size="sm" variant="ghost" onclick={addEnvVar} class="h-7 text-xs">
				<Plus class="w-3.5 h-3.5" />
				添加
			</Button>
		</div>

		<div class="space-y-2">
			{#each envVars as envVar, index}
				<div class="flex gap-2 items-center">
					<div class="flex-1 relative">
						<span class="absolute -top-2 left-2 text-2xs text-muted-foreground bg-background px-1">键</span>
						<Input bind:value={envVar.key} class="h-9" />
					</div>
					<div class="flex-1 relative">
						<span class="absolute -top-2 left-2 text-2xs text-muted-foreground bg-background px-1">值</span>
						<Input bind:value={envVar.value} class="h-9" />
					</div>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						onclick={() => removeEnvVar(index)}
						disabled={envVars.length === 1}
						class="h-9 w-9 text-muted-foreground hover:text-destructive"
					>
						<Trash2 class="w-4 h-4" />
					</Button>
				</div>
			{/each}
		</div>
	</div>

	<!-- Labels -->
	<div class="space-y-2">
		<div class="flex justify-between items-center pb-2 border-b">
			<h3 class="text-sm font-semibold text-foreground">标签</h3>
			<Button type="button" size="sm" variant="ghost" onclick={addLabel} class="h-7 text-xs">
				<Plus class="w-3.5 h-3.5" />
				添加
			</Button>
		</div>

		<div class="space-y-2">
			{#each labels as label, index}
				<div class="flex gap-2 items-center">
					<div class="flex-1 relative">
						<span class="absolute -top-2 left-2 text-2xs text-muted-foreground bg-background px-1">键</span>
						<Input bind:value={label.key} class="h-9" />
					</div>
					<div class="flex-1 relative">
						<span class="absolute -top-2 left-2 text-2xs text-muted-foreground bg-background px-1">值</span>
						<Input bind:value={label.value} class="h-9" />
					</div>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						onclick={() => removeLabel(index)}
						disabled={labels.length <= 1 && !labels[0]?.key}
						class="h-9 w-9 text-muted-foreground hover:text-destructive"
					>
						<Trash2 class="w-4 h-4" />
					</Button>
				</div>
			{/each}
		</div>
	</div>

	<!-- Advanced Options Header -->
	<div class="pt-2">
		<p class="text-xs text-muted-foreground mb-3">高级容器选项 (点击展开)</p>
	</div>

	<!-- Resources Section (Collapsible) -->
	<div class="border rounded-lg">
		<button
			type="button"
			onclick={() => showResources = !showResources}
			class="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
		>
			<div class="flex items-center gap-2">
				<Cpu class="w-4 h-4 text-muted-foreground" />
				<span class="text-sm font-medium">资源限制</span>
				{#if memoryLimit || nanoCpus || cpuShares}
					<Badge variant="secondary" class="text-2xs">已配置</Badge>
				{/if}
			</div>
			{#if showResources}
				<ChevronDown class="w-4 h-4 text-muted-foreground" />
			{:else}
				<ChevronRight class="w-4 h-4 text-muted-foreground" />
			{/if}
		</button>
		{#if showResources}
			<div class="px-3 pb-3 space-y-3 border-t">
				<p class="text-xs text-muted-foreground pt-2">配置容器的内存与 CPU 限制</p>
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1.5">
						<Label for="memoryLimit" class="text-xs font-medium">内存限制</Label>
						<Input id="memoryLimit" bind:value={memoryLimit} placeholder="例如： 512m, 1g" class="h-9" />
					</div>
					<div class="space-y-1.5">
						<Label for="memoryReservation" class="text-xs font-medium">内存预留</Label>
						<Input id="memoryReservation" bind:value={memoryReservation} placeholder="例如： 256m" class="h-9" />
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1.5">
						<Label for="nanoCpus" class="text-xs font-medium">CPU 限制</Label>
						<Input id="nanoCpus" bind:value={nanoCpus} placeholder="例如： 0.5, 1.5, 2" class="h-9" />
					</div>
					<div class="space-y-1.5">
						<Label for="cpuShares" class="text-xs font-medium">CPU 共享值</Label>
						<Input id="cpuShares" bind:value={cpuShares} type="number" placeholder="1024" class="h-9" />
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1.5">
						<Label for="cpuQuota" class="text-xs font-medium">CPU 配额</Label>
						<Input id="cpuQuota" bind:value={cpuQuota} type="number" placeholder="例如： 50000" class="h-9" />
						<p class="text-xs text-muted-foreground">微秒/每个周期</p>
					</div>
					<div class="space-y-1.5">
						<Label for="cpuPeriod" class="text-xs font-medium">CPU 周期</Label>
						<Input id="cpuPeriod" bind:value={cpuPeriod} type="number" placeholder="默认： 100000" class="h-9" />
						<p class="text-xs text-muted-foreground">周期时长，单位微秒</p>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Security Section (Collapsible) -->
	<div class="border rounded-lg">
		<button
			type="button"
			onclick={() => showSecurity = !showSecurity}
			class="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
		>
			<div class="flex items-center gap-2">
				<Shield class="w-4 h-4 text-muted-foreground" />
				<span class="text-sm font-medium">安全</span>
				{#if privilegedMode || containerUser || capAdd.length > 0 || capDrop.length > 0 || securityOptions.length > 0}
					<Badge variant="secondary" class="text-2xs">已配置</Badge>
				{/if}
			</div>
			{#if showSecurity}
				<ChevronDown class="w-4 h-4 text-muted-foreground" />
			{:else}
				<ChevronRight class="w-4 h-4 text-muted-foreground" />
			{/if}
		</button>
		{#if showSecurity}
			<div class="px-3 pb-3 space-y-3 border-t">
				<div class="grid grid-cols-2 gap-3 pt-2">
					<div class="space-y-1.5">
						<Label for="containerUser" class="text-xs font-medium">运行用户</Label>
						<Input id="containerUser" bind:value={containerUser} placeholder="用户:组 或 UID:GID" class="h-9" />
					</div>
					<div class="space-y-1.5 flex flex-col justify-center pt-4">
						<div class="flex items-center space-x-2">
							<Checkbox id="privilegedMode" bind:checked={privilegedMode} />
							<Label for="privilegedMode" class="text-xs font-normal flex items-center gap-1">
								<Lock class="w-3 h-3 text-amber-500" />
								特权模式
							</Label>
						</div>
					</div>
				</div>

				<div class="space-y-2">
					<Label class="text-xs font-medium">添加权限</Label>
					<Select.Root type="single" value="" onValueChange={(v) => { addCapability('add', v); }}>
						<Select.Trigger class="h-9">
							<span class="text-muted-foreground">选择要添加的权限...</span>
						</Select.Trigger>
						<Select.Content>
							{#each commonCapabilities.filter(c => !capAdd.includes(c)) as cap}
								<Select.Item value={cap} label={cap} />
							{/each}
						</Select.Content>
					</Select.Root>
					{#if capAdd.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each capAdd as cap}
								<Badge variant="outline" class="text-2xs bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400">
									+{cap}
									<button type="button" onclick={() => removeCapability('add', cap)} class="ml-1 hover:text-destructive">
										<X class="w-3 h-3" />
									</button>
								</Badge>
							{/each}
						</div>
					{/if}
				</div>

				<div class="space-y-2">
					<Label class="text-xs font-medium">移除权限</Label>
					<Select.Root type="single" value="" onValueChange={(v) => { addCapability('drop', v); }}>
						<Select.Trigger class="h-9">
							<span class="text-muted-foreground">选择要移除的权限...</span>
						</Select.Trigger>
						<Select.Content>
							{#each commonCapabilities.filter(c => !capDrop.includes(c)) as cap}
								<Select.Item value={cap} label={cap} />
							{/each}
						</Select.Content>
					</Select.Root>
					{#if capDrop.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each capDrop as cap}
								<Badge variant="outline" class="text-2xs bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400">
									-{cap}
									<button type="button" onclick={() => removeCapability('drop', cap)} class="ml-1 hover:text-destructive">
										<X class="w-3 h-3" />
									</button>
								</Badge>
							{/each}
						</div>
					{/if}
				</div>

				<div class="space-y-2 pt-2 border-t">
					<Label class="text-xs font-medium">安全选项</Label>
					<div class="flex gap-2">
						<Input
							bind:value={securityOptionInput}
							placeholder="例如： no-new-privileges, seccomp=unconfined"
							class="h-9 flex-1"
							onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSecurityOption(); } }}
						/>
						<Button type="button" size="sm" variant="outline" onclick={addSecurityOption} class="h-9">
							<Plus class="w-4 h-4" />
						</Button>
					</div>
					{#if securityOptions.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each securityOptions as option}
								<Badge variant="secondary" class="text-2xs">
									{option}
									<button type="button" onclick={() => removeSecurityOption(option)} class="ml-1 hover:text-destructive">
										<X class="w-3 h-3" />
									</button>
								</Badge>
							{/each}
						</div>
					{/if}
					<p class="text-xs text-muted-foreground">常用选项： no-new-privileges, seccomp=unconfined, apparmor=unconfined</p>
				</div>
			</div>
		{/if}
	</div>

	<!-- Health Section (Collapsible) -->
	<div class="border rounded-lg">
		<button
			type="button"
			onclick={() => showHealth = !showHealth}
			class="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
		>
			<div class="flex items-center gap-2">
				<HeartPulse class="w-4 h-4 text-muted-foreground" />
				<span class="text-sm font-medium">健康检查</span>
				{#if healthcheckEnabled}
					<Badge variant="secondary" class="text-2xs">已启用</Badge>
				{/if}
			</div>
			{#if showHealth}
				<ChevronDown class="w-4 h-4 text-muted-foreground" />
			{:else}
				<ChevronRight class="w-4 h-4 text-muted-foreground" />
			{/if}
		</button>
		{#if showHealth}
			<div class="px-3 pb-3 space-y-3 border-t">
				<div class="flex items-center space-x-2 pt-2">
					<Checkbox id="healthcheckEnabled" bind:checked={healthcheckEnabled} />
					<Label for="healthcheckEnabled" class="text-xs font-normal">启用健康检查</Label>
				</div>
				{#if healthcheckEnabled}
					<div class="space-y-1.5">
						<Label for="healthcheckCommand" class="text-xs font-medium">检查命令</Label>
						<Input id="healthcheckCommand" bind:value={healthcheckCommand} placeholder="例如： curl -f http://localhost/ || exit 1" class="h-9" />
					</div>
					<div class="grid grid-cols-4 gap-3">
						<div class="space-y-1.5">
							<Label for="healthcheckInterval" class="text-xs font-medium">检查间隔 (秒)</Label>
							<Input id="healthcheckInterval" type="number" bind:value={healthcheckInterval} min="1" class="h-9" />
						</div>
						<div class="space-y-1.5">
							<Label for="healthcheckTimeout" class="text-xs font-medium">超时时间 (秒)</Label>
							<Input id="healthcheckTimeout" type="number" bind:value={healthcheckTimeout} min="1" class="h-9" />
						</div>
						<div class="space-y-1.5">
							<Label for="healthcheckRetries" class="text-xs font-medium">重试次数</Label>
							<Input id="healthcheckRetries" type="number" bind:value={healthcheckRetries} min="1" class="h-9" />
						</div>
						<div class="space-y-1.5">
							<Label for="healthcheckStartPeriod" class="text-xs font-medium">启动等待 (秒)</Label>
							<Input id="healthcheckStartPeriod" type="number" bind:value={healthcheckStartPeriod} min="0" class="h-9" />
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- DNS Section (Collapsible) -->
	<div class="border rounded-lg">
		<button
			type="button"
			onclick={() => showDns = !showDns}
			class="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
		>
			<div class="flex items-center gap-2">
				<Wifi class="w-4 h-4 text-muted-foreground" />
				<span class="text-sm font-medium">DNS 设置</span>
				{#if dnsServers.length > 0 || dnsSearch.length > 0}
					<Badge variant="secondary" class="text-2xs">已配置</Badge>
				{/if}
			</div>
			{#if showDns}
				<ChevronDown class="w-4 h-4 text-muted-foreground" />
			{:else}
				<ChevronRight class="w-4 h-4 text-muted-foreground" />
			{/if}
		</button>
		{#if showDns}
			<div class="px-3 pb-3 space-y-3 border-t">
				<div class="space-y-2 pt-2">
					<Label class="text-xs font-medium">DNS 服务器</Label>
					<div class="flex gap-2">
						<Input
							bind:value={dnsInput}
							placeholder="例如： 8.8.8.8"
							class="h-9 flex-1"
							onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDnsServer(); } }}
						/>
						<Button type="button" size="sm" variant="outline" onclick={addDnsServer} class="h-9">
							<Plus class="w-4 h-4" />
						</Button>
					</div>
					{#if dnsServers.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each dnsServers as server}
								<Badge variant="secondary" class="text-2xs">
									{server}
									<button type="button" onclick={() => removeDnsServer(server)} class="ml-1 hover:text-destructive">
										<X class="w-3 h-3" />
									</button>
								</Badge>
							{/each}
						</div>
					{/if}
				</div>

				<!-- DNS Search domains -->
				<div class="space-y-2">
					<Label class="text-xs font-medium">DNS 搜索域</Label>
					<div class="flex gap-2">
						<Input
							bind:value={dnsSearchInput}
							placeholder="例如： example.com"
							class="h-9 flex-1"
							onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDnsSearch(); } }}
						/>
						<Button type="button" size="sm" variant="outline" onclick={addDnsSearch} class="h-9">
							<Plus class="w-4 h-4" />
						</Button>
					</div>
					{#if dnsSearch.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each dnsSearch as domain}
								<Badge variant="secondary" class="text-2xs">
									{domain}
									<button type="button" onclick={() => removeDnsSearch(domain)} class="ml-1 hover:text-destructive">
										<X class="w-3 h-3" />
									</button>
								</Badge>
							{/each}
						</div>
					{/if}
				</div>

				<!-- DNS Options -->
				<div class="space-y-2">
					<Label class="text-xs font-medium">DNS 选项</Label>
					<div class="flex gap-2">
						<Input
							bind:value={dnsOptionInput}
							placeholder="例如： ndots:5"
							class="h-9 flex-1"
							onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDnsOption(); } }}
						/>
						<Button type="button" size="sm" variant="outline" onclick={addDnsOption} class="h-9">
							<Plus class="w-4 h-4" />
						</Button>
					</div>
					{#if dnsOptions.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each dnsOptions as option}
								<Badge variant="secondary" class="text-2xs">
									{option}
									<button type="button" onclick={() => removeDnsOption(option)} class="ml-1 hover:text-destructive">
										<X class="w-3 h-3" />
									</button>
								</Badge>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- Devices Section (Collapsible) -->
	<div class="border rounded-lg">
		<button
			type="button"
			onclick={() => showDevices = !showDevices}
			class="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
		>
			<div class="flex items-center gap-2">
				<HardDrive class="w-4 h-4 text-muted-foreground" />
				<span class="text-sm font-medium">设备挂载</span>
				{#if deviceMappings.length > 0}
					<Badge variant="secondary" class="text-2xs">{deviceMappings.length}</Badge>
				{/if}
			</div>
			{#if showDevices}
				<ChevronDown class="w-4 h-4 text-muted-foreground" />
			{:else}
				<ChevronRight class="w-4 h-4 text-muted-foreground" />
			{/if}
		</button>
		{#if showDevices}
			<div class="px-3 pb-3 space-y-3 border-t">
				<div class="flex justify-end pt-2">
					<Button type="button" size="sm" variant="ghost" onclick={addDeviceMapping} class="h-7 text-xs">
						<Plus class="w-3.5 h-3.5" />
						添加设备
					</Button>
				</div>
				{#each deviceMappings as mapping, index}
					<div class="flex gap-2 items-center">
						<Input bind:value={mapping.hostPath} placeholder="/dev/sda" class="h-9 flex-1" />
						<Input bind:value={mapping.containerPath} placeholder="/dev/sda" class="h-9 flex-1" />
						<Button
							type="button"
							size="icon"
							variant="ghost"
							onclick={() => removeDeviceMapping(index)}
							class="h-9 w-9 text-muted-foreground hover:text-destructive"
						>
							<Trash2 class="w-4 h-4" />
						</Button>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- GPU Section (Collapsible) -->
	<div class="border rounded-lg">
		<button
			type="button"
			onclick={() => showGpu = !showGpu}
			class="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
		>
			<div class="flex items-center gap-2">
				<Gpu class="w-4 h-4 text-muted-foreground" />
				<span class="text-sm font-medium">GPU</span>
				{#if gpuEnabled}
					<Badge variant="secondary" class="text-2xs">已配置</Badge>
				{/if}
			</div>
			{#if showGpu}
				<ChevronDown class="w-4 h-4 text-muted-foreground" />
			{:else}
				<ChevronRight class="w-4 h-4 text-muted-foreground" />
			{/if}
		</button>
		{#if showGpu}
			<div class="px-3 pb-3 space-y-3 border-t">
				<div class="flex items-center justify-between pt-2">
					<Label class="text-xs font-medium">启用 GPU 访问</Label>
					<TogglePill bind:checked={gpuEnabled} />
				</div>

				<div class="space-y-1.5">
					<Label class="text-xs font-medium">运行时</Label>
					<div class="flex gap-2">
						<Select.Root type="single" value={runtime === '' ? '' : runtime === 'nvidia' ? 'nvidia' : 'custom'} onValueChange={(v) => {
							if (v === '') runtime = '';
							else if (v === 'nvidia') runtime = 'nvidia';
							else if (v === 'custom') runtime = customRuntimeInput || '';
						}}>
							<Select.Trigger class="h-9 flex-1">
								<span>{runtime === '' ? '默认（runc）' : runtime === 'nvidia' ? 'NVIDIA' : `自定义：${runtime}`}</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="" label="默认 (runc)" />
								<Select.Item value="nvidia" label="NVIDIA" />
								<Select.Item value="custom" label="自定义..." />
							</Select.Content>
						</Select.Root>
						{#if runtime !== '' && runtime !== 'nvidia'}
							<Input
								bind:value={customRuntimeInput}
								placeholder="运行时名称"
								class="h-9 w-40"
								oninput={() => { runtime = customRuntimeInput; }}
							/>
						{/if}
					</div>
				</div>

				{#if gpuEnabled}
					<div class="space-y-1.5">
						<Label class="text-xs font-medium">GPU 模式</Label>
						<ToggleGroup
							value={gpuMode}
							options={[
								{ value: 'all', label: '全部' },
								{ value: 'count', label: '数量' },
								{ value: 'specific', label: '指定设备' }
							]}
							onchange={(v) => { gpuMode = v as 'all' | 'count' | 'specific'; }}
						/>
					</div>

					{#if gpuMode === 'count'}
						<div class="space-y-1.5">
							<Label class="text-xs font-medium">GPU 数量</Label>
							<Input type="number" bind:value={gpuCount} min="1" placeholder="1" class="h-9 w-24" />
						</div>
					{/if}

					{#if gpuMode === 'specific'}
						<div class="space-y-2">
							<Label class="text-xs font-medium">设备 ID</Label>
							<div class="flex gap-2">
								<Input
									bind:value={gpuDeviceIdInput}
									placeholder="例如： 0, GPU-xxxx"
									class="h-9 flex-1"
									onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addGpuDeviceId(); } }}
								/>
								<Button type="button" size="sm" variant="outline" onclick={addGpuDeviceId} class="h-9">
									<Plus class="w-4 h-4" />
								</Button>
							</div>
							{#if gpuDeviceIds.length > 0}
								<div class="flex flex-wrap gap-1.5">
									{#each gpuDeviceIds as id}
										<Badge variant="secondary" class="text-2xs">
											{id}
											<button type="button" onclick={() => removeGpuDeviceId(id)} class="ml-1 hover:text-destructive">
												<X class="w-3 h-3" />
											</button>
										</Badge>
									{/each}
								</div>
							{/if}
						</div>
					{/if}

					<div class="space-y-1.5">
						<Label class="text-xs font-medium">驱动</Label>
						<Input bind:value={gpuDriver} placeholder="nvidia" class="h-9" />
					</div>

					<div class="space-y-2">
						<Label class="text-xs font-medium">功能权限</Label>
						<Select.Root type="single" value="" onValueChange={(v) => { addGpuCapability(v); }}>
							<Select.Trigger class="h-9">
								<span class="text-muted-foreground">添加功能权限...</span>
							</Select.Trigger>
							<Select.Content>
								{#each commonGpuCapabilities.filter(c => !gpuCapabilities.includes(c)) as cap}
									<Select.Item value={cap} label={cap} />
								{/each}
							</Select.Content>
						</Select.Root>
						{#if gpuCapabilities.length > 0}
							<div class="flex flex-wrap gap-1.5">
								{#each gpuCapabilities as cap}
									<Badge variant="outline" class="text-2xs bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
										{cap}
										<button type="button" onclick={() => removeGpuCapability(cap)} class="ml-1 hover:text-destructive">
											<X class="w-3 h-3" />
										</button>
									</Badge>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Ulimits Section (Collapsible) -->
	<div class="border rounded-lg">
		<button
			type="button"
			onclick={() => showUlimits = !showUlimits}
			class="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
		>
			<div class="flex items-center gap-2">
				<Settings2 class="w-4 h-4 text-muted-foreground" />
				<span class="text-sm font-medium">用户资源限制</span>
				{#if ulimits.length > 0}
					<Badge variant="secondary" class="text-2xs">{ulimits.length}</Badge>
				{/if}
			</div>
			{#if showUlimits}
				<ChevronDown class="w-4 h-4 text-muted-foreground" />
			{:else}
				<ChevronRight class="w-4 h-4 text-muted-foreground" />
			{/if}
		</button>
		{#if showUlimits}
			<div class="px-3 pb-3 space-y-3 border-t">
				<div class="flex justify-end pt-2">
					<Button type="button" size="sm" variant="ghost" onclick={addUlimit} class="h-7 text-xs">
						<Plus class="w-3.5 h-3.5" />
						添加资源限制
					</Button>
				</div>
				{#each ulimits as ulimit, index}
					<div class="flex gap-2 items-center">
						<Select.Root type="single" bind:value={ulimit.name}>
							<Select.Trigger class="w-32 h-9">
								<span>{ulimit.name}</span>
							</Select.Trigger>
							<Select.Content>
								{#each commonUlimits as name}
									<Select.Item value={name} label={name} />
								{/each}
							</Select.Content>
						</Select.Root>
						<Input bind:value={ulimit.soft} type="number" placeholder="软限制" class="h-9 flex-1" />
						<Input bind:value={ulimit.hard} type="number" placeholder="硬限制" class="h-9 flex-1" />
						<Button
							type="button"
							size="icon"
							variant="ghost"
							onclick={() => removeUlimit(index)}
							class="h-9 w-9 text-muted-foreground hover:text-destructive"
						>
							<Trash2 class="w-4 h-4" />
						</Button>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Auto-update Settings -->
	<div class="space-y-3">
		<div class="flex items-center gap-2 pb-2 border-b">
			<RefreshCw class="w-4 h-4 text-muted-foreground" />
			<h3 class="text-sm font-semibold text-foreground">自动更新</h3>
		</div>
		<AutoUpdateSettings
			bind:enabled={autoUpdateEnabled}
			bind:cronExpression={autoUpdateCronExpression}
			bind:vulnerabilityCriteria={vulnerabilityCriteria}
			systemContainer={detectSystemContainer(image)}
		/>
	</div>
</div>
