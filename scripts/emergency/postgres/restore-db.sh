#!/bin/sh
#
# PostgreSQL: Emergency script to restore the database from a backup
# WARNING: This will overwrite the current database!
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/postgres/restore-db.sh <backup_file>
#
# Example:
#   docker exec -it dockhand /app/scripts/emergency/postgres/restore-db.sh /app/data/dockhand_backup_20240115_120000.sql
#
# To copy backup into container first:
#   docker cp ./dockhand_backup.sql dockhand:/app/data/
#
# Requires: DATABASE_URL environment variable
#

set -e

echo "========================================"
echo "  Dockhand - 恢复数据库 (PostgreSQL)"
echo "========================================"
echo ""

# Check argument
if [ -z "$1" ]; then
    echo "用法: $0 <备份文件>"
    echo ""
    echo "示例:"
    echo "  $0 /app/data/dockhand_backup_20240115_120000.sql"
    echo ""
    echo "如需先将备份文件复制到容器内:"
    echo "  docker cp ./dockhand_backup.sql dockhand:/app/data/"
    exit 1
fi

BACKUP_FILE="$1"

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "错误: 未设置 DATABASE_URL 环境变量"
    echo ""
    echo "示例: DATABASE_URL=postgres://user:pass@host:5432/dockhand"
    exit 1
fi

# Parse DATABASE_URL
DB_URL="$DATABASE_URL"
DB_URL="${DB_URL#postgres://}"
DB_URL="${DB_URL#postgresql://}"

DB_USER="${DB_URL%%:*}"
DB_URL="${DB_URL#*:}"
DB_PASS="${DB_URL%%@*}"
DB_URL="${DB_URL#*@}"
DB_HOST="${DB_URL%%:*}"
DB_URL="${DB_URL#*:}"
DB_PORT="${DB_URL%%/*}"
DB_NAME="${DB_URL#*/}"
DB_NAME="${DB_NAME%%\?*}"

export PGPASSWORD="$DB_PASS"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "错误: 未找到备份文件: $BACKUP_FILE"
    exit 1
fi

# Get backup file size
BACKUP_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')

echo "警告: 此操作将覆盖当前数据库!"
echo ""
echo "数据库: $DB_HOST:$DB_PORT/$DB_NAME"
echo "要恢复的备份: $BACKUP_FILE ($BACKUP_SIZE)"
echo ""
printf "是否继续? [y/N]: "
read CONFIRM

case "$CONFIRM" in
    [yY]|[yY][eE][sS])
        ;;
    *)
        echo "已中止。"
        exit 0
        ;;
esac

# Create backup of current database before restoring
echo ""
echo "正在为当前数据库创建备份..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PRE_RESTORE_BACKUP="/app/data/dockhand_pre_restore_$TIMESTAMP.sql"
if command -v pg_dump >/dev/null 2>&1; then
    pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -F p -f "$PRE_RESTORE_BACKUP" 2>/dev/null || true
    if [ -f "$PRE_RESTORE_BACKUP" ]; then
        echo "当前数据库已备份至: $PRE_RESTORE_BACKUP"
    fi
fi

echo ""
echo "正在恢复数据库..."

# Drop and recreate all tables by running the backup
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "数据库恢复成功!"
    echo ""
    echo "重启 Dockhand 以应用更改:"
    echo "  docker restart dockhand"
else
     echo "错误: 数据库恢复失败"
    exit 1
fi
