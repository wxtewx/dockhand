<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import cytoscape from "cytoscape";
	import {
		Box,
		Database,
		Network,
		ZoomIn,
		ZoomOut,
		Maximize2,
		RotateCcw,
		X,
		ChevronDown,
		Sun,
		Moon,
		LayoutGrid,
		GitBranch,
		Circle,
		Target,
		Sparkles,
		Share2,
		Server,
		Globe,
		MonitorSmartphone,
		Cpu,
		CircleOff,
	} from "lucide-svelte";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import type { NetworkInfo } from "$lib/types";
	import { getLabelText } from "$lib/types";

	interface Props {
		networks: NetworkInfo[];
		class?: string;
	}

	let { networks, class: className = "" }: Props = $props();

	let containerEl: HTMLDivElement | null = $state(null);
	let cy: cytoscape.Core | null = null;
	let graphInitialized = $state(false);
	let selectedNode = $state<any>(null);
	let selectedEdge = $state<any>(null);

	// Theme state
	let graphTheme = $state<"light" | "dark">("light");

	// Layout state
	type LayoutType = "breadthfirst" | "grid" | "circle" | "concentric" | "cose";
	let currentLayout = $state<LayoutType>("breadthfirst");
	let showLayoutMenu = $state(false);

	const layoutOptions: { value: LayoutType; label: string; icon: string }[] = [
		{ value: "breadthfirst", label: "树状", icon: "tree" },
		{ value: "grid", label: "网格", icon: "grid" },
		{ value: "circle", label: "环形", icon: "circle" },
		{ value: "concentric", label: "辐射", icon: "radial" },
		{ value: "cose", label: "力导向", icon: "force" },
	];

	function buildGraphElements(nets: NetworkInfo[]) {
		interface ContainerResult {
			containerId: string;
			containerName: string;
			networks: {
				ipv4: string;
				netName: string;
			}[];
		}
		const elements: cytoscape.ElementDefinition[] = [];
		const networks = nets;

		// Derive services from networks
		const serviceMap = networks.reduce<Record<string, ContainerResult>>((svcs, network) => {
			Object.entries(network.containers).forEach(([id, config]) => {
				if (!svcs[id]) {
					svcs[id] = {
						containerId: id,
						containerName: config.name,
						networks: [],
					};
				}

				svcs[id].networks.push({
					ipv4: config.ipv4Address,
					netName: network.name,
				});
			});

			return svcs;
		}, {});
		const services = Object.values(serviceMap);

		// Add service nodes
		services.forEach((service) => {
			elements.push({
				data: {
					id: `service-${service.containerName}`,
					label: service.containerName,
					caption: '',
					type: "service",
					config: service,
				},
			});
		});

		// Add network nodes
		networks.forEach((network) => {
			const driver = network.driver;
			elements.push({
				data: {
					id: `network-${network.name}`,
					label: network.name,
					caption: driver,
					type: "network",
					driver: driver,
					external: !network.internal,
					config: network,
				},
			});
		});

		services.forEach((service) => {
			const serviceNetworks = service.networks;
			if (serviceNetworks) {
				serviceNetworks.forEach((network) => {
					const netName = network.netName;
					const foundNetwork = networks.find(n => n.name === netName);

					if (foundNetwork) {
						const targetId = `network-${netName}`;
						elements.push({
							data: {
								id: `net-${service.containerName}-${netName}`,
								source: `service-${service.containerName}`,
								target: targetId,
								type: "network-connection",
							},
						});
					}
				});
			}
		});

		return elements;
	}

	// SVG icons as data URLs for nodes
	function getSvgIcon(type: string, color: string): string {
		const icons: Record<string, string> = {
			service: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
			network: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>`,
		};
		const svg = icons[type] || icons.service;
		return `data:image/svg+xml,${encodeURIComponent(svg)}`;
	}

	function createGraph(useExistingData = false, skipLayout = false) {
		if (!containerEl) return;

		if (!networks) {
			networks = [];
		}

		const elements = buildGraphElements(networks);

		let savedPositions: Map<string, { x: number; y: number }> | null = null;
		if (skipLayout && cy) {
			savedPositions = new Map();
			cy.nodes().forEach((node) => {
				const pos = node.position();
				savedPositions!.set(node.id(), { x: pos.x, y: pos.y });
			});
		}

		if (cy) {
			cy.destroy();
		}

		const isDark = graphTheme === "dark";
		const colors = {
			service: {
				bg: isDark ? "#3b82f6" : "#dbeafe",
				border: isDark ? "#2563eb" : "#93c5fd",
				text: isDark ? "#ffffff" : "#1e3a5f",
				icon: isDark ? "#ffffff" : "#2563eb",
			},
			network: {
				bg: isDark ? "#8b5cf6" : "#ede9fe",
				border: isDark ? "#7c3aed" : "#c4b5fd",
				text: isDark ? "#ffffff" : "#3b1e5f",
				icon: isDark ? "#ffffff" : "#7c3aed",
			},
			edge: isDark ? "#64748b" : "#94a3b8",
			selected: isDark ? "#fbbf24" : "#18181b",
			caption: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.5)",
		};

		cy = cytoscape({
			container: containerEl,
			elements,
			style: [
				// Service nodes
				{
					selector: 'node[type="service"]',
					style: {
						"background-color": colors.service.bg,
						"border-color": colors.service.border,
						"border-width": 2,
						label: (ele: any) => `${ele.data("label")}\n${ele.data("caption") || ""}`,
						color: colors.service.text,
						"text-valign": "center",
						"text-halign": "center",
						"font-size": "10px",
						"font-weight": 600,
						width: 150,
						height: 55,
						shape: "roundrectangle",
						"text-wrap": "wrap",
						"text-max-width": "115px",
						"text-overflow-wrap": "anywhere",
						"line-height": 1.2,
						"background-image": getSvgIcon("service", colors.service.icon),
						"background-width": "16px",
						"background-height": "16px",
						"background-position-x": "8px",
						"background-position-y": "50%",
						"background-clip": "none",
						"text-margin-x": 10,
					},
				},
				// Network nodes
				{
					selector: 'node[type="network"]',
					style: {
						"background-color": colors.network.bg,
						"border-color": colors.network.border,
						"border-width": 2,
						label: (ele: any) => {
							const label = ele.data("label");
							const driver = ele.data("caption") || "bridge";
							const driverText = getLabelText(String(driver));
							return `${label}\n网络: ${driverText}`;
						},
						color: colors.network.text,
						"text-valign": "center",
						"text-halign": "center",
						"font-size": "9px",
						"font-weight": 600,
						width: 120,
						height: 46,
						shape: "roundrectangle",
						"text-wrap": "wrap",
						"text-max-width": "90px",
						"text-overflow-wrap": "anywhere",
						"line-height": 1.2,
						"background-image": getSvgIcon("network", colors.network.icon),
						"background-width": "14px",
						"background-height": "14px",
						"background-position-x": "6px",
						"background-position-y": "50%",
						"background-clip": "none",
						"text-margin-x": 8,
					},
				},
				// Link edges
				{
					selector: 'edge[type="link"]',
					style: {
						width: 2,
						"line-color": "#64748b",
						"target-arrow-color": "#64748b",
						"target-arrow-shape": "triangle",
						"curve-style": "bezier",
						"line-style": "dashed",
					},
				},
				// Network connection edges
				{
					selector: 'edge[type="network-connection"]',
					style: {
						width: 1.5,
						"line-color": "#a78bfa",
						"curve-style": "bezier",
						"line-style": "dotted",
					},
				},
				// Selected node
				{
					selector: "node:selected",
					style: {
						"border-width": 3,
						"border-color": "#18181b",
						"overlay-color": "#18181b",
						"overlay-padding": 3,
						"overlay-opacity": 0.15,
					},
				},
				// Selected edge
				{
					selector: "edge:selected",
					style: {
						width: 3,
						"line-color": "#f59e0b",
						"target-arrow-color": "#f59e0b",
					},
				},
			],
			layout:
				skipLayout && savedPositions
					? { name: "preset" }
					: {
							name: "breadthfirst",
							directed: false,
							padding: 50,
							spacingFactor: 1.8,
							avoidOverlap: true,
							nodeDimensionsIncludeLabels: true,
							grid: true
						},
			wheelSensitivity: 0.3,
			minZoom: 0.3,
			maxZoom: 3,
		});

		if (skipLayout && savedPositions) {
			cy.nodes().forEach((node) => {
				const savedPos = savedPositions!.get(node.id());
				if (savedPos) {
					node.position(savedPos);
				}
			});
		}

		cy.on("tap", "node", (evt) => {
			evt.preventDefault();
			const node = evt.target;
			if (!node || !node.data) return;

			const nodeData = node.data();
			selectedNode = JSON.parse(JSON.stringify(nodeData));
			selectedEdge = null;
		});

		cy.on("tap", "edge", (evt) => {
			selectedEdge = evt.target.data();
			selectedNode = null;
		});

		cy.on("tap", (evt) => {
			if (evt.target === cy) {
				selectedNode = null;
				selectedEdge = null;
			}
		});

		graphInitialized = true;

		setTimeout(() => {
			if (cy) {
				cy.resize();
				cy.fit(undefined, 50);
			}
		}, 100);
	}

	function zoomIn() {
		if (cy) cy.zoom(cy.zoom() * 1.2);
	}

	function zoomOut() {
		if (cy) cy.zoom(cy.zoom() / 1.2);
	}

	function fitToScreen() {
		if (cy) cy.fit(undefined, 50);
	}

	// Exported function to handle container resize
	export function resize() {
		if (cy && containerEl) {
			cy!.unmount();
			requestAnimationFrame(() => {
				if (cy && containerEl) {
					cy!.mount(containerEl);
					cy!.resize();
					cy!.fit(undefined, 50);
				}
			});
		}
	}

	function getLayoutConfig(layoutName: LayoutType): cytoscape.LayoutOptions {
		const baseConfig = {
			padding: 50,
			avoidOverlap: true,
			nodeDimensionsIncludeLabels: true,
			fit: true,
			animate: false
		};

		switch (layoutName) {
			case "breadthfirst":
				return {
					...baseConfig,
					name: "breadthfirst",
					directed: false,
					spacingFactor: 1.8,
					grid: true
				};
			case "grid":
				return { ...baseConfig, name: "grid" };
			case "circle":
				return { ...baseConfig, name: "circle" };
			case "concentric":
				return {
					...baseConfig,
					name: "concentric",
					minNodeSpacing: 50
				};
			case "cose":
				return {
					...baseConfig,
					name: "cose",
					idealEdgeLength: 100,
					nodeOverlap: 30,
					randomize: false
				};
			default:
				return { ...baseConfig, name: layoutName };
		}
	}

	function applyLayout(layoutName: LayoutType) {
		if (!cy) return;
		currentLayout = layoutName;
		showLayoutMenu = false;
		cy.layout(getLayoutConfig(layoutName)).run();
		cy.fit(undefined, 50);
	}

	function resetLayout() {
		if (cy) {
			cy.layout(getLayoutConfig(currentLayout)).run();
			cy.fit(undefined, 50);
		}
	}

	onMount(() => {
		const appTheme = localStorage.getItem("theme");
		if (appTheme === "dark" || appTheme === "light") {
			graphTheme = appTheme;
		} else {
			graphTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
		}
	});

	$effect(() => {
		if (containerEl && networks && !graphInitialized) {
			createGraph();
		}
	});

	onDestroy(() => {
		if (cy) {
			cy.destroy();
			cy = null;
		}
	});

	function toggleGraphTheme() {
		graphTheme = graphTheme === "light" ? "dark" : "light";
		createGraph(true);
	}

	function getNodeIcon(type: string) {
		switch (type) {
			case "service": return Box;
			case "network": return Network;
			default: return Database;
		}
	}

	function getNodeColor(type: string) {
		switch (type) {
			case "service": return "bg-blue-500";
			case "network": return "bg-violet-500";
			default: return "bg-slate-500";
		}
	}
</script>

<div class="flex flex-col h-full {className}">
	<!-- Toolbar -->
	<div class="flex items-center justify-between px-2 py-1.5 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 min-h-[40px]">
		<div class="flex items-center gap-2 flex-wrap"></div>
		<!-- Controls -->
		<div class="flex items-center gap-0.5">
			<!-- Layout selector -->
			<div class="relative">
				<button
					onclick={() => (showLayoutMenu = !showLayoutMenu)}
					class="h-6 px-2 flex items-center gap-1 rounded text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
					title="切换布局"
				>
					{#if currentLayout === "breadthfirst"}
						<GitBranch class="w-3 h-3" />
					{:else if currentLayout === "grid"}
						<LayoutGrid class="w-3 h-3" />
					{:else if currentLayout === "circle"}
						<Circle class="w-3 h-3" />
					{:else if currentLayout === "concentric"}
						<Target class="w-3 h-3" />
					{:else}
						<Sparkles class="w-3 h-3" />
					{/if}
					<ChevronDown class="w-3 h-3" />
				</button>
				{#if showLayoutMenu}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="absolute right-0 top-full mt-1 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 py-1 z-20 min-w-[120px]"
						onmouseleave={() => (showLayoutMenu = false)}
					>
						<button
							class="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 {currentLayout === 'breadthfirst'
								? 'text-blue-600 dark:text-blue-400 font-medium'
								: 'text-zinc-700 dark:text-zinc-200'}"
							onclick={() => applyLayout("breadthfirst")}
						>
							<GitBranch class="w-3.5 h-3.5" />
							树状
						</button>
						<button
							class="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 {currentLayout === 'grid'
								? 'text-blue-600 dark:text-blue-400 font-medium'
								: 'text-zinc-700 dark:text-zinc-200'}"
							onclick={() => applyLayout("grid")}
						>
							<LayoutGrid class="w-3.5 h-3.5" />
							网格
						</button>
						<button
							class="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 {currentLayout === 'circle'
								? 'text-blue-600 dark:text-blue-400 font-medium'
								: 'text-zinc-700 dark:text-zinc-200'}"
							onclick={() => applyLayout("circle")}
						>
							<Circle class="w-3.5 h-3.5" />
							环形
						</button>
						<button
							class="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 {currentLayout === 'concentric'
								? 'text-blue-600 dark:text-blue-400 font-medium'
								: 'text-zinc-700 dark:text-zinc-200'}"
							onclick={() => applyLayout("concentric")}
						>
							<Target class="w-3.5 h-3.5" />
							辐射
						</button>
						<button
							class="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 {currentLayout === 'cose'
								? 'text-blue-600 dark:text-blue-400 font-medium'
								: 'text-zinc-700 dark:text-zinc-200'}"
							onclick={() => applyLayout("cose")}
						>
							<Sparkles class="w-3.5 h-3.5" />
							力导向
						</button>
					</div>
				{/if}
			</div>
			<div class="w-px h-4 bg-zinc-300 dark:bg-zinc-600 mx-1"></div>
			<!-- Theme toggle -->
			<button
				onclick={toggleGraphTheme}
				class="h-6 w-6 flex items-center justify-center rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
				title={graphTheme === "light" ? "切换到深色主题" : "切换到浅色主题"}
			>
				{#if graphTheme === "light"}
					<Moon class="w-3.5 h-3.5" />
				{:else}
					<Sun class="w-3.5 h-3.5" />
				{/if}
			</button>
			<div class="w-px h-4 bg-zinc-300 dark:bg-zinc-600 mx-1"></div>
			<Button variant="ghost" size="sm" onclick={zoomOut} class="h-6 w-6 p-0 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
				<ZoomOut class="w-3.5 h-3.5" />
			</Button>
			<Button variant="ghost" size="sm" onclick={zoomIn} class="h-6 w-6 p-0 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
				<ZoomIn class="w-3.5 h-3.5" />
			</Button>
			<Button variant="ghost" size="sm" onclick={fitToScreen} class="h-6 w-6 p-0 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
				<Maximize2 class="w-3.5 h-3.5" />
			</Button>
			<Button variant="ghost" size="sm" onclick={resetLayout} class="h-6 w-6 p-0 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
				<RotateCcw class="w-3.5 h-3.5" />
			</Button>
		</div>
	</div>

	<div class="flex-1 flex min-h-0 h-full">
		<!-- Graph container -->
		<div class="flex-1 relative h-full min-w-0 {graphTheme === 'dark' ? 'bg-zinc-900' : 'bg-zinc-100'}">
			<div bind:this={containerEl} class="w-full h-full"></div>

			<!-- Footer: Legend -->
			<div class="absolute bottom-2 left-2 pointer-events-none z-10">
				<div
					class="flex items-center gap-2 text-xs bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm rounded px-2 py-1 shadow-sm border border-zinc-200/50 dark:border-zinc-700/50 whitespace-nowrap"
				>
					<div class="flex items-center gap-1 flex-shrink-0">
						<div class="w-2 h-2 rounded-sm bg-blue-500 flex-shrink-0"></div>
						<span class="text-zinc-600 dark:text-zinc-300">服务</span>
					</div>
					<div class="flex items-center gap-1 flex-shrink-0">
						<div class="w-2 h-2 rounded-sm bg-violet-500 flex-shrink-0"></div>
						<span class="text-zinc-600 dark:text-zinc-300">网络</span>
					</div>
				</div>
			</div>
			<!-- Details panel (overlay) -->
			{#if selectedNode || selectedEdge}
				<div class="absolute top-0 right-0 bottom-0 w-[420px] border-l border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/95 shadow-lg z-20 flex flex-col">
					<!-- Sticky header -->
					{#if selectedNode}
						{@const NodeIcon = getNodeIcon(selectedNode.type)}
						<div class="sticky top-0 z-10 p-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/95">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-2">
									<div class="p-1.5 rounded {getNodeColor(selectedNode.type)}">
										<NodeIcon class="w-3.5 h-3.5 text-white" />
									</div>
									<div>
										<h3 class="font-semibold text-sm text-zinc-800 dark:zinc-100">
											{selectedNode.label}
										</h3>
										<p class="text-xs text-zinc-500 dark:text-zinc-400 capitalize">
											{selectedNode.type === 'service' ? '服务' : '网络'}
										</p>
									</div>
								</div>
								<div class="flex items-center gap-1">
									<Button
										variant="ghost"
										size="sm"
										class="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700"
										onclick={() => {
											selectedNode = null;
											selectedEdge = null;
										}}
										title="关闭"
									>
										<X class="w-3.5 h-3.5" />
									</Button>
								</div>
							</div>
						</div>
					{:else if selectedEdge}
						<!-- Sticky header for edge -->
						<div class="sticky top-0 z-10 p-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/95">
							<div class="flex items-center justify-between">
								<div>
									<h3 class="font-semibold text-sm text-zinc-800 dark:text-zinc-100 capitalize">
										{selectedEdge.type.replace("-", " ") === 'network connection' ? '网络连接' : '连接'}
									</h3>
									<p class="text-xs text-zinc-500 dark:text-zinc-400">
										{selectedEdge.source.replace(/^(service|network)-/, "")}
										→
										{selectedEdge.target.replace(/^(service|network)-/, "")}
									</p>
								</div>
								<div class="flex items-center gap-1">
									<Button
										variant="ghost"
										size="sm"
										class="h-6 w-6 p-0 text-zinc-500 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700"
										onclick={() => {
											selectedNode = null;
											selectedEdge = null;
										}}
										title="关闭"
									>
										<X class="w-3.5 h-3.5" />
									</Button>
								</div>
							</div>
						</div>
					{/if}
					<!-- Scrollable content -->
					<div class="flex-1 overflow-y-auto p-3">
						{#if selectedNode}
							{#if selectedNode.type === "service"}
								<div class="space-y-3 text-sm">
									<!-- Container Id -->
									<div class="space-y-1.5">
										<div class="flex items-center justify-between">
											<span class="text-xs font-medium text-zinc-600 dark:text-zinc-300">容器 ID</span>
										</div>
										<Input value={selectedNode.config.containerId} placeholder="containerId" class="h-8 text-xs" readonly />
									</div>
								</div>
							{:else if selectedNode.type === "network"}
								<div class="space-y-3 text-sm">
									<!-- Driver -->
									<div class="space-y-1.5">
										<span class="text-xs font-medium text-zinc-600 dark:text-zinc-300">驱动类型</span>
										<!-- Simulate the select element -->
										<div class="flex items-center justify-between w-fit h-8 px-3 py-2 text-xs border rounded-md border-input bg-background shadow-sm dark:bg-input/30">
											<span class="flex items-center gap-1.5">
												{#if selectedNode.config.driver === "bridge"}
													<Share2 class="w-3.5 h-3.5 text-emerald-500" />
												{:else if selectedNode.config.driver === "host"}
													<Server class="w-3.5 h-3.5 text-sky-500" />
												{:else if selectedNode.config.driver === "overlay"}
													<Globe class="w-3.5 h-3.5 text-violet-500" />
												{:else if selectedNode.config.driver === "macvlan"}
													<MonitorSmartphone class="w-3.5 h-3.5 text-amber-500" />
												{:else if selectedNode.config.driver === "ipvlan"}
													<Cpu class="w-3.5 h-3.5 text-orange-500" />
												{:else}
													<CircleOff class="w-3.5 h-3.5 text-muted-foreground" />
												{/if}
												<span class="capitalize">{getLabelText(String(selectedNode.config.driver || 'bridge'))}</span>
											</span>
										</div>
									</div>

									<!-- IPAM Config -->
									<div class="space-y-1.5">
										<span class="text-xs font-medium text-zinc-600 dark:text-zinc-300">IPAM 配置</span>
										<div class="space-y-4 pt-2">
											<div class="relative">
												<span class="absolute -top-2 left-2 text-[9px] text-zinc-400 bg-white dark:bg-zinc-800 px-1 z-10">子网</span>
												<Input value={selectedNode.config.ipam?.config?.[0]?.subnet || ''} placeholder="172.20.0.0/16" class="h-9 pt-3 text-xs" readonly />
											</div>
											<div class="relative">
												<span class="absolute -top-2 left-2 text-[9px] text-zinc-400 bg-white dark:bg-zinc-800 px-1 z-10">网关</span>
												<Input value={selectedNode.config.ipam?.config?.[0]?.gateway || ''} placeholder="172.20.0.1" class="h-9 pt-3 text-xs" readonly />
											</div>
										</div>
									</div>

									<div class="space-y-2 pointer-events-none select-none">
										<label class="flex items-center gap-2 cursor-pointer">
											<input type="checkbox" checked={selectedNode.config.external} disabled class="rounded border-zinc-300" />
											<span class="text-xs text-zinc-600">外部网络</span>
										</label>
										<label class="flex items-center gap-2 cursor-pointer">
											<input type="checkbox" checked={selectedNode.config.internal} disabled class="rounded border-zinc-300" />
											<span class="text-xs text-zinc-600">内部网络</span>
										</label>
										<label class="flex items-center gap-2 cursor-pointer">
											<input type="checkbox" checked={selectedNode.config.attachable} disabled class="rounded border-zinc-300" />
											<span class="text-xs text-zinc-600">可附加</span>
										</label>
									</div>
								</div>
							{/if}
						{:else if selectedEdge}
							{#if selectedEdge.type === "network-connection"}
								<p class="text-xs text-zinc-500 dark:text-zinc-400">服务已连接到此网络。</p>
							{/if}
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>