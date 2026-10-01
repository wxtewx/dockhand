#!/bin/sh
#
# SQLite: Emergency script to factory reset the database
# WARNING: This will DELETE ALL DATA including users, settings, and activity logs!
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/reset-db.sh
#

set -e

echo "========================================"
echo "  Dockhand - 数据库恢复出厂设置 (SQLite)"
echo "========================================"
echo ""
echo "警告：此操作将删除所有数据！"
echo ""
echo "删除内容包括："
echo "  - 所有用户及其配置"
echo "  - 所有会话"
echo "  - 身份认证配置"
echo "  - 操作日志"
echo "  - 环境配置"
echo "  - OIDC/SSO 配置"
echo ""
echo "数据库将在下次启动时重新创建。"
echo ""

# Default database path
DB_PATH="${DOCKHAND_DB:-/app/data/db/dockhand.db}"

# Check if running locally (not in Docker)
if [ ! -f "$DB_PATH" ] && [ -f "./data/db/dockhand.db" ]; then
    DB_PATH="./data/db/dockhand.db"
fi

if [ ! -f "$DB_PATH" ]; then
    echo "错误：未在路径 $DB_PATH 找到数据库"
    echo "无需要重置的内容。"
    exit 0
fi

echo "数据库：$DB_PATH"
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
echo "正在重置前创建备份..."
BACKUP_FILE="${DB_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$DB_PATH" "$BACKUP_FILE"
echo "备份已保存至：$BACKUP_FILE"

echo ""
echo "正在删除数据库..."
rm -f "$DB_PATH"
rm -f "${DB_PATH}-wal"
rm -f "${DB_PATH}-shm"

echo ""
echo "数据库删除成功。"
echo ""
echo "重启 Dockhand 以创建全新数据库："
echo "  docker restart dockhand"
