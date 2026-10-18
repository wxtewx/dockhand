#!/bin/sh
#
# SQLite: Emergency script to clear all user sessions
# Use this to force all users to re-login
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/clear-sessions.sh
#

set -e

echo "========================================"
echo "  Dockhand - 清空所有会话 (SQLite)"
echo "========================================"
echo ""
echo "本脚本将清空所有用户会话，"
echo "强制所有用户重新登录。"
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

COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sessions;")

echo "数据库：$DB_PATH"
echo "活跃会话数：$COUNT"
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
echo "正在清空所有用户会话..."
sqlite3 "$DB_PATH" "DELETE FROM sessions;"

if [ $? -eq 0 ]; then
    echo ""
    echo "成功清空 $COUNT 个会话。"
    echo "所有用户需要重新登录。"
else
    echo "错误：清空会话失败"
    exit 1
fi
