#!/bin/sh
#
# PostgreSQL: Emergency script to reset a user's password
# Use this if a user is locked out and needs a password reset
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/postgres/reset-password.sh <username> <new_password>
#
# Example:
#   docker exec -it dockhand /app/scripts/emergency/postgres/reset-password.sh admin MyNewPassword123
#
# Requires: DATABASE_URL environment variable
#

set -e

echo "========================================"
echo "  Dockhand - 重置用户密码 (PostgreSQL)"
echo "========================================"
echo ""

# Check arguments
if [ -z "$1" ] || [ -z "$2" ]; then
    echo "用法: $0 <用户名> <新密码>"
    echo ""
    echo "示例:"
    echo "  $0 admin MyNewPassword123"
    exit 1
fi

USERNAME="$1"
NEW_PASSWORD="$2"

# Validate password length
if [ ${#NEW_PASSWORD} -lt 8 ]; then
    echo "错误: 密码长度至少为 8 个字符"
    exit 1
fi

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "错误: 未设置 DATABASE_URL 环境变量"
    echo ""
    echo "示例: DATABASE_URL=postgres://user:pass@host:5432/dockhand"
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

# Check if user exists
EXISTING=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM users WHERE username='$USERNAME';" 2>/dev/null | tr -d ' ')

if [ "$EXISTING" -eq "0" ]; then
    echo "错误: 未找到用户 '$USERNAME'"
    echo ""
    echo "可用用户:"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT username FROM users;" 2>/dev/null | while read user; do
        user=$(echo "$user" | tr -d ' ')
        if [ -n "$user" ]; then
            echo "  - $user"
        fi
    done
    exit 1
fi

echo "此脚本将重置用户 '$USERNAME' 的密码。"
echo ""
echo "数据库: $DB_HOST:$DB_PORT/$DB_NAME"
echo "用户名: $USERNAME"
echo ""
printf "是否继续? [y/N]: "
read CONFIRM

case "$CONFIRM" in
    [yY]|[yY][eE][sS])
        ;;
    *)
        echo "已中止。"
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
         echo "错误: 无法生成密码哈希值 (argon2 不可用)"
        echo "此脚本需要安装了 argon2 模块的 Node.js"
        exit 1
    fi
else
    echo "错误: 需要 Node.js 才能生成密码哈希值"
    exit 1
fi

echo "正在为用户 '$USERNAME' 重置密码..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "UPDATE users SET password_hash='$PASSWORD_HASH', updated_at=NOW() WHERE username='$USERNAME';"

if [ $? -eq 0 ]; then
    echo ""
    echo "用户 '$USERNAME' 的密码已成功重置"
    echo ""
    # Invalidate sessions
    USER_ID=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT id FROM users WHERE username='$USERNAME';" 2>/dev/null | tr -d ' ')
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "DELETE FROM sessions WHERE user_id=$USER_ID;" 2>/dev/null || true
    echo "所有现有会话已失效。"
    echo "用户现在可以使用新密码登录。"
else
    echo "错误: 密码重置失败"
    exit 1
fi
