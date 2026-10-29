"use strict";

/**
 * 预加载脚本：只暴露渲染进程必需的最小接口（contextIsolation 下安全）
 */

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("mdviewApp", {
  /** 渲染就绪通知 */
  ready: () => ipcRenderer.send("renderer-ready"),

  /** 主进程推送文档（首次打开 / 文件变化自动刷新） */
  onDoc: (cb) => ipcRenderer.on("doc", (_e, payload) => cb(payload)),
  onTabs: (cb) => ipcRenderer.on("tabs:list", (_e, payload) => cb(payload)),
  activateTab: (id) => ipcRenderer.send("tab:activate", id),
  closeTab: (id) => ipcRenderer.send("tab:close", id),
  moveTab: (id, toIndex) => ipcRenderer.send("tab:move", { id, toIndex }),

  /** 菜单命令 */
  onToggleTheme: (cb) => ipcRenderer.on("menu:toggle-theme", () => cb()),
  onToggleToc: (cb) => ipcRenderer.on("menu:toggle-toc", () => cb()),
  onFind: (cb) => ipcRenderer.on("menu:find", () => cb()),
  onFindNext: (cb) => ipcRenderer.on("menu:find-next", () => cb()),
  onFindPrev: (cb) => ipcRenderer.on("menu:find-prev", () => cb()),

  /** 打开文件对话框 / 打开指定路径 / 导出 PDF */
  openDialog: () => ipcRenderer.invoke("open-dialog"),
  openPath: (p) => ipcRenderer.invoke("open-path", p),
  exportPdf: () => ipcRenderer.invoke("export-pdf"),
  currentFile: () => ipcRenderer.invoke("current-file"),
  revealInFolder: () => ipcRenderer.invoke("reveal-in-folder"),

  /** 拖拽进来的文件取真实路径（Electron 30+ 用 webUtils） */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
});
