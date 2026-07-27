#!/bin/sh
#
# SQLite: Emergency script to list all users
# Shows username, admin status, active status, and last login
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/list-users.sh
#

set -e

echo "========================================"
echo "  Dockhand - 用户列表 (SQLite)"
echo "========================================"
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

# Get user count
USER_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users;")

if [ "$USER_COUNT" -eq "0" ]; then
    echo "未找到任何用户。"
    exit 0
fi

# Get Admin role ID for checking admin status
ADMIN_ROLE_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM roles WHERE name='Admin';" 2>/dev/null || echo "")

# Print header
printf "%-4s %-20s %-8s %-8s %-6s %s\n" "ID" "用户名" "管理员" "启用" "MFA" "最后登录"
printf "%-4s %-20s %-8s %-8s %-6s %s\n" "----" "--------------------" "--------" "--------" "------" "-------------------"

# List users (check admin status via user_roles table)
sqlite3 -separator '|' "$DB_PATH" "SELECT id, username, is_active, mfa_enabled, COALESCE(last_login, 'Never') FROM users ORDER BY id;" | while IFS='|' read id username is_active mfa_enabled last_login; do
    # Check if user has Admin role
    if [ -n "$ADMIN_ROLE_ID" ]; then
        HAS_ADMIN=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM user_roles WHERE user_id=$id AND role_id=$ADMIN_ROLE_ID;")
        if [ "$HAS_ADMIN" -gt "0" ]; then
            admin_str="是"
        else
            admin_str="否"
        fi
    else
        admin_str="不适用"
    fi

    if [ "$is_active" = "1" ]; then
        active_str="是"
    else
        active_str="否"
    fi

    if [ "$mfa_enabled" = "1" ]; then
        mfa_str="是"
    else
        mfa_str="否"
    fi

    printf "%-4s %-20s %-8s %-8s %-6s %s\n" "$id" "$username" "$admin_str" "$active_str" "$mfa_str" "$last_login"
done

echo ""
echo "总计：$USER_COUNT 个用户"

# Show session count
SESSION_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sessions;")
echo "活跃会话数：$SESSION_COUNT"
