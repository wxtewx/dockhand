#!/bin/sh
#
# SQLite: Emergency script to backup the database
# Creates a timestamped copy of the database file
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/backup-db.sh [output_dir]
#
# Example:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/backup-db.sh /app/data/backups
#
# Default output: /app/data (same directory as database)
#

set -e

echo "========================================"
echo "  Dockhand - 备份数据库 (SQLite)"
echo "========================================"
echo ""

# Default database path
DB_PATH="${DOCKHAND_DB:-/app/data/db/dockhand.db}"
OUTPUT_DIR="${1:-$(dirname "$DB_PATH")}"

# Check if running locally (not in Docker)
if [ ! -f "$DB_PATH" ] && [ -f "./data/db/dockhand.db" ]; then
    DB_PATH="./data/db/dockhand.db"
    OUTPUT_DIR="${1:-./data/db}"
fi

if [ ! -f "$DB_PATH" ]; then
    echo "错误：未在路径 $DB_PATH 找到数据库"
    echo "请设置 DOCKHAND_DB 环境变量以指定数据库路径"
    exit 1
fi

# Generate backup filename with timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$OUTPUT_DIR/dockhand_backup_$TIMESTAMP.db"

# Get database size
DB_SIZE=$(ls -lh "$DB_PATH" | awk '{print $5}')

echo "本脚本将创建数据库备份。"
echo ""
echo "源文件：$DB_PATH ($DB_SIZE)"
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

# Use sqlite3 backup command for safe backup (handles WAL mode)
if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
else
    # Fallback to file copy if sqlite3 not available
    cp "$DB_PATH" "$BACKUP_FILE"
fi

if [ $? -eq 0 ] && [ -f "$BACKUP_FILE" ]; then
    SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
    echo ""
    echo "备份创建成功！"
    echo "文件大小：$SIZE"
    echo ""
    echo "从 Docker 容器复制到主机的命令："
    echo "  docker cp dockhand:$BACKUP_FILE ./dockhand_backup_$TIMESTAMP.db"
else
    echo "错误：创建备份失败"
    exit 1
fi
