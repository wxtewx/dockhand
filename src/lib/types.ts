// Shared types that can be used in both client and server code

/**
 * System container type - containers that cannot be updated from within Dockhand.
 */
export type SystemContainerType = 'dockhand' | 'hawser';

/** A newer VERSION tag (semver) suggestion. Mirrors the server's find-newer result. */
export interface NewerVersion {
	tag: string;
	bump: 'major' | 'minor' | 'patch';
	skipped: string[];
	/** The target tag's manifest digest (`sha256:...`), when known. Lets the UI copy the new tag digest-pinned. */
	digest?: string;
}

/** Terminal connection mode: an interactive `docker exec` shell, or `docker attach` to PID 1. */
export type TerminalMode = 'exec' | 'attach';

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
	exitCode?: number;
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
	// driver_opts from the underlying volume — present for non-trivially
	// configured volumes (NFS, CIFS, BTRFS subvolumes, etc.). The 'type'
	// key here is what the volumes list surfaces as the Type column.
	options?: Record<string, string>;
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
	status: 'running' | 'partial' | 'restarting' | 'stopped';
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
	labels: Record<string, string>;
	updateAvailable?: boolean;
	/** A newer VERSION tag (semver) for this pinned image, or null. Advisory. */
	newerVersion?: NewerVersion | null;
}

