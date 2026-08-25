import { writable, get } from 'svelte/store';
import { currentEnvironment, environments } from './environment';

export interface DockerEvent {
	type: 'container' | 'image' | 'volume' | 'network';
	action: string;
	actor: {
		id: string;
		name: string;
		attributes: Record<string, string>;
	};
	time: number;
	timeNano: string;
}

export type EventCallback = (event: DockerEvent) => void;

// Connection state
export const sseConnected = writable<boolean>(false);
export const sseError = writable<string | null>(null);
export const lastEvent = writable<DockerEvent | null>(null);

// Event listeners
const listeners: Set<EventCallback> = new Set();

let eventSource: EventSource | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let wantsConnection = false; // Track intent to be connected (even for edge envs without eventSource)
let isEdgeMode = false; // Track if current env is edge (no SSE needed)
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

// Check if environment is edge type (events come via Hawser WebSocket, not SSE)
function isEdgeEnvironment(envId: number | null | undefined): boolean {
	if (!envId) return false;
	const envList = get(environments);
	const env = envList.find(e => e.id === envId);
	return env?.connectionType === 'hawser-edge';
}

// Subscribe to events
export function onDockerEvent(callback: EventCallback): () => void {
	listeners.add(callback);
	return () => listeners.delete(callback);
}

// Notify all listeners
function notifyListeners(event: DockerEvent) {
	lastEvent.set(event);
	listeners.forEach(callback => {
		try {
			callback(event);
		} catch (e) {
			console.error('事件监听器错误：', e);
		}
	});
}

// Connect to SSE endpoint
export function connectSSE(envId?: number | null) {
	// Close existing connection
	disconnectSSE();

	// Mark that we want to be connected
	wantsConnection = true;
	reconnectAttempts = 0;

	// Don't connect if no environment is selected
	if (!envId) {
		sseConnected.set(false);
		sseError.set(null);
		return;
	}

	// Edge environments receive events via Hawser agent WebSocket, not SSE
	if (isEdgeEnvironment(envId)) {
		isEdgeMode = true;
		// For edge environments, we're "connected" but via a different mechanism
		sseConnected.set(true);
		sseError.set(null);
		return;
	}

	isEdgeMode = false;
	const url = `/api/events?env=${envId}`;

	try {
		eventSource = new EventSource(url);

		eventSource.addEventListener('connected', (e) => {
			console.log('SSE 已连接：', JSON.parse(e.data));
			sseConnected.set(true);
			sseError.set(null);
			reconnectAttempts = 0;
		});

		eventSource.addEventListener('docker', (e) => {
			try {
				const event: DockerEvent = JSON.parse(e.data);
				notifyListeners(event);
			} catch (err) {
				console.error('解析 Docker 事件失败：', err);
			}
		});

		eventSource.addEventListener('heartbeat', () => {
			// Connection is alive
		});

		// Handle SSE error events (both server-sent and connection errors)
		eventSource.addEventListener('error', (e: Event) => {
			// Check if this is a server-sent error message (MessageEvent with data)
			const messageEvent = e as MessageEvent;
			if (messageEvent.data) {
				try {
					const data = JSON.parse(messageEvent.data);
					// Check if this is the edge environment message (fallback if env list wasn't loaded)
					if (data.message?.includes('Edge environments')) {
						isEdgeMode = true;
						sseConnected.set(true);
						sseError.set(null);
						if (eventSource) {
							eventSource.close();
							eventSource = null;
						}
						return;
					}
				} catch {
					// Not JSON, fall through to generic error handling
				}
			}

			// Skip reconnection if we're in edge mode
			if (isEdgeMode) {
				return;
			}

			console.error('SSE 错误：', e);
			sseConnected.set(false);

			// Attempt reconnection
			if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
				reconnectAttempts++;
				sseError.set(`连接已断开，正在重新连接 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
				reconnectTimeout = setTimeout(() => {
					const env = get(currentEnvironment);
					connectSSE(env?.id);
				}, RECONNECT_DELAY);
			} else {
				sseError.set('连接失败，请刷新页面重试。');
			}
		});

		eventSource.onerror = () => {
			// Handled by error event listener
		};

	} catch (error: any) {
		console.error('创建事件源失败：', error);
		sseError.set(error.message || '连接失败');
		sseConnected.set(false);
	}
}

// Disconnect from SSE
export function disconnectSSE() {
	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout);
		reconnectTimeout = null;
	}
	if (eventSource) {
		eventSource.close();
		eventSource = null;
	}
	// Don't reset wantsConnection here - it's reset by explicit calls
	sseConnected.set(false);
	isEdgeMode = false;
}

// Subscribe to environment changes and reconnect
let currentEnvId: number | null = null;
currentEnvironment.subscribe((env) => {
	const newEnvId = env?.id ?? null;
	if (newEnvId !== currentEnvId) {
		currentEnvId = newEnvId;
		// If no environment, disconnect
		if (!newEnvId) {
			disconnectSSE();
			wantsConnection = false;
		} else if (wantsConnection) {
			// Reconnect with new environment if we want to be connected
			// (using wantsConnection because eventSource is null for edge envs)
			connectSSE(newEnvId);
		}
	}
});

// Helper to check if action affects container list
export function isContainerListChange(event: DockerEvent): boolean {
	if (event.type !== 'container') return false;
	return ['create', 'destroy', 'start', 'stop', 'pause', 'unpause', 'die', 'kill', 'rename'].includes(event.action);
}

// Helper to check if action affects image list
export function isImageListChange(event: DockerEvent): boolean {
	if (event.type !== 'image') return false;
	return ['pull', 'push', 'delete', 'tag', 'untag', 'import'].includes(event.action);
}

// Helper to check if action affects volume list
export function isVolumeListChange(event: DockerEvent): boolean {
	if (event.type !== 'volume') return false;
	return ['create', 'destroy'].includes(event.action);
}

// Helper to check if action affects network list
export function isNetworkListChange(event: DockerEvent): boolean {
	if (event.type !== 'network') return false;
	return ['create', 'destroy', 'connect', 'disconnect'].includes(event.action);
}
