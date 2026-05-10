import type { ColumnConfig, GridId } from '$lib/types';

// Container grid columns
export const containerColumns: ColumnConfig[] = [
	{ id: 'select', label: '', fixed: 'start', width: 32, resizable: false },
	{ id: 'name', label: '名称', sortable: true, sortField: 'name', width: 140, minWidth: 80, grow: true },
	{ id: 'image', label: '镜像', sortable: true, sortField: 'image', width: 180, minWidth: 100, grow: true },
	{ id: 'state', label: '状态', sortable: true, sortField: 'state', width: 90, minWidth: 70, noTruncate: true },
	{ id: 'health', label: '健康', sortable: true, sortField: 'health', width: 55, minWidth: 40 },
	{ id: 'uptime', label: '运行时间', sortable: true, sortField: 'uptime', width: 80, minWidth: 60 },
	{ id: 'restartCount', label: '重启次数', width: 70, minWidth: 50 },
	{ id: 'cpu', label: 'CPU', sortable: true, sortField: 'cpu', width: 50, minWidth: 40, align: 'right' },
	{ id: 'memory', label: '内存', sortable: true, sortField: 'memory', width: 60, minWidth: 50, align: 'right' },
	{ id: 'networkIO', label: '网络 I/O', width: 85, minWidth: 70, align: 'right' },
	{ id: 'diskIO', label: '磁盘 I/O', width: 85, minWidth: 70, align: 'right' },
	{ id: 'ip', label: 'IP', sortable: true, sortField: 'ip', width: 100, minWidth: 80 },
	{ id: 'ports', label: '端口', sortable: true, sortField: 'ports', width: 120, minWidth: 60 },
	{ id: 'autoUpdate', label: '自动更新', width: 95, minWidth: 70 },
	{ id: 'stack', label: '堆栈', sortable: true, sortField: 'stack', width: 100, minWidth: 60 },
	{ id: 'actions', label: '', fixed: 'end', width: 200, minWidth: 150, resizable: true }
];

// Image grid columns
export const imageColumns: ColumnConfig[] = [
	{ id: 'select', label: '', fixed: 'start', width: 32, resizable: false },
	{ id: 'expand', label: '', fixed: 'start', width: 24, resizable: false },
	{ id: 'image', label: '镜像', sortable: true, sortField: 'name', width: 220, minWidth: 120, grow: true },
	{ id: 'tags', label: '标签', sortable: true, sortField: 'tags', width: 80, minWidth: 50 },
	{ id: 'size', label: '大小', sortable: true, sortField: 'size', width: 80, minWidth: 60 },
	{ id: 'updated', label: '更新时间', sortable: true, sortField: 'created', width: 140, minWidth: 100 },
	{ id: 'actions', label: '', fixed: 'end', width: 120, resizable: false }
];

// Image tags grid columns (nested inside expanded image row)
export const imageTagColumns: ColumnConfig[] = [
	{ id: 'tag', label: '标签', width: 180, minWidth: 60 },
	{ id: 'id', label: 'ID', width: 120, minWidth: 80 },
	{ id: 'size', label: '大小', width: 80, minWidth: 60 },
	{ id: 'created', label: '创建时间', width: 140, minWidth: 100 },
	{ id: 'used', label: '被使用', width: 100, minWidth: 70 },
	{ id: 'actions', label: '', fixed: 'end', width: 200, resizable: false }
];

// Network grid columns
export const networkColumns: ColumnConfig[] = [
	{ id: 'select', label: '', fixed: 'start', width: 32, resizable: false },
	{ id: 'name', label: '名称', sortable: true, sortField: 'name', width: 260, minWidth: 120, grow: true },
	{ id: 'driver', label: '驱动', sortable: true, sortField: 'driver', width: 100, resizable: false },
	{ id: 'scope', label: '作用域', width: 80, minWidth: 50 },
	{ id: 'subnet', label: '子网', sortable: true, sortField: 'subnet', width: 160, minWidth: 100 },
	{ id: 'gateway', label: '网关', sortable: true, sortField: 'gateway', width: 140, minWidth: 100 },
	{ id: 'containers', label: '容器', sortable: true, sortField: 'containers', width: 100, minWidth: 70 },
	{ id: 'actions', label: '', fixed: 'end', width: 160, resizable: false }
];

