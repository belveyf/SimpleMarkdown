#!/usr/bin/env bash
# M↓ Viewer 安装/更新脚本
#   - 打包 App（若需要）
#   - 安装到 ~/Applications
#   - 重新做 ad-hoc 签名（改过 Info.plist 后必须重签，否则 macOS 拒绝启动）
#   - 注册到 LaunchServices（让 Finder 能识别 .md 关联）
#
# 用法: bash install.sh [--no-build]   （在项目目录里执行）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/Applications/MdViewer.app"
BUILD="$HERE/dist/MdViewer-darwin-arm64/MdViewer.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

DO_BUILD=1
[ "${1:-}" = "--no-build" ] && DO_BUILD=0

# ---------- 1. 安装依赖 ----------
if [ ! -d "$HERE/node_modules/electron" ]; then
  echo "→ 安装依赖（首次约 1-2 分钟）…"
  cd "$HERE"
  ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
  npm_config_registry="https://registry.npmmirror.com" \
    npm install --no-audit --no-fund
fi

# ---------- 2. 打包 ----------
if [ "$DO_BUILD" = 1 ] || [ ! -d "$BUILD" ]; then
  echo "→ 打包 App…"
  cd "$HERE"
  ARCH="$(uname -m | sed 's/x86_64/x64/')"
  env -u ELECTRON_RUN_AS_NODE npx electron-packager . MdViewer \
    --platform=darwin --arch="$ARCH" \
    --out=dist --overwrite \
    --app-bundle-id=local.mdviewer \
    --icon=MdViewer.icns \
    --app-version="$(node -p "require('./package.json').version")" \
    --ignore="^/dist" >/dev/null
fi

# ---------- 3. 复制到 ~/Applications ----------
echo "→ 安装到 $DEST"
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
cp -R "$BUILD" "$DEST"

# ---------- 4. 设置显示名（不改 CFBundleName，否则找不到内部 Helper）----------
plutil -replace CFBundleDisplayName -string "M↓ Viewer" "$DEST/Contents/Info.plist" 2>/dev/null || true

# ---------- 4.4 用启动壳包裹二进制：免疫 ELECTRON_RUN_AS_NODE 污染 ----------
# 背景：系统「打开方式」/LaunchServices 启动时会把调用方的环境变量传进来。
# 若调用方（如某些 Electron 工具、脚本环境）带着 ELECTRON_RUN_AS_NODE=1，
# 本 App 会被当成纯 Node 运行 —— 表现为"点了没反应/闪一下就没了"。
# 因此用一层 shell 壳先清掉该变量，再启动真正的 Electron 二进制。
MACOS_DIR="$DEST/Contents/MacOS"
if [ -f "$MACOS_DIR/MdViewer" ] && [ ! -f "$MACOS_DIR/MdViewer.real" ]; then
  echo "→ 安装启动壳（隔离 ELECTRON_RUN_AS_NODE 污染）"
  mv "$MACOS_DIR/MdViewer" "$MACOS_DIR/MdViewer.real"
  cat > "$MACOS_DIR/MdViewer" <<'SHELLWRAP'
#!/bin/bash
# 清掉可能被系统「打开方式」继承进来的环境变量
unset ELECTRON_RUN_AS_NODE
exec "$(dirname "$0")/MdViewer.real" "$@"
SHELLWRAP
  chmod +x "$MACOS_DIR/MdViewer"
fi

# ---------- 4.5 声明可打开的文档类型（让 Finder 把 .md 交给它）----------
python3 - "$DEST/Contents/Info.plist" <<'PYEOF'
import plistlib, sys
p = sys.argv[1]
with open(p, "rb") as f:
    d = plistlib.load(f)
d["CFBundleDocumentTypes"] = [{
    "CFBundleTypeName": "Markdown Document",
    "CFBundleTypeRole": "Viewer",
    "LSHandlerRank": "Alternate",
    "LSItemContentTypes": ["net.daringfireball.markdown", "public.plain-text"],
    "CFBundleTypeExtensions": ["md", "markdown", "mdown", "mkd"],
}]
d["LSApplicationCategoryType"] = "public.app-category.productivity"
with open(p, "wb") as f:
    plistlib.dump(d, f)
print("✓ 已声明 .md 文档类型")
PYEOF

# ---------- 5. 重新签名（关键：改过 bundle 内容后原签名失效，macOS 会拒绝启动）----------
echo "→ 重新签名（ad-hoc）"
codesign --force --deep --sign - "$DEST" 2>/dev/null || {
  echo "⚠ 签名失败，可尝试: codesign --force --deep --sign - \"$DEST\"" >&2
}

# ---------- 6. 注册到 LaunchServices ----------
"$LSREG" -f "$DEST" 2>/dev/null || true

echo ""
echo "✓ 安装完成: $DEST"
echo ""
echo "用法："
echo "  mdview 文件.md          # 命令行打开"
echo "  双击 .md 文件            # 若首次被系统拦，右键 → 打开 一次即可"
echo "  $DEST/Contents/MacOS/MdViewer 文件.md   # 直接启动（绕过系统拦截）"
