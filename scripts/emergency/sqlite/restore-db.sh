#!/bin/sh
#
# SQLite: Emergency script to restore the database from a backup
# WARNING: This will overwrite the current database!
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/restore-db.sh <backup_file>
#
# Example:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/restore-db.sh /app/data/dockhand_backup_20240115_120000.db
#
# To copy backup into container first:
#   docker cp ./dockhand_backup.db dockhand:/app/data/
#

set -e

echo "========================================"
echo "  Dockhand - 从备份恢复数据库 (SQLite)"
echo "========================================"
echo ""

# Check argument
if [ -z "$1" ]; then
    echo "用法：$0 <备份文件路径>"
    echo ""
    echo "示例："
    echo "  $0 /app/data/dockhand_backup_20240115_120000.db"
    echo ""
    echo "如需先将备份文件复制到容器内："
    echo "  docker cp ./dockhand_backup.db dockhand:/app/data/"
    exit 1
fi

BACKUP_FILE="$1"

# Default database path
DB_PATH="${DOCKHAND_DB:-/app/data/db/dockhand.db}"

# Check if running locally (not in Docker)
if [ ! -f "$DB_PATH" ] && [ -f "./data/db/dockhand.db" ]; then
    DB_PATH="./data/db/dockhand.db"
fi

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "错误：未找到备份文件：$BACKUP_FILE"
    exit 1
fi

# Verify it's a valid SQLite database
if ! sqlite3 "$BACKUP_FILE" "SELECT 1;" >/dev/null 2>&1; then
    echo "错误：文件不是有效的 SQLite 数据库：$BACKUP_FILE"
    exit 1
fi

# Get backup file size
BACKUP_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')

echo "警告：此操作将覆盖当前数据库！"
echo ""
echo "当前数据库：$DB_PATH"
echo "要恢复的备份：$BACKUP_FILE ($BACKUP_SIZE)"
echo ""
printf "是否继续？[y/N]："
read CONFIRM

case "$CONFIRM" in
    [yY]|[yY][eE][sS])
        ;;
    *)
        echo "已取消。"
        exit 0
        ;;
esac

# Create backup of current database before restoring
if [ -f "$DB_PATH" ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    PRE_RESTORE_BACKUP="${DB_PATH}.pre-restore.$TIMESTAMP"
    echo ""
    echo "正在为当前数据库创建备份..."
    cp "$DB_PATH" "$PRE_RESTORE_BACKUP"
    echo "当前数据库已备份至：$PRE_RESTORE_BACKUP"
fi

echo ""
echo "正在恢复数据库..."

# Remove WAL files if they exist
rm -f "${DB_PATH}-wal"
rm -f "${DB_PATH}-shm"

# Copy backup to database location
cp "$BACKUP_FILE" "$DB_PATH"

if [ $? -eq 0 ]; then
    echo ""
    echo "数据库恢复成功！"
    echo ""
    echo "重启 Dockhand 以应用更改："
    echo "  docker restart dockhand"
else
    echo "错误：恢复数据库失败"
    exit 1
fi