// Stack grid columns
export const stackColumns: ColumnConfig[] = [
	{ id: 'select', label: '', fixed: 'start', width: 32, resizable: false },
	{ id: 'expand', label: '', fixed: 'start', width: 24, resizable: false },
	{ id: 'name', label: '名称', sortable: true, sortField: 'name', width: 180, minWidth: 100, grow: true },
	{ id: 'status', label: '状态', sortable: true, sortField: 'status', width: 120, minWidth: 90 },
	{ id: 'source', label: '来源', width: 100, minWidth: 100, noTruncate: true },
	{ id: 'location', label: '路径', width: 180, minWidth: 100 },
	{ id: 'containers', label: '容器', sortable: true, sortField: 'containers', width: 100, minWidth: 70 },
	{ id: 'cpu', label: 'CPU', sortable: true, sortField: 'cpu', width: 60, minWidth: 50, align: 'right' },
	{ id: 'memory', label: '内存', sortable: true, sortField: 'memory', width: 70, minWidth: 50, align: 'right' },
	{ id: 'networkIO', label: '网络 I/O', width: 100, minWidth: 70, align: 'right' },
	{ id: 'diskIO', label: '磁盘 I/O', width: 100, minWidth: 70, align: 'right' },
	{ id: 'networks', label: '网络', width: 80, minWidth: 60 },
	{ id: 'volumes', label: '数据卷', width: 80, minWidth: 60 },
	{ id: 'actions', label: '', fixed: 'end', width: 180, resizable: false }
];

// Volume grid columns
export const volumeColumns: ColumnConfig[] = [
	{ id: 'select', label: '', fixed: 'start', width: 32, resizable: false },
	{ id: 'name', label: '名称', sortable: true, sortField: 'name', width: 400, minWidth: 150, grow: true },
	{ id: 'driver', label: '驱动', sortable: true, sortField: 'driver', width: 80, minWidth: 60 },
	{ id: 'scope', label: '作用域', width: 70, minWidth: 50 },
	{ id: 'stack', label: '堆栈', sortable: true, sortField: 'stack', width: 120, minWidth: 80 },
	{ id: 'usedBy', label: '被使用', width: 150, minWidth: 80 },
	{ id: 'created', label: '创建时间', sortable: true, sortField: 'created', width: 160, minWidth: 120 },
	{ id: 'actions', label: '', fixed: 'end', width: 160, resizable: false }
];

// Activity grid columns (no selection, no column reordering - simpler grid)
export const activityColumns: ColumnConfig[] = [
	{ id: 'timestamp', label: '时间戳', width: 160, minWidth: 140 },
	{ id: 'environment', label: '环境', width: 180, minWidth: 100 },
	{ id: 'action', label: '操作', width: 60, resizable: false },
	{ id: 'container', label: '容器', width: 240, minWidth: 120, grow: true },
	{ id: 'image', label: '镜像', width: 260, minWidth: 120 },
	{ id: 'exitCode', label: '退出码', width: 50, minWidth: 40 },
	{ id: 'actions', label: '', fixed: 'end', width: 50, resizable: false }
];

// Audit log grid columns
export const auditColumns: ColumnConfig[] = [
	{ id: 'timestamp', label: '时间戳', width: 165, minWidth: 140 },
	{ id: 'environment', label: '环境', width: 140, minWidth: 100 },
	{ id: 'user', label: '用户', width: 120, minWidth: 80 },
	{ id: 'action', label: '操作', width: 55, resizable: false },
	{ id: 'entity', label: '实体', width: 100, minWidth: 80 },
	{ id: 'name', label: '名称', width: 200, minWidth: 100, grow: true },
	{ id: 'ip', label: 'IP 地址', width: 120, minWidth: 90 },
	{ id: 'actions', label: '', fixed: 'end', width: 50, resizable: false }
];

