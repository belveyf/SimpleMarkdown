# 项目开发 / 测试 / 发布规范

本文件是 Simple Markdown（SMD）项目的协作规范，给在这个仓库里干活的 AI agent 或人看。
本文件只写本项目特有的流程、约束和坑。

---

## 一、项目速览

- 一个 macOS 桌面 Markdown **阅读器**（Electron 33），只读不编辑：自动刷新、多标签、目录、查找、导出 PDF、明暗主题、离线渲染（markdown-it / highlight.js / KaTeX / Mermaid 都在 `renderer/vendor/`）
- 无前端框架、无构建步骤：界面就是 `renderer/index.html` 一个文件
- 当前版本见 `package.json`；应用名 **Simple Markdown**，简称 **SMD**，包标识 `local.simplemarkdown`

```
main.js              主进程：窗口/菜单/文档模型/文件监听/导出
preload.js           预加载：只向界面暴露必要接口（contextIsolation）
renderer/index.html  界面全部逻辑与样式（单文件）
renderer/vendor/     离线渲染库
bin/smd              命令行入口
dev/isolated-run.sh  隔离测试实例（独立 userData + 调试端口）
install.sh           打包 + 安装到 ~/Applications
SimpleMarkdown.icns  应用图标（由 icon.png 生成）
vscode-ext/          VSCode 扩展源码与 vsix
```

常用命令：

```bash
npm start                                  # 开发运行
bash dev/isolated-run.sh 文件.md 9362      # 隔离实例（不碰已安装版）
bash dev/isolated-run.sh --stop            # 停隔离实例
npm run pack                               # 打包 arm64 到 dist/
bash install.sh --no-build                 # 用现成 dist 覆盖安装到 ~/Applications
```

---

## 二、开发规范

1. **先方案后动手**：涉及行为/交互的改动，先给方案和影响面，用户确认后再写代码（琐碎修正除外）。
2. **改完先自测，再交验**：不能只保证语法通过；至少跑一遍受影响场景（见第四节）。
3. **一次改一件事**：功能和修复分开提交，提交信息用中文前缀：`新增：` / `修复：` / `调整：` / `版本：` / `docs:`。
4. **版本号**：新增功能 → minor（1.3.0），修复/微调 → patch（1.3.1）；`package.json` 与 `package-lock.json` 的根版本要同步。
5. **不提交未验证的改动**：测试全绿、用户确认后才提交/推送/发版。

### 关键设计约束（改代码前先看）

- **文档模型**（`main.js`）：`docs[]` 里有两类文档——文件标签 `{path, lastText, missing}` 和空白页 `{blank:true, name, text}`；显示名用 `docName(d)`，重名用 `uniqueName()` 加序号。
- **空白页**：内容只在主进程内存，**不落盘**；关闭即丢；`+` / `⌘T` 新建，`⌘O` 打开文件。
- **粘贴策略在主进程**：渲染层把文本通过 `pasteMarkdown` → `ipcMain.handle("tab:paste")` 交给主进程判断，主进程按自己的 `activeId` 决定「空白页写入」还是「文件视图拒绝」。不要在渲染层用本地状态做这个判断（会有同 tick 竞争）。
- **焦点在输入框时**：粘贴事件必须放行（`pasteIntoEditable`），否则查找框里没法粘贴。
- **文件监听**：`fs.watchFile` 1s 轮询 + 220ms 防抖；文件消失时 `markMissing()` → 保留最后内容、显示顶部提示条、每 2s 轮询等文件恢复（`recoverTimer`）后自动重新加载。
- **macOS 编辑快捷键**（⌘C/V/X/Z）必须放在应用菜单的 `role` 里（`copy/paste/cut/undo/redo/selectAll`），否则快捷键没有归宿；菜单文案改动时注意别删这些项。
- **渲染层快捷键**：⌘F / ⌘G / Esc 由渲染层自己监听；⌘T / ⌘O / ⌘W / ⌘R 走主进程菜单加速键。
- **布局耦合**：目录侧栏、宽度手柄、查找条是 `position:fixed`，靠 CSS 变量 `--topbar-h` 定位；任何在顶栏下面插固定/常驻元素（比如"文件已删除"提示条）都要同步改这个变量，否则会被目录盖住。
- **打包**：`npm run pack` 会排除 `dist/` 与 `node_modules/`；electron-packager 会把提供的 icns 覆盖成 `Contents/Resources/electron.icns`，属正常现象。
- **图标**：改图标要同时更新 `icon.png`（界面顶栏引用 `../icon.png`）和 `SimpleMarkdown.icns`（`iconutil` 从 1024 png 生成 iconset）。

---

## 三、打包 / 安装 / 发布

### 打包与本地安装

```bash
npm run pack                                  # -> dist/SimpleMarkdown-darwin-arm64/
ditto -c -k --sequesterRsrc --keepParent \
  dist/SimpleMarkdown-darwin-arm64/SimpleMarkdown.app \
  dist/SimpleMarkdown-<ver>-mac-arm64.zip
bash install.sh --no-build                    # 覆盖安装到 ~/Applications/SimpleMarkdown.app
```

- `install.sh` 会：复制 app → 改显示名 → 包一层清 `ELECTRON_RUN_AS_NODE` 的启动壳 → 声明 `.md` 文档类型 → ad-hoc 重签 → 注册 LaunchServices。**改过 app 内容必须重跑**，否则签名失效。
- 从终端直接执行 app 内的二进制会继承 `ELECTRON_RUN_AS_NODE` 被当 Node 跑；验证启动请用 `open -a`（等同双击）或装好的带壳版本。

