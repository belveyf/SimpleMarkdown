"use strict";

const vscode = require("vscode");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const OPEN_BIN = "/usr/bin/open";

/** 已安装 App 的候选位置（按优先级） */
function installedAppCandidates() {
  return [
    path.join(os.homedir(), "Applications", "SimpleMarkdown.app"),
    "/Applications/SimpleMarkdown.app",
  ];
}

/**
 * 找出要调用的 App：
 *   1. 设置项 smd.appPath 显式指定
 *   2. ~/Applications/SimpleMarkdown.app（install.sh 默认装这里）
 *   3. /Applications/SimpleMarkdown.app
 */
function resolveAppPath() {
  const configured = vscode.workspace
    .getConfiguration("smd")
    .get("appPath", "");
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  for (const candidate of installedAppCandidates()) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch (err) {
      // 不存在就试下一个
    }
  }
  return "";
}

/** 用系统 open 把文件交给已安装的 Simple Markdown（resource 可能是菜单传来的 Uri） */
function openMdview(resource) {
  try {
    let file = resource && resource.fsPath;
    if (!file && vscode.window.activeTextEditor) {
      file = vscode.window.activeTextEditor.document.uri.fsPath;
    }
    if (!file) {
      vscode.window.showErrorMessage("Simple Markdown：当前没有可打开的文件");
      return;
    }
    if (!/\.(md|markdown|mdown|mkd)$/i.test(file)) {
      vscode.window.showWarningMessage("Simple Markdown：该文件不是 Markdown（.md）文件");
      return;
    }

    const appPath = resolveAppPath();
    if (!appPath) {
      vscode.window.showErrorMessage(
        "Simple Markdown：没找到 SimpleMarkdown.app。请先在项目目录执行 bash install.sh 安装，" +
          "或在设置 smd.appPath 里填写 App 路径"
      );
      return;
    }

    // 走系统 open：已运行时在新标签里打开，未运行时启动 App。
    // 相比直接执行 App 内的可执行文件，这样不会继承 VSCode（Electron）的
    // ELECTRON_RUN_AS_NODE 等环境变量，避免 App 被当成纯 Node 进程启动。
    const child = spawn(OPEN_BIN, ["-a", appPath, file], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (err) => {
      vscode.window.showErrorMessage(
        `Simple Markdown 启动失败：${err.message}（可在设置 smd.appPath 里修改 App 路径）`
      );
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        vscode.window.showErrorMessage(
          `Simple Markdown 启动失败（open 退出码 ${code}），请检查设置 smd.appPath：${appPath}`
        );
      }
    });
    child.unref();
  } catch (err) {
    // 任何意外异常都不能影响 VSCode 本身
    vscode.window.showErrorMessage(`Simple Markdown 出错：${err && err.message}`);
  }
}

/** 整个 activate 包在 try/catch 里，保证扩展加载失败也不拖垮编辑器 */
function activate(context) {
  try {
    context.subscriptions.push(
      vscode.commands.registerCommand("smd.open", openMdview)
    );
  } catch (err) {
    console.error("[smd] activate failed:", err);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
