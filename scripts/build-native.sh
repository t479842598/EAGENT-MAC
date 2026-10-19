#!/usr/bin/env bash
# 编译 CGEvent 原生输入工具 macinput（鼠标 / 键盘 / 屏幕信息 / 权限自检）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/src/main/native/macinput.swift"
OUT_DIR="$ROOT/bin"
OUT="$OUT_DIR/macinput"

mkdir -p "$OUT_DIR"
if [ ! -f "$SRC" ]; then
  echo "[build-native] 缺少源文件: $SRC" >&2
  exit 1
fi
if ! command -v swiftc >/dev/null 2>&1; then
  echo "[build-native] 未找到 swiftc，请先安装 Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

echo "[build-native] swiftc -O -> $OUT"
swiftc -O -o "$OUT" "$SRC" -framework Cocoa -framework CoreGraphics -framework ApplicationServices
chmod +x "$OUT"
echo "[build-native] 完成: $("$OUT" info 2>/dev/null | head -c 200 || true)"