### 发版流程（当前约定：只保留最新一个版本）

1. 版本号 +1（package.json / lock），提交并推送
2. `git tag vX.Y.Z && git push origin vX.Y.Z`
3. `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <说明> <app.zip> <vsix>`（gh 已登录，凭据在钥匙串，不再弹窗）
4. 删除旧 release 与旧 tag（`gh release delete <旧tag> --yes`、`git tag -d`、`git push origin :refs/tags/<旧tag>`）
5. 附件命名：`SimpleMarkdown-<ver>-mac-arm64.zip`、`smd-<扩展版本>.vsix`
6. 发版说明写清：本次变化、附件怎么用（首次打开右键放行）、其它平台让 AI 打包

### VSCode 扩展

- 源码在 `vscode-ext/`，手写 vsix（zip 结构：`[Content_Types].xml` + `extension.vsixmanifest` + `extension/`），版本号独立
- 安装到目标配置档：`code --profile <配置档名> --install-extension vscode-ext/smd-<ver>.vsix --force`（配置档名见 VSCode 的「配置档」菜单或 `~/.vscode/extensions` 同级配置目录）；换扩展 ID 时先 `--uninstall-extension` 旧的并删残留目录
- 扩展通过系统 `open -a` 调起已安装 App，设置项 `smd.appPath`（留空自动在 `~/Applications`、`/Applications` 找）

---

## 四、测试规范

### 谁测、怎么隔离

- 需要独立视角时用 Agent Team，但**一个测试员负责全部测试任务**，不要按模块拆多个并发跑（并发容易把任务跑挂、也会互相抢实例/端口）。测试员命名建议 `app-tester`。
- 每个场景用**独立实例**：独立 `--user-data-dir` + 独立 `--remote-debugging-port`（例如 9411–9430 顺序分配），**一次只开一个**，用完立刻停，避免端口/进程残留。
- **不用 AppleScript / 系统级按键**（会抢用户焦点）。用 CDP 远程调试：
  - 执行 JS：`node cdp.js <ws> '<表达式>'`
  - 截图：`node shot.js <ws> out.png`
  - 合成粘贴：`new ClipboardEvent("paste",{clipboardData:dt,bubbles:true,cancelable:true})`
  - 合成键盘：`new KeyboardEvent("keydown",{key:"f",metaKey:true,bubbles:true,cancelable:true})`
- 测试只写 `/tmp`，**不改仓库、不 git、不 npm install / install.sh、不动 `~/Applications`**。
- 每个实例建完 `sleep 3` 再连调试端口；连不上先看实例日志。

### 必测清单（改动涉及哪块就测哪块，发版前全跑一遍）

1. **粘贴 / 空白页**：空状态粘贴建「粘贴的内容」；再粘贴只替换；文件视图粘贴被拦（提示条含"文档视图"、文件 sha256 不变）；查找框焦点粘贴放行；空白文本/带文件粘贴无副作用；空白页切标签内容保持、关闭即丢；多空白页标签名唯一（`空白页 2`、`粘贴的内容 2`）
2. **文件监听**：外部改文件约 1s 自动刷新且滚动位置/目录同步；删除后正文逐字保留 + 顶部提示条；不切标签重建文件 2s 内自动恢复并刷新；缺失期间提示条保持
3. **标签 / 查找 / 主题 / 标题**：多标签切换不串内容与目录；关闭活动标签自动激活相邻；全关进空状态；⌘F 计数、Enter/⇧Enter、Esc 清除高亮；主题切换持久化（`localStorage["smd-theme"]`）；窗口标题规则（`xxx — Simple Markdown`）
4. **打包产物**：dist app 能启动、包内 `main.js`/`preload.js`/`renderer/index.html`/`package.json` 与仓库 **diff 为 0**；Info.plist 版本/包标识正确；`electron.icns` 与仓库 icns 哈希一致；zip 内文件哈希一致
5. **敏感信息**：包内 `Resources/app` 全目录扫描两类内容，必须 **0 命中**（公开发布前必做）：① 本机绝对路径（`/Users/<用户名>`、`/opt/programs/<目录>` 这类）；② 令牌/私钥特征（`github_pat_`、`ghp_`、`BEGIN PRIVATE KEY`、`AKIA`）
6. **稳定性**：全程收集页面 `error`/`unhandledrejection`/`console.error`，必须为空；不得有未捕获异常或崩溃

### 验收标准

- 必测项 **0 FAIL**；修 bug 后必须复测原场景 + 一圈精简回归，不能"修 A 坏 B"
- 测试结论要有证据（CDP 返回原文、截图、sha256、diff 输出），不接受"应该没问题"
- 测试实例全部 stop、端口释放、无残留进程后，才算交付

> 测试工装（launch/ws/cdp/shot/stop 脚本）目前放在 `/tmp/smd-test/`，重启会丢；需要长期保留时再决定是否落到 `dev/tests/`（属仓库改动，需走提交流程）。

---

## 五、发布前检查清单

- [ ] 版本号已更新（package.json + lock），改动已提交
- [ ] 本地 `bash install.sh --no-build` 装的是最新构建，手动打开确认关键功能
- [ ] 打包产物与仓库 diff 为 0；敏感信息扫描 0 命中
- [ ] release 附件齐全（app zip + vsix），下载校验 sha256
- [ ] 旧 release/tag 已按约定清理（只保留最新一个）
- [ ] 用户明确说"可以提交/可以发版"（默认不擅自 commit/push）
