#!/bin/sh
#
# PostgreSQL: Emergency script to create an admin user
# Use this if you're locked out of Dockhand and need to create a new admin
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/postgres/create-admin.sh
#
# Default credentials: admin / admin123
# CHANGE THE PASSWORD IMMEDIATELY after logging in!
#
# Requires: DATABASE_URL environment variable
#

set -e

echo "========================================"
echo "  Dockhand - 创建管理员用户 (PostgreSQL)"
echo "========================================"
echo ""
echo "本脚本将创建一个管理员用户，信息如下："
echo "  用户名: admin"
echo "  密码: admin123"
echo ""
echo "如果用户 'admin' 已存在，将会重置密码"
echo "并恢复管理员权限。"
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

# Username and password
USERNAME="admin"
# Password: admin123
# This is an argon2id hash of "admin123" - generated with default argon2 settings
PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$Jq4am2SfyYKmc0PAHe+yzg$cq/27vK/Qg2eZb/jMDy0ExLDhOG+58cKAximxpG5Dss'

echo ""
echo "正在创建管理员用户..."

# Check if admin user already exists
EXISTING=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM users WHERE username='$USERNAME';" 2>/dev/null | tr -d ' ')

if [ "$EXISTING" -gt "0" ]; then
    echo "用户 '$USERNAME' 已存在。"
    echo "正在重置密码并确保账号状态为启用..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "UPDATE users SET password_hash='$PASSWORD_HASH', is_active=true WHERE username='$USERNAME';"
    USER_ID=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT id FROM users WHERE username='$USERNAME';" 2>/dev/null | tr -d ' ')
else
    echo "正在创建新的管理员用户..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "INSERT INTO users (username, password_hash, is_active, auth_provider, created_at, updated_at) VALUES ('$USERNAME', '$PASSWORD_HASH', true, 'local', NOW(), NOW());"
    USER_ID=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT id FROM users WHERE username='$USERNAME';" 2>/dev/null | tr -d ' ')
    echo "管理员用户创建成功。"
fi

# Get the Admin role ID (it's a system role)
ADMIN_ROLE_ID=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT id FROM roles WHERE name='Admin';" 2>/dev/null | tr -d ' ')

if [ -z "$ADMIN_ROLE_ID" ]; then
    echo "警告：数据库中未找到管理员角色。"
    echo "用户已创建，但可能不具备管理员权限。"
    echo "登录后请检查 设置 > 认证 > 角色。"
else
    # Check if user already has Admin role
    HAS_ROLE=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM user_roles WHERE user_id=$USER_ID AND role_id=$ADMIN_ROLE_ID;" 2>/dev/null | tr -d ' ')

    if [ "$HAS_ROLE" -eq "0" ]; then
        echo "正在分配管理员角色..."
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "INSERT INTO user_roles (user_id, role_id, created_at) VALUES ($USER_ID, $ADMIN_ROLE_ID, NOW());"
        echo "管理员角色分配完成。"
    else
        echo "用户已拥有管理员角色。"
    fi
fi

echo ""
echo "登录凭据："
echo "  用户名: admin"
echo "  密码: admin123"
echo ""
echo "警告：登录后请立即修改密码！"
