// Shared types that can be used in both client and server code

/**
 * System container type - containers that cannot be updated from within Dockhand.
 */
export type SystemContainerType = 'dockhand' | 'hawser';

export interface ContainerInfo {
	id: string;
	name: string;
	image: string;
	state: string;
	status: string;
	health?: string;
	created: number;
	ports: Array<{
		IP?: string;
		PrivatePort: number;
		PublicPort?: number;
		Type: string;
	}>;
	labels: Record<string, string>;
	mounts: Array<{
		type: string;
		source: string;
		destination: string;
		mode: string;
		rw: boolean;
	}>;
	networkMode: string;
	networks: Record<string, { ipAddress: string }>;
	/**
	 * Identifies system containers (Dockhand, Hawser) that cannot be updated from within Dockhand.
	 * - 'dockhand': The Dockhand container itself
	 * - 'hawser': A Hawser remote agent container
	 * - null/undefined: Regular container
	 */
	systemContainer?: SystemContainerType | null;
}

export interface ImageInfo {
	id: string;
	repoTags: string[];
	tags: string[]; // Alias for repoTags, populated by API
	repoDigests: string[]; // Repository digests (e.g., "nginx@sha256:abc123") - used for untagged images
	created: number;
	size: number;
	virtualSize: number;
	labels: Record<string, string>;
	containers: number; // Number of containers using this image
}

export interface VolumeUsage {
	containerId: string;
	containerName: string;
}

export interface VolumeInfo {
	name: string;
	driver: string;
	mountpoint: string;
	scope: string;
	labels: Record<string, string>;
	createdAt?: string;
	created: string; // Alias for createdAt, populated by API
	usedBy?: VolumeUsage[]; // Containers using this volume
}

export interface NetworkInfo {
	id: string;
	name: string;
	driver: string;
	scope: string;
	internal?: boolean;
	ipam: {
		driver: string;
		config: Array<{
			subnet?: string;
			gateway?: string;
		}>;
	};
	containers: Record<string, {
		name: string;
		ipv4Address: string;
	}>;
	labels: Record<string, string>;
}

export interface StackInfo {
	name: string;
	services: string[];
	status: 'running' | 'partial' | 'stopped';
	containers: Array<{
		id: string;
		name: string;
		service: string;
		state: string;
		status: string;
	}>;
	path?: string;
}

export interface ContainerStats {
	id: string;
	name: string;
	cpuPercent: number;
	memoryUsage: number;      // Actual usage (total - cache), same as docker stats
	memoryRaw: number;        // Raw total usage before cache subtraction
	memoryCache: number;      // File cache (inactive_file)
	memoryLimit: number;
	memoryPercent: number;
	networkRx: number;
	networkTx: number;
	blockRead: number;
	blockWrite: number;
}

export interface StackContainer {
	id: string;
	name: string;
	service: string;
	state: string;
	status: string;
	health?: string;
	image: string;
	ports: Array<{ publicPort: number; privatePort: number; type: string; display: string }>;
	networks: Array<{ name: string; ipAddress: string }>;
	volumeCount: number;
	restartCount: number;
	created: number;
}

export interface ComposeStackInfo {
	name: string;
	containers: string[];
	containerDetails: StackContainer[];
	status: string;
	sourceType?: 'external' | 'internal' | 'git';
	repository?: {
		id: number;
		name: string;
		url?: string;
		branch?: string;
	};
}

export interface GitRepository {
	id: number;
	name: string;
	url: string;
	branch: string;
	composePath: string;
	credentialId: number | null;
	environmentId: number | null;
	autoUpdate: boolean;
	webhookEnabled: boolean;
	webhookSecret: string | null;
	lastSync: string | null;
	lastCommit: string | null;
	syncStatus: 'pending' | 'syncing' | 'synced' | 'error';
	syncError: string | null;
	createdAt: string;
	updatedAt: string;
}

// Grid column configuration types
export type GridId = 'containers' | 'images' | 'imageTags' | 'networks' | 'stacks' | 'volumes' | 'activity' | 'schedules' | 'audit' | 'environments';

export interface ColumnConfig {
	id: string;
	label: string;
	width?: number;
	minWidth?: number;
	resizable?: boolean;
	sortable?: boolean;
	sortField?: string;
	fixed?: 'start' | 'end';
	align?: 'left' | 'center' | 'right';
	grow?: boolean; // If true, column expands to fill remaining space
	noTruncate?: boolean; // If true, content won't be truncated with ellipsis
}

