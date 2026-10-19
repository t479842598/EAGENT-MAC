#!/usr/bin/env bash
# 从上游 open-claude-ui 重新同步 vendored 组件（保持 pinned commit 记录）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/vendor/open-claude-ui"
REPO="https://github.com/Caho1/open-claude-ui.git"
REF="${1:-main}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --depth 1 --branch "$REF" "$REPO" "$TMP/ocui"
SHA="$(git -C "$TMP/ocui" rev-parse HEAD)"

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$TMP/ocui/code-examples" "$DEST/code-examples"
cp "$TMP/ocui/LICENSE" "$DEST/LICENSE"
cp "$TMP/ocui/package.json" "$DEST/package.json"
printf 'repo=%s\nref=%s\nsha=%s\nsynced_at=%s\n' "$REPO" "$REF" "$SHA" "$(date -u +%FT%TZ)" > "$DEST/VERSION"

echo "[sync-cds] 已同步 $SHA"