// Schedule grid columns
export const scheduleColumns: ColumnConfig[] = [
	{ id: 'expand', label: '', fixed: 'start', width: 24, resizable: false },
	{ id: 'schedule', label: '计划任务', width: 450, minWidth: 300, grow: true },
	{ id: 'environment', label: '环境', width: 140, minWidth: 100 },
	{ id: 'cron', label: '计划', width: 180, minWidth: 120 },
	{ id: 'lastRun', label: '上次运行', width: 160, minWidth: 120 },
	{ id: 'nextRun', label: '下次运行', width: 160, minWidth: 100 },
	{ id: 'status', label: '状态', width: 70, resizable: false },
	{ id: 'actions', label: '', fixed: 'end', width: 100, resizable: false }
];

// Environment grid columns (dashboard list view)
export const environmentColumns: ColumnConfig[] = [
	{ id: 'status', label: '', width: 36, resizable: false },
	{ id: 'name', label: '环境', sortable: true, sortField: 'name', width: 180, minWidth: 100, grow: true },
	{ id: 'connection', label: '连接', sortable: true, sortField: 'connection', width: 110, minWidth: 80 },
	{ id: 'host', label: '主机', sortable: true, sortField: 'host', width: 150, minWidth: 80 },
	{ id: 'containers', label: '容器', sortable: true, sortField: 'containers', width: 100, minWidth: 70 },
	{ id: 'updates', label: '更新', sortable: true, sortField: 'updates', width: 75, minWidth: 55 },
	{ id: 'cpu', label: 'CPU', sortable: true, sortField: 'cpu', width: 110, minWidth: 80 },
	{ id: 'memory', label: '内存', sortable: true, sortField: 'memory', width: 110, minWidth: 80 },
	{ id: 'images', label: '镜像', sortable: true, sortField: 'images', width: 65, minWidth: 50 },
	{ id: 'volumes', label: '数据卷', sortable: true, sortField: 'volumes', width: 70, minWidth: 50 },
	{ id: 'stacks', label: '堆栈', sortable: true, sortField: 'stacks', width: 85, minWidth: 65 },
	{ id: 'events', label: '事件', sortable: true, sortField: 'events', width: 65, minWidth: 50 },
	{ id: 'labels', label: '标签', width: 150, minWidth: 80 }
];

// Map of grid ID to column definitions
export const gridColumnConfigs: Record<GridId, ColumnConfig[]> = {
	containers: containerColumns,
	images: imageColumns,
	imageTags: imageTagColumns,
	networks: networkColumns,
	stacks: stackColumns,
	volumes: volumeColumns,
	activity: activityColumns,
	schedules: scheduleColumns,
	audit: auditColumns,
	environments: environmentColumns
};

// Get configurable columns (not fixed)
export function getConfigurableColumns(gridId: GridId): ColumnConfig[] {
	return gridColumnConfigs[gridId].filter((col) => !col.fixed);
}

// Get fixed columns at start
export function getFixedStartColumns(gridId: GridId): ColumnConfig[] {
	return gridColumnConfigs[gridId].filter((col) => col.fixed === 'start');
}

// Get fixed columns at end
export function getFixedEndColumns(gridId: GridId): ColumnConfig[] {
	return gridColumnConfigs[gridId].filter((col) => col.fixed === 'end');
}

// Get default column visibility preferences for a grid
export function getDefaultColumnPreferences(gridId: GridId): { id: string; visible: boolean }[] {
	return getConfigurableColumns(gridId).map((col) => ({
		id: col.id,
		visible: true
	}));
}

// Get all column configs (fixed + configurable in order)
export function getAllColumnConfigs(gridId: GridId): ColumnConfig[] {
	return gridColumnConfigs[gridId];
}
