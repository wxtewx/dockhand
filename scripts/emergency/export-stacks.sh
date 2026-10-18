#!/bin/sh
#
# Emergency script to export all compose stacks
# Exports docker-compose.yml files from the stacks directory
#
# Usage:
#   docker exec -it dockhand /app/scripts/export-stacks.sh [output_dir]
#
# Example:
#   docker exec -it dockhand /app/scripts/export-stacks.sh /tmp/stacks-backup
#
# Default output: /app/data/stacks-export
#

set -e

echo "========================================"
echo "  Dockhand - 导出 Compose 堆栈"
echo "========================================"
echo ""

# Default paths
STACKS_DIR="${DOCKHAND_STACKS:-/home/dockhand/.dockhand/stacks}"
OUTPUT_DIR="${1:-/app/data/stacks-export}"

# Check if running locally (not in Docker)
if [ ! -d "$STACKS_DIR" ] && [ -d "$HOME/.dockhand/stacks" ]; then
    STACKS_DIR="$HOME/.dockhand/stacks"
fi

if [ ! -d "$STACKS_DIR" ]; then
    echo "错误：未找到堆栈目录 $STACKS_DIR"
    exit 1
fi

# Count stacks
STACK_COUNT=$(find "$STACKS_DIR" -maxdepth 1 -type d ! -path "$STACKS_DIR" 2>/dev/null | wc -l | tr -d ' ')

echo "本脚本将导出所有 Compose 堆栈。"
echo ""
echo "堆栈目录：$STACKS_DIR"
echo "输出目录：$OUTPUT_DIR"
echo "找到的堆栈数量：$STACK_COUNT"
echo ""

if [ "$STACK_COUNT" -eq "0" ]; then
    echo "未找到可导出的堆栈。"
    exit 0
fi

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

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "正在导出堆栈..."
echo ""

# Export each stack
find "$STACKS_DIR" -maxdepth 1 -type d ! -path "$STACKS_DIR" | while read stack_dir; do
    STACK_NAME=$(basename "$stack_dir")
    COMPOSE_FILE="$stack_dir/docker-compose.yml"

    if [ -f "$COMPOSE_FILE" ]; then
        mkdir -p "$OUTPUT_DIR/$STACK_NAME"
        cp "$COMPOSE_FILE" "$OUTPUT_DIR/$STACK_NAME/"

        # Also copy .env file if exists
        if [ -f "$stack_dir/.env" ]; then
            cp "$stack_dir/.env" "$OUTPUT_DIR/$STACK_NAME/"
        fi

        echo "  已导出：$STACK_NAME"
    fi
done

echo ""
echo "导出完成！"
echo "堆栈已导出至：$OUTPUT_DIR"
echo ""
echo "从 Docker 容器复制到主机的命令："
echo "  docker cp dockhand:$OUTPUT_DIR ./stacks-backup"
