#!/usr/bin/env bash
# 隔离测试窗口：用源码直接跑一个独立实例，不碰已安装的 M↓ Viewer
#
# 特点：
#   - 独立 userData 目录（不影响正式版窗口状态 / 查找历史等）
#   - 独立调试端口（默认 9362，可用第 2 个参数覆盖）
#   - 独立进程：关掉它不会影响用户正在用的窗口
#
# 用法:
#   bash dev/isolated-run.sh <要打开的 md 文件> [调试端口]
#   bash dev/isolated-run.sh sample.md 9363
#
# 退出:
#   bash dev/isolated-run.sh --stop        # 只关测试实例
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="/tmp/mdview-isolated"
PID_FILE="$STATE_DIR/test.pid"
mkdir -p "$STATE_DIR"

# ---- 停止测试实例（只按 PID 文件杀，不 ps 匹配）----
if [ "${1:-}" = "--stop" ]; then
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      echo "已停止隔离测试实例 (pid=$PID)"
    else
      echo "测试实例已不在运行"
    fi
    rm -f "$PID_FILE"
  else
    echo "没有正在运行的隔离测试实例"
  fi
  exit 0
fi

FILE="${1:-}"
PORT="${2:-9362}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "用法: bash dev/isolated-run.sh <markdown 文件> [端口]" >&2
  exit 1
fi

ABS="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"
ELECTRON="$HERE/node_modules/.bin/electron"
if [ ! -x "$ELECTRON" ]; then
  echo "找不到 electron，先执行: cd $HERE && npm install" >&2
  exit 1
fi

# 已在运行则先停（只停测试实例）
if [ -f "$PID_FILE" ]; then
  OLD=$(cat "$PID_FILE" 2>/dev/null || true)
  [ -n "${OLD:-}" ] && kill "$OLD" 2>/dev/null || true
  sleep 1
fi

# 独立 userData：避免和正式版共享窗口状态 / 缓存
USER_DATA="$STATE_DIR/userdata"

# 清掉可能被继承的 ELECTRON_RUN_AS_NODE（否则会当纯 Node 跑）
env -u ELECTRON_RUN_AS_NODE nohup "$ELECTRON" "$HERE" \
  --user-data-dir="$USER_DATA" \
  --remote-debugging-port="$PORT" \
  "$ABS" > "$STATE_DIR/out.log" 2>&1 &

echo $! > "$PID_FILE"
echo "隔离测试实例已启动"
echo "  pid    : $(cat "$PID_FILE")"
echo "  调试   : http://127.0.0.1:$PORT/json/list"
echo "  日志   : $STATE_DIR/out.log"
echo "  停止   : bash dev/isolated-run.sh --stop"
