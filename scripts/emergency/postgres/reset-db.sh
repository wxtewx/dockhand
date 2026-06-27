#!/bin/sh
#
# PostgreSQL: Emergency script to factory reset the database
# WARNING: This will DELETE ALL DATA including users, settings, and activity logs!
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/postgres/reset-db.sh
#
# Requires: DATABASE_URL environment variable
#

set -e

echo "========================================"
echo "  Dockhand - 数据库恢复出厂设置 (PostgreSQL)"
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
echo "数据库表将被清空。"
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
echo "正在重置前创建备份..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/app/data/dockhand_backup_pre_reset_$TIMESTAMP.sql"
if command -v pg_dump >/dev/null 2>&1; then
    pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -F p -f "$BACKUP_FILE" 2>/dev/null || true
    if [ -f "$BACKUP_FILE" ]; then
        echo "备份已保存至：$BACKUP_FILE"
    fi
fi

echo ""
echo "正在清空所有表..."

# Truncate all tables in the correct order (respecting foreign keys)
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<EOF
TRUNCATE TABLE
    sessions,
    user_roles,
    dashboard_preferences,
    audit_logs,
    container_events,
    vulnerability_scans,
    stack_sources,
    git_stacks,
    git_repositories,
    git_credentials,
    host_metrics,
    stack_events,
    environment_notifications,
    auto_update_settings,
    users,
    roles,
    oidc_config,
    ldap_config,
    auth_settings,
    notification_settings,
    config_sets,
    registries,
    environments,
    settings
CASCADE;
EOF

echo ""
echo "数据库重置成功。"
echo ""
echo "重启 Dockhand 以重新创建默认数据："
echo "  docker restart dockhand"
