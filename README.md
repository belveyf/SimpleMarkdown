# Simple Markdown

一个只管「把 Markdown 读舒服」的桌面阅读器。**界面尽量简单，打开之后，屏幕上只剩文档本身。** 文件保存后自动刷新，双击就能打开，不需要授权，也没有订阅。

<img width="574" height="370" alt="image" src="https://github.com/user-attachments/assets/c5f2379b-5f3c-4333-aa3f-769a26c08352" />

https://github.com/user-attachments/assets/95a7948b-99e1-40f8-85c2-63ce94760b24

## 它是什么

纯本地、离线可用的 Markdown 阅读器，只做「读」这一件事：没有编辑、同步和账号。

| 能力 | 说明 |
|---|---|
| 自动刷新 | 文件保存后约 1 秒更新界面，保留当前阅读位置 |
| 多标签 | 文档在一个窗口里用标签切换，支持拖拽排序 |
| 目录 | 左侧侧栏，点击跳转，滚动时自动标出当前章节，宽度可拖 |
| 排版 | 代码高亮、数学公式、Mermaid 图表、表格、任务列表 |
| 阅读宽度 | 正文宽度可拖拽调整，两侧对称联动 |
| 查找 | `Cmd+F` 高亮全部命中、显示计数、循环跳转 |
| 导出 PDF | A4 排版，保留样式 |
| 明暗主题 | 两套配色分别调过 |
| 离线 | 渲染库全部放在本地，断网也能用 |

## 下载与安装

### macOS（Apple 芯片）

到 [Releases](https://github.com/belveyf/mdview-app/releases) 下载 `SimpleMarkdown-*-mac-arm64.zip`，解压出 `SimpleMarkdown.app`，拖进「应用程序」即可。

首次打开若提示「无法验证开发者」，右键 → 打开，放行一次（应用没有做 Apple 公证）。

### 其它系统：下载源码，让 AI 打个包

**Windows、Linux、Intel 芯片的 macOS 都能用。** 界面是 Web 技术，外壳是 Electron，菜单快捷键也按跨平台写成了 `CmdOrCtrl`，代码层面没有锁死 macOS。

仓库只提供 macOS arm64 的现成包，其它平台自己打一下即可——把整个项目目录交给 AI，说明目标平台就行，例如：

> 这是 Electron 应用，帮我打包成 Windows x64 版本，说明怎么安装。

自己动手也不复杂：先装依赖，再按平台选一条命令。

```bash
npm install

# macOS（Intel）
npx electron-packager . SimpleMarkdown --platform=darwin --arch=x64 --icon=SimpleMarkdown.icns
# Windows
npx electron-packager . SimpleMarkdown --platform=win32 --arch=x64
# Linux
npx electron-packager . SimpleMarkdown --platform=linux --arch=x64
```

产物在 `dist/`。有三处需要按平台适配，这些都可以交给 AI 处理：

- **图标**：Windows 用 `.ico`，Linux 用 `.png`；仓库里只有 macOS 的 `.icns` 和一张 `icon.png`
- **文件关联**：macOS 由 `install.sh` 写进系统；Windows / Linux 需要各自的安装器或桌面项
- **窗口标题栏**：现在隐藏系统标题栏、给左上角窗口按钮留了位置，其它系统要换成对应的控件样式

## 在 VSCode 里打开（可选）

仓库里带了一个 VSCode 扩展：在文件列表里右键 `.md` → **用 Simple Markdown 打开**，或者按 `Cmd+Alt+M`（Windows / Linux 用 `Ctrl+Alt+M`）。扩展会自动找到已安装的 App，把文件交给它；App 已经开着时，会在里面新开一个标签。

安装方法：VSCode 打开命令面板（`Cmd+Shift+P`），执行 `Extensions: Install from VSIX`，选中 `vscode-ext/` 下的 `.vsix` 文件即可（也可以从 Releases 里下载）。

App 如果不在默认位置，可以在设置里填 `smd.appPath`；留空则自动在「应用程序」目录里找。

## 想加功能，直接改

这个项目没有构建步骤，代码量也小：界面全在 `renderer/index.html` 一个文件里，窗口、菜单、文件这些桌面能力在 `main.js`。想加什么、改什么，直接动手就行；不想自己写，把需求描述给 AI，让它改完顺手把包也打了。

改完怎么生效：

- macOS：在项目目录执行 `bash install.sh`，会重新打包并覆盖安装
- 其它系统：按上面的命令重新打包

## 目录结构

```
main.js              # 主进程：窗口、菜单、文件监听、标签管理、PDF 导出
preload.js           # 预加载：只向界面暴露需要的接口
renderer/index.html  # 界面、标签栏、排版样式（单文件，无构建）
renderer/vendor/     # markdown-it / highlight.js / KaTeX / Mermaid
bin/smd           # 命令行入口（smd 文件.md）
dev/isolated-run.sh  # 隔离测试：另开一个实例，不影响正在用的窗口
vscode-ext/          # VSCode 扩展源码
install.sh           # macOS 打包 + 安装脚本
dist/                # 打包产物（git 忽略）
```

## 常用快捷键

macOS 用 `Cmd`，Windows / Linux 把 `Cmd` 换成 `Ctrl`。

| 操作 | 快捷键 |
|---|---|
| 新标签页打开文件 | `Cmd+T` / `Cmd+O` |
| 关闭标签页 | `Cmd+W` |
| 上一个 / 下一个标签页 | `⇧Cmd+[` / `⇧Cmd+]` |
| 页面内查找 | `Cmd+F`，`↩` / `⇧↩` 上下跳，`Esc` 关闭 |
| 导出 PDF | `⇧Cmd+E` |
| 收起 / 展开目录 | `Cmd+\` |
| 切换明暗主题 | `⇧Cmd+L` |
| 调整正文宽度 / 目录宽度 | 拖正文边缘 / 拖目录边缘 |
| 调整标签顺序 | 直接拖标签 |

## 已知限制

- 现成安装包只有 macOS arm64，其它平台需要自己打包（见上面）
- 没有做 Apple 公证，换机器第一次打开要右键放行一次
- 应用体积约 240 MB，主要是 Electron 自带的 Chromium
- 只能读，不能编辑文件

## 设计与技术取舍

- **界面在不操作的时候等于不存在**：滚动条、正文宽度手柄、标签关闭按钮都按需出现；配色只有黑白灰，加一个蓝色强调
- **单窗口多标签**，不做多窗口；也不抢系统默认程序，声明为备选级别
- **不记忆上次打开的文件**：每次启动是空界面，需要手动指定文档
- **无前端框架、无构建步骤**：渲染库全部随包分发，所以能离线用；文件同步靠主进程每秒检查一次修改时间
- 更多实现细节直接看代码，关键决策都写在注释里
