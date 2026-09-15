#!/bin/sh
#
# SQLite: Emergency script to disable a user's MFA (TOTP)
# Use this if a user is locked out of MFA (lost their authenticator app)
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/reset-mfa.sh <username>
#
# Example:
#   docker exec -it dockhand /app/scripts/emergency/sqlite/reset-mfa.sh admin
#

set -e

echo "========================================"
echo "  Dockhand - 重置用户多因素认证 (SQLite)"
echo "========================================"
echo ""

# Check arguments
if [ -z "$1" ]; then
    echo "用法: $0 <用户名>"
    echo ""
    echo "示例:"
    echo "  $0 admin"
    exit 1
fi

USERNAME="$1"

# Default database path
DB_PATH="${DOCKHAND_DB:-/app/data/db/dockhand.db}"

# Check if running locally (not in Docker)
if [ ! -f "$DB_PATH" ] && [ -f "./data/db/dockhand.db" ]; then
    DB_PATH="./data/db/dockhand.db"
fi

if [ ! -f "$DB_PATH" ]; then
    echo "错误：在 $DB_PATH 未找到数据库"
    echo "请设置 DOCKHAND_DB 环境变量以指定数据库路径"
    exit 1
fi

# Check if user exists
EXISTING=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM users WHERE username='$USERNAME';")

if [ "$EXISTING" -eq "0" ]; then
    echo "错误：未找到用户 '$USERNAME'"
    echo ""
    echo "可用用户列表："
    sqlite3 "$DB_PATH" "SELECT username FROM users;" | while read user; do
        echo "  - $user"
    done
    exit 1
fi

# Show current MFA state
MFA_ENABLED=$(sqlite3 "$DB_PATH" "SELECT mfa_enabled FROM users WHERE username='$USERNAME';")
if [ "$MFA_ENABLED" = "1" ] || [ "$MFA_ENABLED" = "true" ]; then
    STATUS="已启用"
else
    STATUS="已关闭"
fi

echo "本脚本将关闭用户 '$USERNAME' 的多因素认证（TOTP）。"
echo "备用验证码也会被清除，无法再次使用。"
echo ""
echo "数据库: $DB_PATH"
echo "用户名: $USERNAME"
echo "当前多因素认证状态: $STATUS"
echo ""
printf "是否继续？[y/N]: "
read CONFIRM

case "$CONFIRM" in
    [yY]|[yY][eE][sS])
        ;;
    *)
        echo "Aborted."
        exit 0
        ;;
esac

echo ""
echo "正在关闭用户 '$USERNAME' 的多因素认证..."
sqlite3 "$DB_PATH" "UPDATE users SET mfa_enabled=0, mfa_secret=NULL, updated_at=datetime('now') WHERE username='$USERNAME';"

if [ $? -eq 0 ]; then
    echo ""
    echo "已成功关闭用户 '$USERNAME' 的多因素认证。"
    echo "该用户现在可仅使用密码登录，并可在个人资料页面重新开启多因素认证。"
else
    echo "错误：关闭多因素认证失败"
    exit 1
fi
