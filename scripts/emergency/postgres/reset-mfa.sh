#!/bin/sh
#
# PostgreSQL: Emergency script to disable a user's MFA (TOTP)
# Use this if a user is locked out of MFA (lost their authenticator app)
#
# Usage:
#   docker exec -it dockhand /app/scripts/emergency/postgres/reset-mfa.sh <username>
#
# Example:
#   docker exec -it dockhand /app/scripts/emergency/postgres/reset-mfa.sh admin
#

set -e

echo "============================================"
echo "  Dockhand - 重置用户多因素认证 (PostgreSQL)"
echo "============================================"
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

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    echo "错误：未设置 DATABASE_URL 环境变量"
    echo ""
    echo "示例: DATABASE_URL=postgres://user:pass@host:5432/dockhand"
    exit 1
fi

cd /app 2>/dev/null || true

# Check if user exists using psql
USER_EXISTS=$(psql "$DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM users WHERE username = '$USERNAME';" 2>/dev/null)

if [ "$USER_EXISTS" = "0" ]; then
    echo "错误：未找到用户 '$USERNAME'"
    echo ""
    echo "可用用户列表："
    psql "$DATABASE_URL" -t -A -c "SELECT username FROM users;" 2>/dev/null | while read user; do
        echo "  - $user"
    done
    exit 1
fi

# Show current MFA state
MFA_ENABLED=$(psql "$DATABASE_URL" -t -A -c "SELECT mfa_enabled FROM users WHERE username = '$USERNAME';" 2>/dev/null)
if [ "$MFA_ENABLED" = "t" ] || [ "$MFA_ENABLED" = "true" ]; then
    STATUS="已启用"
else
    STATUS="已关闭"
fi

echo "本脚本将关闭用户 '$USERNAME' 的多因素认证 (TOTP)。"
echo "备用验证码也会被清除，无法再次使用。"
echo ""
echo "数据库: $DATABASE_URL"
echo "用户名: $USERNAME"
echo "当前多因素认证状态: $STATUS"
echo ""
printf "是否继续？ [y/N]: "
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
echo "Disabling MFA for user '$USERNAME'..."
psql "$DATABASE_URL" -c "UPDATE users SET mfa_enabled = false, mfa_secret = NULL, updated_at = NOW() WHERE username = '$USERNAME';"

if [ $? -eq 0 ]; then
    echo ""
    echo "已成功关闭用户 '$USERNAME' 的多因素认证。"
    echo "该用户现在可仅使用密码登录，并可在个人资料页面重新开启多因素认证。"
else
    echo "错误：关闭多因素认证失败"
    exit 1
fi
