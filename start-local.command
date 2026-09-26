#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js 22 或更高版本，请先访问 https://nodejs.org 安装。"
  read -r -p "按回车键退出"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "首次运行，正在安装依赖……"
  npm install
fi

echo "正在启动 Decision Bench……"
npm run dev -- --port 3000 &
BENCH_PID=$!
trap 'kill "$BENCH_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 60); do
  if curl -fsS http://localhost:3000/ >/dev/null 2>&1; then
    if command -v open >/dev/null 2>&1; then
      open http://localhost:3000/
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open http://localhost:3000/
    fi
    wait "$BENCH_PID"
    exit $?
  fi
  sleep 1
done

echo "启动超时，请检查上方提示。"
wait "$BENCH_PID"
