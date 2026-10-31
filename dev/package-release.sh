#!/usr/bin/env bash
# 一键生成"能发给别人"的 macOS 安装包：打包 → 补签名 → 验签 → 压缩 → 反向验签
#
# 为什么需要这个脚本：
#   从 npm 镜像装下来的 Electron 发行版本身不带代码签名（Contents/_CodeSignature 缺失），
#   electron-packager 原样继承，于是压出来的 App 在 macOS 上会被判为"已损坏、无法打开"。
#   所以发布前必须自己补 ad-hoc 签名，并且压缩后再解压验一遍，确认签名的封条真的在包里。
#
# 用法:
#   bash dev/package-release.sh              # 完整流程
#   bash dev/package-release.sh --no-build   # 复用 dist/ 里已有产物，只做签名+压缩
#
# 产物: dist/SimpleMarkdown-<版本>-mac-arm64.zip
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

VER="$(node -p "require('./package.json').version")"
APP="dist/SimpleMarkdown-darwin-arm64/SimpleMarkdown.app"
ZIP="dist/SimpleMarkdown-${VER}-mac-arm64.zip"

DO_BUILD=1
[ "${1:-}" = "--no-build" ] && DO_BUILD=0

step() { printf '\n▸ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1" >&2; exit 1; }

if [ "$DO_BUILD" = 1 ]; then
  step "打包（electron-packager）"
  ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}" \
    env -u ELECTRON_RUN_AS_NODE npm run pack
fi

[ -d "$APP" ] || fail "找不到 $APP，先执行 npm run pack"

step "补签名（ad-hoc）"
codesign --force --deep --sign - "$APP"

step "验签"
SEAL="$APP/Contents/_CodeSignature/CodeResources"
[ -f "$SEAL" ] || fail "签名封条没生成：$SEAL 不存在"
codesign --verify --deep --strict "$APP" || fail "codesign 校验失败"

step "压缩"
rm -f "$ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
[ -f "$ZIP" ] || fail "压缩失败"

step "反向验签（解压到临时目录再验一次）"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ditto -x -k "$ZIP" "$TMP"
SEAL_IN_ZIP="$(unzip -l "$ZIP" | grep -c '_CodeSignature/CodeResources' || true)"
[ "$SEAL_IN_ZIP" -ge 1 ] || fail "zip 里没有签名封条，别发这个包"
codesign --verify --deep --strict "$TMP/SimpleMarkdown.app" || fail "解压后的包验签失败"

step "完成"
printf '  文件: %s\n' "$ZIP"
printf '  大小: %s bytes\n' "$(wc -c < "$ZIP" | tr -d ' ')"
printf '  sha256: %s\n' "$(shasum -a 256 "$ZIP" | awk '{print $1}')"
