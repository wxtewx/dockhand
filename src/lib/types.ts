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
export type GridId = 'containers' | 'images' | 'imageTags' | 'networks' | 'stacks' | 'volumes' | 'activity' | 'schedules' | 'audit' | 'environments' | 'backupDestinations' | 'backups' | 'repoSnapshots' | 'vulnerabilities';

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
  pull: {
    pulling: "拉取中",
    Waiting: "等待中",
    Downloading: "下载中",
    Extracting: "解压中",
    Extracted: "已解压",
    download: "下载",
    complete: "完成",
    idle: "空闲",
    error: "错误",
    failed: "失败",
    timeout: "超时",
    unknown: "未知",
    unauthorized: "未授权",
    forbidden: "禁止访问",
    pushing: "推送中",
    pushed: "已推送",
    tagging: "标记中",
    tagged: "已标记",
    digest: "摘要",
    status: "状态",
    from: "来自",
    library: "官方库",
    layer: "分层",
    fs: "文件系统",
    image: "镜像",
    validating: "正在校验",
    endpoint: "端点",
    "fs layer": "文件分层",
    "Pull complete": "拉取完成",
    "Download complete": "下载完成",
    "Downloaded newer image for": "已下载适用于",
    "Pulling from": "从仓库拉取",
    "already exists": "镜像已存在",
    "Already exists": "镜像已存在",
    "Verifying Checksum": "校验完整性",
    "manifest unknown": "镜像清单不存在",
    "not found": "不存在",
    "connection refused": "连接拒绝",
    "no such host": "找不到主机",
    "invalid reference": "无效镜像地址",
    "Downloaded newer image": "已下载新版本镜像",
    "is up to date for": "镜像已是最新版本：",
    "Error response from daemon": "守护进程错误",
    "failed to set up container networking": "容器网络配置失败",
    "driver failed programming external connectivity":
      "网络驱动配置外部连接失败",
    "Bind for": "端口绑定",
    "failed: port is already allocated": "失败：端口已被占用",
    "port is already allocated": "端口已被占用",
    " on ": "在",
    "exit code": "退出码",
    "permission denied": "权限不足",
    "no such container": "容器不存在",
    "container not found": "容器未找到",
    "network not found": "网络不存在",
    "volume not found": "数据卷不存在",
    "failed to create task for container": "为容器创建任务失败",
    "failed to create shim task": "创建运行环境任务失败",
    "OCI runtime create failed": "OCI 运行时创建失败",
    "runc create failed": "runc 创建失败",
    "unable to start container process": "无法启动容器进程",
    "error during container init": "容器初始化时出错",
    "error mounting": "挂载出错",
    "to rootfs at": "到 root 文件系统路径：",
    "not a directory": "不是一个目录",
    "Are you trying to mount a directory onto a file (or vice-versa)?":
      "你可能将目录挂载到了文件，或文件挂载到了目录 (格式不匹配)？",
    "Check if the specified host path exists and is the expected type":
      "请检查主机路径是否存在，且类型正确",
    "mount src=": "源路径=",
    "dst=": "目标路径=",
    "flags=": "挂载标记=",
    "failed to resolve reference": "解析镜像引用失败",
    "unexpected status from HEAD request": "HEAD 请求返回异常状态码",
    "403 Forbidden": "403 禁止访问",
    "invalid restart policy": "无效的重启策略",
    "unknown policy": "未知策略",
    "use one of": "请使用以下值之一",
    "additional properties": "存在不允许的额外属性",
    "not allowed": "不允许使用",
    "failed to parse": "解析失败",
    "yaml: line": "YAML 文件第",
    "mapping values are not allowed in this context":
      "此位置不允许使用映射格式 (YAML 语法错误)",
    "service ": "服务 ",
    '" refers to undefined network ': '" 引用了未定义的网络 ',
    '" refers to undefined volume ': '" 引用了未定义的数据卷 ',
    '" depends on undefined service ': '" 依赖了未定义的服务 ',
    ": invalid compose project": "：无效的 Compose 项目",
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

const precompiledPullRules = Object.entries(LabelMaps.pull)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([en, cn]) => [new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), cn] as [RegExp, string]);

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

  const roleMap = LabelMaps.role;
  const lowerText = text.trim().toLowerCase();
  if (roleMap[lowerText as keyof typeof roleMap]) {
    return roleMap[lowerText as keyof typeof roleMap];
  }

  for (const [reg, template] of precompiledPullRules) {
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

  const actions = LabelMaps.action;
  for (const key in actions) {
    if (Object.prototype.hasOwnProperty.call(actions, key)) {
      const reg = new RegExp(`\\b${key}\\b`, "gi");
      text = text.replace(reg, actions[key as keyof typeof actions]);
    }
  }

  if (FlatCommonLabelMap[text.trim()]) {
    return FlatCommonLabelMap[text.trim()];
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
