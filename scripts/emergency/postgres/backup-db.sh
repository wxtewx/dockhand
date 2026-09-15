#!/bin/sh
#
# PostgreSQL: Emergency script to backup the database
# Creates a timestamped dump of the database
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/postgres/backup-db.sh [output_dir]
#
# Example:
#   docker exec -it dockhand /app/scripts/emergency/postgres/backup-db.sh /app/data/backups
#
# Default output: /app/data
#
# Requires: DATABASE_URL environment variable
#

set -e

echo "========================================"
echo "  Dockhand - 备份数据库 (PostgreSQL)"
echo "========================================"
echo ""

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "错误：未设置 DATABASE_URL 环境变量"
    echo ""
    echo "示例：DATABASE_URL=postgres://user:pass@host:5432/dockhand"
    exit 1
fi

OUTPUT_DIR="${1:-/app/data}"

# Parse DATABASE_URL
# Format: postgres://user:password@host:port/database
DB_URL="$DATABASE_URL"
DB_URL="${DB_URL#postgres://}"
DB_URL="${DB_URL#postgresql://}"

# Extract credentials
DB_USER="${DB_URL%%:*}"
DB_URL="${DB_URL#*:}"
DB_PASS="${DB_URL%%@*}"
DB_URL="${DB_URL#*@}"
DB_HOST="${DB_URL%%:*}"
DB_URL="${DB_URL#*:}"
DB_PORT="${DB_URL%%/*}"
DB_NAME="${DB_URL#*/}"
DB_NAME="${DB_NAME%%\?*}"

# Generate backup filename with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$OUTPUT_DIR/dockhand_backup_$TIMESTAMP.sql"

echo "本脚本将创建数据库备份。"
echo ""
echo "主机：$DB_HOST:$DB_PORT"
echo "数据库：$DB_NAME"
echo "备份文件：$BACKUP_FILE"
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

echo ""

# Create output directory if needed
mkdir -p "$OUTPUT_DIR"

echo "正在创建数据库备份..."

# Use pg_dump to create backup
export PGPASSWORD="$DB_PASS"
if command -v pg_dump >/dev/null 2>&1; then
    pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -F p -f "$BACKUP_FILE"
else
    echo "错误：未找到 pg_dump 工具"
    echo "请安装 PostgreSQL 客户端工具后再使用此脚本"
    exit 1
fi

if [ $? -eq 0 ] && [ -f "$BACKUP_FILE" ]; then
    SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
    echo ""
    echo "备份创建成功！"
    echo "大小：$SIZE"
    echo ""
    echo "从 Docker 容器复制到主机："
    echo "  docker cp dockhand:$BACKUP_FILE ./dockhand_backup_$TIMESTAMP.sql"
else
    echo "错误：创建备份失败"
    exit 1
fi
