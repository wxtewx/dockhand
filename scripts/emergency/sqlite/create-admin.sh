#!/bin/sh
#
# SQLite: Emergency script to create an admin user
# Use this if you're locked out of Dockhand and need to create a new admin
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/create-admin.sh
#
# Default credentials: admin / admin123
# CHANGE THE PASSWORD IMMEDIATELY after logging in!
#

set -e

echo "========================================"
echo "  Dockhand - 创建管理员用户 (SQLite)"
echo "========================================"
echo ""
echo "本脚本将创建一个管理员用户，信息如下："
echo "  用户名: admin"
echo "  密码: admin123"
echo ""
echo "如果用户 'admin' 已存在，将会重置密码"
echo "并恢复管理员权限。"
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

# Username and password
USERNAME="admin"
# Password: admin123
# This is an argon2id hash of "admin123" - generated with default argon2 settings
PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$Jq4am2SfyYKmc0PAHe+yzg$cq/27vK/Qg2eZb/jMDy0ExLDhOG+58cKAximxpG5Dss'

echo ""
echo "正在创建管理员用户..."

# Check if admin user already exists
EXISTING=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users WHERE username='$USERNAME';")

if [ "$EXISTING" -gt "0" ]; then
    echo "用户 '$USERNAME' 已存在。"
    echo "正在重置密码并确保账号状态为启用..."
    sqlite3 "$DB_PATH" "UPDATE users SET password_hash='$PASSWORD_HASH', is_active=1 WHERE username='$USERNAME';"
    USER_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM users WHERE username='$USERNAME';")
else
    echo "正在创建新的管理员用户..."
    sqlite3 "$DB_PATH" "INSERT INTO users (username, password_hash, is_active, auth_provider, created_at, updated_at) VALUES ('$USERNAME', '$PASSWORD_HASH', 1, 'local', datetime('now'), datetime('now'));"
    USER_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM users WHERE username='$USERNAME';")
    echo "管理员用户创建成功。"
fi

# Get the Admin role ID (it's a system role)
ADMIN_ROLE_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM roles WHERE name='Admin';")

if [ -z "$ADMIN_ROLE_ID" ]; then
    echo "警告：数据库中未找到管理员角色。"
    echo "用户已创建，但可能不具备管理员权限。"
    echo "登录后请检查 设置 > 认证 > 角色。"
else
    # Check if user already has Admin role
    HAS_ROLE=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM user_roles WHERE user_id=$USER_ID AND role_id=$ADMIN_ROLE_ID;")

    if [ "$HAS_ROLE" -eq "0" ]; then
        echo "正在分配管理员角色..."
        sqlite3 "$DB_PATH" "INSERT INTO user_roles (user_id, role_id, created_at) VALUES ($USER_ID, $ADMIN_ROLE_ID, datetime('now'));"
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
