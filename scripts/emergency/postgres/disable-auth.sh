#!/bin/sh
#
# PostgreSQL: Emergency script to disable authentication
# Use this if you're locked out of Dockhand
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/postgres/disable-auth.sh
#
# Requires: DATABASE_URL environment variable
#

set -e

echo "========================================"
echo "  Dockhand - 禁用身份认证 (PostgreSQL)"
echo "========================================"
echo ""
echo "本脚本将禁用身份认证，"
echo "无需登录即可访问 Dockhand。"
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

echo "数据库：$DB_HOST:$DB_PORT/$DB_NAME"
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
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "UPDATE auth_settings SET auth_enabled = false WHERE id = 1;"

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