export interface ColumnPreference {
	id: string;
	visible: boolean;
	width?: number;
}

export interface GridColumnPreferences {
	columns: ColumnPreference[];
}

export type AllGridPreferences = Partial<Record<GridId, GridColumnPreferences>>;

const LabelMaps = {
  container: {
    running: '运行中',
    paused: '已暂停',
    restarting: '重启中',
    exited: '已退出',
    created: '已创建',
    dead: '已失效',
    partial: '部分运行',
    stopped: '已停止',
    unknown: '未知',
  },
  health: {
    healthy: '健康',
    unhealthy: '不健康',
  },
  restartPolicy: {
    always: '始终重启',
    'on-failure': '失败时重启',
    'unless-stopped': '除非手动停止',
    no: '不重启',
  },
  networkMode: {
    bridge: '桥接',
    host: '主机',
    none: '无网络',
    overlay: '覆盖网络',
    macvlan: 'MACVLAN',
    ipvlan: 'IPVLAN',
    null:'无',
  },
  networkScope: {
    local: '本地',
    swarm: '集群',
    global: '全局'
  },
  volume: {
    local: '本地',
    nfs: 'NFS',
    cifs: 'CIFS',
    tmpfs: '临时文件系统',
  },
  mountType: {
    bind: '绑定',
    volume: '数据卷',
    tmpfs: '临时文件系统',
    npipe: '命名管道',
    unknown: '未知'
  },
  mountPropagation: {
    shared: '共享',
    slave: '从属',
    private: '私有',
    rprivate: '递归私有',
    rshared: '递归共享',
    rslave: '递归从属'
  },
  entityType: {
    container: '容器',
    image: '镜像',
    volume: '数据卷',
    network: '网络',
    stack: '堆栈',
    user: '用户',
    role: '角色',
    settings: '系统设置',
    environment: '环境',
    registry: '镜像仓库',
    git_repository: 'Git 仓库',
    git_credential: 'Git 凭据',
    config_set: '配置集',
  },
  category: {
    containers: '容器',
    images: '镜像',
    volumes: '数据卷',
    networks: '网络',
    stacks: '堆栈',
    environments: '环境',
    registries: '镜像仓库',
    git: 'Git 仓库',
    users: '用户',
    settings: '设置',
    configsets: '配置集',
    notifications: '通知',
    license: '许可证',
    audit_logs: '审计日志',
    activity: '操作记录',
    schedules: '计划任务',
  },
  action: {
    view: '查看',
    create: '创建',
    update: '更新',
    edit: '编辑',
    delete: '删除',
    start: '启动',
    stop: '停止',
    restart: '重启',
    pause: '暂停',
    unpause: '恢复',
    remove: '移除',
    exec: '终端执行',
    logs: '日志查看',
    inspect: '详情检查',
    pull: '拉取',
    push: '推送',
    prune: '清理',
    build: '构建',
    connect: '连接',
    disconnect: '断开连接',
    login: '登录',
    logout: '登出',
    sync: '同步',
    test: '测试',
    manage: '管理',
	  deploy: '部署',
  },
  role: {
    Admin: '管理员',
    Operator: '操作员',
    Viewer: '查看员',
  },
  execution: {
    success: '成功',
    failed: '失败',
    running: '运行中',
    queued: '等待中',
    skipped: '已是最新',
    unknown: '未知',
  },
} as const;

const FlatLabelMap: Record<string, string> = (Object as any).values(LabelMaps).reduce(
  (prev: Record<string, string>, curr: Record<string, string>) => {
    return { ...prev, ...curr };
  },
  {} as Record<string, string>
);

export function getLabelText(
  value?: string,
  type: 'default' | 'health' | 'restartPolicy' = 'default'
): string {
  if (type === 'health') {
    if (!value) return '未知';
    return FlatLabelMap[value] || '启动中';
  }

  if (type === 'restartPolicy') {
    if (!value) return '无';
    return FlatLabelMap[value] || '无';
  }

  if (!value) return value ?? '';
  let text = value;
  const actions = LabelMaps.action;
  
  for (const key in actions) {
    if (Object.prototype.hasOwnProperty.call(actions, key)) {
      const reg = new RegExp(`\\b${key}\\b`, 'gi');
      text = text.replace(reg, actions[key as keyof typeof actions]);
    }
  }
  return FlatLabelMap[text] || text;
}
