# M↓ Viewer — VSCode 扩展

在 VSCode 里用已安装的 M↓ Viewer（macOS App）打开 Markdown 文件：

- 文件列表右键 `.md` → **用 M↓ Viewer 打开**
- 编辑器标题栏按钮（Markdown 文件打开时显示）
- 快捷键 `Cmd+Alt+M`

扩展通过系统 `open` 调起 App，不依赖源码仓库目录。App 优先在 `~/Applications/MdViewer.app` 找，其次 `/Applications/MdViewer.app`；还没安装的话，先在项目目录执行 `bash install.sh`。

## 设置

`mdview.appPath`：M↓ Viewer.app 的完整路径。留空则自动查找已安装位置。
