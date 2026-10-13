#!/bin/sh
#
# SQLite: Emergency script to reset a user's password
# Use this if a user is locked out and needs a password reset
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/reset-password.sh <username> <new_password>
#
# Example:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/reset-password.sh admin MyNewPassword123
#

set -e

echo "========================================"
echo "  Dockhand - 重置用户密码 (SQLite)"
echo "========================================"
echo ""

# Check arguments
if [ -z "$1" ] || [ -z "$2" ]; then
    echo "用法：$0 <用户名> <新密码>"
    echo ""
    echo "示例："
    echo "  $0 admin MyNewPassword123"
    exit 1
fi

USERNAME="$1"
NEW_PASSWORD="$2"

# Validate password length
if [ ${#NEW_PASSWORD} -lt 8 ]; then
    echo "错误：密码长度至少为 8 位"
    exit 1
fi

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

# Check if user exists
EXISTING=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users WHERE username='$USERNAME';")

if [ "$EXISTING" -eq "0" ]; then
    echo "错误：未找到用户 '$USERNAME'"
    echo ""
    echo "可用用户："
    sqlite3 "$DB_PATH" "SELECT username FROM users;" | while read user; do
        echo "  - $user"
    done
    exit 1
fi

echo "本脚本将重置用户 '$USERNAME' 的密码。"
echo ""
echo "数据库：$DB_PATH"
echo "用户名：$USERNAME"
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

# Generate password hash using node (argon2 is available in the app)
echo ""
echo "正在生成密码哈希值..."

# Check if node and argon2 are available
if command -v node >/dev/null 2>&1; then
    # Try to use argon2 from node_modules
    PASSWORD_HASH=$(node -e "
        try {
            const argon2 = require('argon2');
            argon2.hash('$NEW_PASSWORD').then(h => console.log(h)).catch(e => process.exit(1));
        } catch(e) {
            process.exit(1);
        }
    " 2>/dev/null)

    if [ -z "$PASSWORD_HASH" ]; then
        echo "错误：无法生成密码哈希值（argon2 不可用）"
        echo "本脚本需要安装带有 argon2 模块的 Node.js"
        exit 1
    fi
else
    echo "错误：生成密码哈希值需要 Node.js"
    exit 1
fi

echo "正在重置用户 '$USERNAME' 的密码..."
sqlite3 "$DB_PATH" "UPDATE users SET password_hash='$PASSWORD_HASH', updated_at=datetime('now') WHERE username='$USERNAME';"

if [ $? -eq 0 ]; then
    echo ""
    echo "用户 '$USERNAME' 的密码已成功重置"
    echo ""
    # Invalidate sessions
    USER_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM users WHERE username='$USERNAME';")
    sqlite3 "$DB_PATH" "DELETE FROM sessions WHERE user_id=$USER_ID;" 2>/dev/null || true
    echo "所有已存在的会话已失效。"
    echo "用户现在可以使用新密码登录。"
else
    echo "错误：重置密码失败"
    exit 1
fi
