#!/bin/sh
#
# PostgreSQL: Emergency script to clear all user sessions
# Use this to force all users to re-login
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/postgres/clear-sessions.sh
#
# Requires: DATABASE_URL environment variable
#

set -e

echo "========================================"
echo "  Dockhand - 清空所有会话 (PostgreSQL)"
echo "========================================"
echo ""
echo "本脚本将清空所有用户会话，"
echo "强制所有用户重新登录。"
echo ""

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "错误：未设置 DATABASE_URL 环境变量"
    echo ""
    echo "示例：DATABASE_URL=postgres://user:pass@host:5432/dockhand"
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

COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM sessions;" 2>/dev/null | tr -d ' ')

echo "数据库：$DB_HOST:$DB_PORT/$DB_NAME"
echo "当前活跃会话数：$COUNT"
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
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "DELETE FROM sessions;"

if [ $? -eq 0 ]; then
    echo ""
    echo "成功清空 $COUNT 个会话。"
    echo "所有用户需要重新登录。"
else
    echo "错误：清空会话失败"
    exit 1
fi