export interface ComposeStackInfo {
	name: string;
	containers: string[];
	containerDetails: StackContainer[];
	status: string;
	updatesAvailable?: boolean;
	updateCount?: number;
	/** How many containers in this stack have a newer version tag (semver). */
	newerVersionCount?: number;
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
export type GridId = 'containers' | 'images' | 'imageTags' | 'networks' | 'stacks' | 'volumes' | 'activity' | 'schedules' | 'audit' | 'environments' | 'backupDestinations' | 'backups' | 'repoSnapshots' | 'vulnerabilities' | 'deploys';

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
	hint?: string; // Tooltip on column header
	defaultVisible?: boolean; // If false, column is hidden by default (user can enable it in preferences)
	// A column holding two metrics (e.g. Disk I/O = read/write) cycles a header click
	// through these (sortField, direction) states instead of a plain asc/desc toggle (#1111).
	sortCycle?: { field: string; direction: 'asc' | 'desc' }[];
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
  severity: {
    critical: "严重",
    high: "高危",
    medium: "中危",
    low: "低危",
    negligible: "可忽略",
    unknown: "未知",
  },
bump: {
    patch: "补丁版本",
    minor: "次版本",
    major: "主版本",
  },
  editCompression: {
    auto: "自动",
    off: "关闭",
    max: "最高",
  },
  container: {
    running: "运行中",
    paused: "已暂停",
    restarting: "重启中",
    exited: "已退出",
    created: "已创建",
    dead: "已失效",
    partial: "部分运行",
    stopped: "已停止",
    starting: "启动中",
    started: "已启动",
    unknown: "未知",
    "not deployed": "未部署",
  },
  health: {
    healthy: "健康",
    unhealthy: "不健康",
  },
  restartPolicy: {
    always: "始终重启",
    "on-failure": "失败时重启",
    "unless-stopped": "除非手动停止",
    no: "不重启",
  },
  networkMode: {
    bridge: "桥接",
    host: "主机",
    none: "无网络",
    overlay: "覆盖网络",
    macvlan: "MACVLAN",
    ipvlan: "IPVLAN",
    null: "无",
  },
  networkScope: {
    local: "本地",
    swarm: "集群",
    global: "全局",
  },
  volume: {
    local: "本地",
    nfs: "NFS",
    cifs: "CIFS",
    tmpfs: "临时文件系统",
  },
  mountType: {
    bind: "绑定",
    volume: "数据卷",
    tmpfs: "临时文件系统",
    npipe: "命名管道",
    unknown: "未知",
  },
  common: {
    default: "默认",
    unlimited: "无限制",
    enabled: "已启用",
    disabled: "已禁用",
    private: "私有",
    host: "主机",
    shared: "共享",
  },
  mountPropagation: {
    shared: "共享",
    slave: "从属",
    private: "私有",
    rprivate: "递归私有",
    rshared: "递归共享",
    rslave: "递归从属",
  },
  entityType: {
    container: "容器",
    image: "镜像",
    volume: "数据卷",
    network: "网络",
    stack: "堆栈",
    user: "用户",
    role: "角色",
    settings: "系统设置",
    environment: "环境",
    registry: "镜像仓库",
    git_repository: "Git 仓库",
    git_credential: "Git 凭据",
    git_stack: "Git 堆栈",
    config_set: "配置集",
    api_token: "API 令牌",
    notification: "通知",
  },
  category: {
    containers: "容器",
    images: "镜像",
    volumes: "数据卷",
    networks: "网络",
    stacks: "堆栈",
    environments: "环境",
    registries: "镜像仓库",
    git: "Git 仓库",
    users: "用户",
    settings: "设置",
    configsets: "配置集",
    notifications: "通知",
    license: "许可证",
    audit_logs: "审计日志",
    activity: "操作记录",
    schedules: "计划任务",
    secrets: "密钥",
    backups: "备份",
  },
  action: {
    view: "查看",
    create: "创建",
    update: "更新",
    edit: "编辑",
    delete: "删除",
    start: "启动",
    stop: "停止",
    restart: "重启",
    pause: "暂停",
    unpause: "恢复",
    remove: "移除",
    exec: "终端执行",
    logs: "日志查看",
    inspect: "详情检查",
    pull: "拉取",
    push: "推送",
    prune: "清理",
    build: "构建",
    connect: "连接",
    disconnect: "断开连接",
    login: "登录",
    logout: "登出",
    sync: "同步",
    test: "测试",
    manage: "管理",
    deploy: "部署",
    backup: "备份",
    restore: "恢复",
    verify: "验证",
  },
  role: {
    admin: "管理员",
    operator: "操作员",
    viewer: "查看员",
  },
  execution: {
    success: "成功",
    failed: "失败",
    running: "运行中",
    queued: "等待中",
    skipped: "已是最新",
    unknown: "未知",
  },
  restic: {
    snapshots: "快照",
    excluding: "排除路径",
    uploaded: "已上传",
    processed: "已处理",
    remaining: "剩余待处理",
    ID: "快照ID",
    Time: "创建时间",
    Host: "主机",
    Tags: "标签",
    Paths: "备份路径",
    added: "新增",
    removed: "删除",
    modified: "修改",
    unchanged: "无变化",
    total_size: "总大小",
    snapshots_count: "快照数量",
    snapshot_count: "快照数量",
    total_file_count: "总文件数",
    files_count: "文件数量",
    blobs_count: "数据块总数",
    packs_count: "数据包总数",
    done: "执行完成",
    blobs: "数据块",
    packs: "数据包",
    indexes: "索引",
    "Password:": "密码：",
    "enter password again:": "再次输入密码：",
    "repository opened successfully, password is correct":
      "成功打开备份仓库，密码校验通过",
    "using temporary cache in": "使用临时缓存：",
    "loading indexes...": "正在加载索引",
    "created new repository": "已创建新备份仓库",
    "repository is already initialized": "备份仓库已经初始化完成",
    "repository is not initialized": "备份仓库尚未初始化",
    "repository is locked": "备份仓库已被锁定",
    "unable to create lock in backend": "无法在后端创建仓库锁",
    "the unlock command can be used to remove stale locks":
      "可使用 unlock 命令清理过期仓库锁",
    "no errors were found": "未检测到任何错误",
    "Data for blobs": "数据块信息",
    "List of packs": "数据包列表",
    "Please enter password for repository": "请输入备份仓库密码",
    "Password is correct": "密码校验正确",
    "Password is incorrect": "密码错误",
    "aborting operation": "终止当前操作",
    "Dry-run mode, no changes will be made": "模拟运行模式，不会执行任何变更",
    "Read data from stdin": "从标准输入读取数据",
    "write output to stdout": "输出至标准输出",
    "created restic repository": "已创建 restic 备份仓库",
    "Important: Please keep this repository password safe":
      "重要提示：请妥善保管仓库密码",
    "load indexes": "加载索引",
    "check all packs": "校验所有数据包",
    "check for unused blobs": "检测未被引用的数据块",
    "check read data": "读取并校验数据内容",
    "repository contains errors!": "备份仓库存在损坏！",
    "pack contains errors": "数据包存在损坏",
    "tree blob does not exist": "目录树数据块不存在",
    "data blob does not exist": "文件数据块不存在",
    "snapshot references missing tree": "快照引用的目录树不存在",
    'Run "restic repair packs"': "执行命令：restic repair packs",
    'Run "restic repair index"': "执行命令：restic repair index",
    "no snapshots found": "仓库内不存在快照",
    "created new snapshot": "已生成新快照",
    "saving snapshot": "正在保存快照",
    "files new": "新增文件",
    "files changed": "变更文件",
    "files unmodified": "无改动文件",
    "dirs new": "新增目录",
    "dirs changed": "变更目录",
    "dirs unmodified": "无改动目录",
    "data added to repo": "本次新增入库数据",
    "ignoring error": "忽略错误",
    "unchanged files skipped": "跳过未变更文件",
    "scan finished": "文件扫描完成",
    "error reading file": "读取文件发生错误",
    "file has disappeared": "文件已被删除",
    "Applying Policy": "正在应用快照保留策略",
    "keep last": "保留最新",
    "keep hourly": "保留每小时快照",
    "keep daily": "保留每日快照",
    "keep weekly": "保留每周快照",
    "keep monthly": "保留每月快照",
    "keep yearly": "保留每年快照",
    "remove snapshot": "移除快照",
    "Would remove snapshot (dry-run)": "模拟运行：将会移除快照",
    "snapshots to remove": "待移除快照数量",
    "snapshots keep": "需要保留的快照数量",
    "finding data that is still in use for":
      "检索正在被快照引用的数据，快照数量：",
    "searching used packs...": "检索正在使用的数据包",
    "collecting packs for deletion and repacking":
      "收集待删除/重新打包的数据包",
    "to repack": "需要重新打包",
    "this removes": "将移除",
    "to delete": "待删除数据",
    "unused size after prune": "清理完成后的闲置空间",
    "rebuilding index": "正在重建索引",
    "deleting obsolete index files": "删除过时索引文件",
    "prune finished successfully": "仓库清理执行完毕",
    "repacking pack": "正在重新打包数据包",
    "deleting obsolete pack files": "删除废弃数据包文件",
    "restoring snapshot": "正在恢复快照",
    "restoring file": "正在恢复文件",
    "created directory": "创建目录",
    "modified file": "修改文件",
    "removed file": "删除文件",
    "skip existing files": "跳过已存在文件",
    "overwriting existing files": "覆盖已存在文件",
    "Total File Count": "文件总数",
    "Total Size": "原始总大小",
    "Raw Size": "原始文件总大小 (未去重)",
    "Unique Size": "唯一数据大小 (去重后)",
    "Snapshot Count": "快照总数",
    "Blob Count": "数据块总数",
    "Pack Count": "数据包总数",
    "found stale lock": "检测到过期锁",
    "removed stale lock": "已清理过期仓库锁",
    "no stale locks found": "未发现过期仓库锁",
    "unlock successful": "仓库解锁成功",
    "reading all packs": "读取全部数据包",
    "rebuilding indexes from pack list": "根据数据包列表重建索引",
    "successfully repaired repository index": "仓库索引修复完成",
    "repairing pack": "修复数据包",
    "writing new index file": "写入新索引文件",
    "short ID": "简短ID",
    "full ID": "完整ID",
    "created new key": "已创建新访问密钥",
    "removed key": "已删除密钥",
    "list of keys": "密钥列表",
    "password successfully changed": "仓库密码修改完成",
    "copying snapshot": "复制快照",
    "snapshot already exists in target repo": "目标仓库已存在该快照",
    "copied snapshot successfully": "快照复制完成",
    "Fatal: unable to create lock in backend: repository is already locked":
      "严重错误：无法创建锁，备份仓库已被占用",
    "Fatal: wrong password or no key found": "严重错误：密码错误，或者未找到密钥",
    "ciphertext verification failed": "密文校验失败 (密码错误或文件损坏)",
    "nonce is invalid": "加密随机数无效，数据包损坏",
    "connection failed": "后端存储连接失败",
    "no such file or directory": "文件/目录不存在",
    "insufficient space": "存储空间不足",
    "context canceled": "任务被主动取消",
    "failed to refresh lock in time": "无法及时刷新仓库锁",
    "timeout connecting to": "连接后端超时",
    "permission denied": "权限不足",
    "unable to load index": "无法加载索引文件",
    "unable to find index": "找不到索引",
    "backend does not support listing": "当前存储后端不支持列表查询",
    "rate limit reached": "触发后端接口限流",
    "server returned status code": "服务端返回错误状态码",
    "checksum does not match": "哈希校验和不匹配，文件损坏",
    "unknown blob type": "未知数据块类型",
    "invalid snapshot ID": "无效的快照ID",
    "invalid repository ID": "无效仓库ID",
    "unsupported repository version": "不支持的仓库版本，请升级restic",
    "repository version too new": "仓库版本过高，请升级restic程序",
    "repository version too old": "仓库版本过低，请执行仓库升级",
    "used:": "已占用：",
    "unused:": "未使用：",
    "total:": "总计：",
    "to repack:": "需要重新打包：",
    "will remove:": "将移除：",
    "pending delete data:": "待删除数据：",
    "total prune:": "总计清理：",
    "remaining pending:": "剩余待处理：",
    "unused space after prune:": "清理完成后的闲置空间：",
    "totally used packs:": "完全占用数据包：",
    "partly used packs:": "部分占用数据包：",
    "unused packs:": "闲置数据包：",
    "to keep:": "需要保留：",
    "packs to repack:": "需要重新打包的数据包：",
    "packs pending delete data:": "包含待删除数据的数据包：",
    "getting pack files to read...": "正在获取待读取数据包…",
    "old indexes deleted": "已删除旧索引",
  },
} as const;

