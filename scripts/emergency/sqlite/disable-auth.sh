#!/bin/sh
#
# SQLite: Emergency script to disable authentication
# Use this if you're locked out of Dockhand
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/disable-auth.sh
#

set -e

echo "========================================"
echo "  Dockhand - 禁用身份认证 (SQLite)"
echo "========================================"
echo ""
echo "本脚本将禁用身份认证，"
echo "无需登录即可访问 Dockhand。"
echo ""

# Default database path
DB_PATH="${DOCKHAND_DB:-/app/data/db/dockhand.db}"

# Check if running locally (not in Docker)
if [ ! -f "$DB_PATH" ] && [ -f "./data/db/dockhand.db" ]; then
    DB_PATH="./data/db/dockhand.db"
fi

if [ ! -f "$DB_PATH" ]; then
    echo "错误：未在路径 $DB_PATH 找到数据库"
    echo "请设置 DOCKHAND_DB 环境变量以指定数据库路径"
    exit 1
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
echo "正在禁用身份认证..."
sqlite3 "$DB_PATH" "UPDATE auth_settings SET auth_enabled = 0 WHERE id = 1;"

if [ $? -eq 0 ]; then
    echo ""
    echo "身份认证已成功禁用。"
    echo "现在无需登录即可访问 Dockhand。"
    echo ""
    echo "恢复访问后，请记得在设置中重新启用身份认证。"
else
    echo "错误：禁用身份认证失败"
    exit 1
fi