const composeLogRules: [RegExp, string][] = [
  // 【修复】网络警告规则，兼容字面量 \n 和真实换行
  [/a network with name ([^"]+) exists but was not created for project \\"([^\\"]*)\\"\.?(?:\\n|\\\\n|\n)?Set `external: true` to use an existing network/gi, '名为 "$1" 的网络已存在，但并非由项目 "$2" 创建。\n请设置 `external: true` 以使用现有网络'],
  // ========== 长文本优先：Compose / Docker 错误规则 ==========
  [/Are you trying to mount a directory onto a file \(or vice-versa\)\?/gi, "你可能将目录挂载到了文件，或文件挂载到了目录 (格式不匹配)？"],
  [/Check if the specified host path exists and is the expected type/gi, "请检查主机路径是否存在，且类型正确"],
  [/mapping values are not allowed in this context/gi, "此位置不允许使用映射格式 (YAML 语法错误)"],
  [/" refers to undefined network /gi, "\" 引用了未定义的网络 "],
  [/" refers to undefined volume /gi, "\" 引用了未定义的数据卷 "],
  [/" depends on undefined service /gi, "\" 依赖了未定义的服务 "],
  [/: invalid compose project/gi, "：无效的 Compose 项目"],
  [/driver failed programming external connectivity/gi, "网络驱动配置外部连接失败"],
  [/failed: port is already allocated/gi, "失败：端口已被占用"],
  [/port is already allocated/gi, "端口已被占用"],
  [/failed to set up container networking/gi, "容器网络配置失败"],
  [/Error response from daemon/gi, "守护进程错误"],
  [/OCI runtime create failed/gi, "OCI 运行时创建失败"],
  [/unable to start container process/gi, "无法启动容器进程"],
  [/error during container init/gi, "容器初始化时出错"],
  [/failed to create task for container/gi, "为容器创建任务失败"],
  [/failed to create shim task/gi, "创建运行环境任务失败"],
  [/failed to resolve reference/gi, "解析镜像引用失败"],
  [/invalid restart policy/gi, "无效的重启策略"],
  [/unknown policy/gi, "未知策略"],
  [/use one of/gi, "请使用以下值之一"],
  [/additional properties/gi, "存在不允许的额外属性"],
  [/not allowed/gi, "不允许使用"],
  [/failed to parse/gi, "解析失败"],
  [/yaml: line/gi, "YAML 文件第"],
  [/mount src=/gi, "源路径="],
  [/dst=/gi, "目标路径="],
  [/flags=/gi, "挂载标记="],
  [/error mounting/gi, "挂载出错"],
  [/to rootfs at/gi, "到 root 文件系统路径："],
  [/not a directory/gi, "不是一个目录"],
  [/exit code/gi, "退出码"],
  [/permission denied/gi, "权限不足"],
  [/no such container/gi, "容器不存在"],
  [/container not found/gi, "容器未找到"],
  [/network not found/gi, "网络不存在"],
  [/volume not found/gi, "数据卷不存在"],
  [/manifest unknown/gi, "镜像清单不存在"],
  [/invalid reference/gi, "无效镜像地址"],
  [/403 Forbidden/gi, "403 禁止访问"],
  [/Bind for/gi, "绑定端口"],
  [/unauthorized: authentication required/gi, "未授权：需要身份验证"],
  [/requested access to the resource is denied/gi, "请求的资源访问被拒绝"],
  // ========== Docker Pull 带捕获组规则（docker/cli + compose 原生输出） ==========
  [/(\S+:\S+) Pulled/gi, "$1 拉取完成"],
  [/Pulling from ([\w\-./]+)/gi, "正在从 $1 拉取镜像"],
  [/Pulling fs layer/gi, "正在获取文件系统层"],
  [/Digest:\s*(sha256:[0-9a-f]+)/gi, "摘要: $1"],
  [/Status:\s*Downloaded newer image for (\S+:\S+)/gi, "状态：已下载新版本镜像 $1"],
  [/Status:\s*Image is up to date for (\S+:\S+)/gi, "状态：镜像 $1 已是最新版本"],
  [/no matching manifest for ([^\s]+) in the manifest list entries/gi, "在清单列表中没有匹配 $1 的镜像清单"],
  [/pull access denied for (\S+), repository does not exist or may require 'docker login'/gi, "拉取 $1 被拒绝：仓库不存在，或需要登录"],
  [/manifest for (\S+:\S+) not found:/gi, "镜像 $1 的清单未找到"],
  [/error pulling image configuration/gi, "拉取镜像配置信息失败"],
  [/failed to register layer/gi, "注册文件层失败"],
  [/invalid reference format/gi, "镜像引用格式无效"],
  [/resolving digest for (\S+:\S+)/gi, "正在解析 $1 的摘要"],
  [/retrieving manifest list and config/gi, "正在获取清单列表与配置"],
  [/retrieving layer (\w+)/gi, "正在获取文件层 $1"],
  [/Downloaded newer image for/gi, "已下载适用于"],
  [/is up to date for/gi, "镜像已是最新版本："],
  [/Pull complete/gi, "拉取完成"],
  [/Download complete/gi, "下载完成"],
  [/Pulling from/gi, "从仓库拉取"],
  [/already exists/gi, "镜像已存在"],
  [/Already exists/gi, "镜像已存在"],
  [/Verifying Checksum/gi, "校验完整性"],
  [/not found/gi, "不存在"],
  [/connection refused/gi, "连接拒绝"],
  [/no such host/gi, "找不到主机"],
  [/Downloaded newer image/gi, "已下载新版本镜像"],
  // ========== Compose 构建镜像（compose + buildkit 原生输出） ==========
  [/Building (\S+)\b/gi, "正在构建 $1"],
  [/Step (\d+)\/(\d+)\s*:\s*(.+)/gi, "步骤 $1/$2：$3"],
  [/Service (\S+) is building\b/gi, "服务 $1 正在构建"],
  [/CACHED\b/gi, "已缓存"],
  [/EXPIRED\b/gi, "已过期"],
  [/FROM\b/gi, "基础镜像"],
  // ========== Compose Progress 容器生命周期【全部添加单词边界 \b 修复残留字母bug】 ==========
  [/Container (\S+) Creating\b/gi, "容器 $1 正在创建"],
  [/Container (\S+) Created\b/gi, "容器 $1 创建完成"],
  [/Container (\S+) Recreate\b/gi, "容器 $1 重新创建"],
  [/Container (\S+) Recreated\b/gi, "容器 $1 已重新创建"],
  [/Container (\S+) Starting\b/gi, "容器 $1 正在启动"],
  [/Container (\S+) Started\b/gi, "容器 $1 已启动"],
  [/Container (\S+) Restarting\b/gi, "容器 $1 正在重启"],
  [/Container (\S+) Restarted\b/gi, "容器 $1 已重启"],
  [/Container (\S+) Running\b/gi, "容器 $1 运行中"],
  [/Container (\S+) Waiting\b/gi, "容器 $1 等待中"],
  [/Container (\S+) Healthy\b/gi, "容器 $1 健康"],
  [/Container (\S+) Exited\b/gi, "容器 $1 已退出"],
  [/Container (\S+) Stopping\b/gi, "容器 $1 正在停止"],
  [/Container (\S+) Stopped\b/gi, "容器 $1 已停止"],
  [/Container (\S+) Killing\b/gi, "容器 $1 正在强制终止"],
  [/Container (\S+) Killed\b/gi, "容器 $1 已强制终止"],
  [/Container (\S+) Removing\b/gi, "容器 $1 正在移除"],
  [/Container (\S+) Removed\b/gi, "容器 $1 已移除"],
  [/Container (\S+) Building\b/gi, "容器 $1 正在构建"],
  [/Container (\S+) Built\b/gi, "容器 $1 构建完成"],
  // ========== Compose Progress 数据卷生命周期 ==========
  [/Volume (\S+) Creating\b/gi, "数据卷 $1 正在创建"],
  [/Volume (\S+) Created\b/gi, "数据卷 $1 创建完成"],
  [/Volume (\S+) Removing\b/gi, "数据卷 $1 正在移除"],
  [/Volume (\S+) Removed\b/gi, "数据卷 $1 已移除"],
  // ========== Compose Progress 网络生命周期 ==========
  [/Created network (\S+)\b/gi, "已创建网络 $1"],
  [/Removed network (\S+)\b/gi, "已移除网络 $1"],
  [/Network (\S+) Creating\b/gi, "网络 $1 正在创建"],
  [/Network (\S+) Created\b/gi, "网络 $1 创建完成"],
  [/Network (\S+) Removing\b/gi, "网络 $1 正在移除"],
  [/Network (\S+) Removed\b/gi, "网络 $1 已移除"],
  // ========== 基础单词（短词条放最后，避免抢占长匹配） ==========
  [/pulling\b/gi, "拉取中"],
  [/Waiting\b/gi, "等待中"],
  [/Downloading\b/gi, "下载中"],
  [/Extracting\b/gi, "解压中"],
  [/Extracted\b/gi, "已解压"],
  [/download\b/gi, "下载"],
  [/complete\b/gi, "完成"],
  [/idle\b/gi, "空闲"],
  [/error\b/gi, "错误"],
  [/failed\b/gi, "失败"],
  [/timeout\b/gi, "超时"],
  [/unknown\b/gi, "未知"],
  [/unauthorized\b/gi, "未授权"],
  [/forbidden\b/gi, "禁止访问"],
  [/pushing\b/gi, "推送中"],
  [/pushed\b/gi, "已推送"],
  [/tagging\b/gi, "标记中"],
  [/tagged\b/gi, "已标记"],
  [/digest\b/gi, "摘要"],
  [/status\b/gi, "状态"],
  [/from\b/gi, "来自"],
  [/library\b/gi, "官方库"],
  [/layer\b/gi, "分层"],
  [/fs\b/gi, "文件系统"],
  [/image\b/gi, "镜像"],
  [/validating\b/gi, "正在校验"],
  [/endpoint\b/gi, "端点"],
  [/fs layer\b/gi, "文件分层"],
  [/ on /gi, "在"],
];

const resticRegexRules: [RegExp, string][] = [
  [/searching used packs\.\.\./gi, "检索正在使用的数据包..."],
  [/collecting packs for deletion and repacking/gi, "收集待删除/重新打包的数据包"],
  [/totally used packs:/gi, "完全占用数据包："],
  [/partly used packs:/gi, "部分占用数据包："],
  [/unused packs:/gi, "闲置数据包："],
  [/unused size after prune:/gi, "清理完成后的闲置空间："],
  [/of remaining size/gi, "剩余待处理大小"],
  [/of total size/gi, "原始总大小"],
  [/\bno errors were found\b/gi, "未检测到任何错误"],
  [/loading all snapshots\.\.\./gi, "正在加载全部快照..."],
  [/check snapshots,\s*trees and blobs/gi, "校验快照、目录树与数据块"],
  [/all packs/gi, "所有数据包"],
  [/unused size:\s*(\d+\.\d+)%\s+of/gi, "闲置大小：$1% 占"],
  [/\s*of\s+remaining\s+size/gi, "剩余待处理大小"],
  [/unused size\s*:\s*of/g, "闲置大小：占"],
  [/unused size\s*:/gi, "闲置大小："],
  [/total\s*:/gi, "总计："],
  [/unused\s*:/gi, "未使用："],
  [/to repack\s*:/gi, "需要重新打包："],
  [/to delete\s*:/gi, "将移除："],
  [/trees and/gi, "目录树与"],
  [/(^|\s)\bcheck\b(?=\s|,|$)/gi, "$1校验"],
  [/\sof(?=\s*\d{1,3}\.\d+%)/gi, "占"],
  [/(\[\d+:\d+\]) (\d+) snapshots/g, "$1 $2 个快照"],
  [/loaded (\d+) indexes/g, "已加载 $1 条索引"],
  [/processed (\d+) packs/g, "已处理 $1 个数据包"],
  [/(\d+) snapshots found/g, "共找到 $1 个快照"],
  [/(\d+) files, (\d+) dirs/g, "$1 个文件，$2 个目录"],
  [/scanned (\d+) files in ([\s\S]+)/g, "扫描路径 $2，共 $1 个文件"],
  [/\bblobs\b/g, "数据块"],
  [/\bpacks\b/gi, "数据包"],
  [/\bdone\b/gi, "执行完成"],
  [/used:\s*/gi, "已占用："],
  [/unused:\s*/gi, "未使用："],
  [/total:\s*/gi, "总计："],
  [/remaining:\s*/gi, "剩余待处理："],
];

const precompiledResticRules = Object.entries(LabelMaps.restic)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([en, cn]) => [new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), cn] as [RegExp, string]);


const commonGroups = Object.entries(LabelMaps).filter(([key]) => key !== "restic");
const FlatCommonLabelMap: Record<string, string> = commonGroups.reduce(
  (prev, [_, curr]) => ({ ...prev, ...curr }),
  {}
);

const FlatResticOnlyMap: Record<string, string> = { ...LabelMaps.restic };

export function getLabelText(
  value?: string,
  type: "default" | "health" | "restartPolicy" = "default",
): string {
  if (!value) return value ?? "";
  let text = value;
  const bumpMap = LabelMaps.bump;
  if (Object.keys(bumpMap).includes(text)) {
    return bumpMap[text as keyof typeof bumpMap];
  }
  const roleMap = LabelMaps.role;
  const lowerText = text.trim().toLowerCase();
  if (roleMap[lowerText as keyof typeof roleMap]) {
    return roleMap[lowerText as keyof typeof roleMap];
  }
  for (const [reg, template] of composeLogRules) {
    text = text.replace(reg, template);
  }
  if (type === "health") {
    const lowerVal = text.toLowerCase();
    return FlatCommonLabelMap[lowerVal] || "启动中";
  }
  if (type === "restartPolicy") {
    const lowerVal = text.toLowerCase();
    return FlatCommonLabelMap[lowerVal] || "无";
  }
  
  // ========== 修复：保留原字符串前后空白 ==========
  const trimmedText = text.trim();
  if (FlatCommonLabelMap[trimmedText]) {
    return text.replace(trimmedText, FlatCommonLabelMap[trimmedText]);
  }
  return text;
}

export function getResticText(value?: string): string {
  if (!value) return value ?? "";
  let text = value;

  for (const [reg, template] of resticRegexRules) {
    text = text.replace(reg, template);
  }

  for (const [reg, template] of precompiledResticRules) {
    text = text.replace(reg, template);
  }

  text = getLabelText(text);

  const trimmed = text.trim();
  if (FlatResticOnlyMap[trimmed]) {
    text = FlatResticOnlyMap[trimmed];
  }

  return text;
}
