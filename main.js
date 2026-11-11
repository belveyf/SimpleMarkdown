"use strict";

/**
 * Simple Markdown —— Electron 主进程
 *
 * 架构：单窗口 + 自绘标签页
 *   - 一个 BrowserWindow 承载多个文档，标签栏由渲染层自己画（样式完全可控）
 *   - 每个打开的文件都注册监听，保存即刷新；非活动标签标脏点
 *   - 单实例：外部再打开文件 → 追加到同一窗口的标签
 */

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { fileURLToPath } = require("node:url");

/* ================= 可关闭的启动日志 ================= */
let DBG_PATH = "/tmp/smd-boot.log";
try { DBG_PATH = path.join(app.getPath("userData"), "launch.log"); } catch { /* ignore */ }
const DBG_ON = process.env.MDVIEW_DEBUG !== "0";

// 自动化测试模式：窗口离屏 + 不可聚焦 + 不抢前台，避免干扰正在用电脑的人；正常启动完全不受影响
// 用法：启动参数加 --smd-test，或环境变量 SMD_TEST=1
const TEST_MODE = process.env.SMD_TEST === "1" || process.argv.includes("--smd-test");
function dbg(...a) {
  if (!DBG_ON) return;
  try {
    try { if (fs.statSync(DBG_PATH).size > 200 * 1024) fs.writeFileSync(DBG_PATH, ""); } catch { /* ignore */ }
    fs.appendFileSync(DBG_PATH, `${new Date().toISOString()} [${process.pid}] ${a.join(" ")}\n`);
  } catch { /* ignore */ }
}

/* ================= 常量 ================= */
const MD_EXT = /\.(md|markdown|mdown|mkd|txt)$/i;
const WATCH_INTERVAL = 1000;  // 文件状态轮询间隔
const WATCH_DEBOUNCE = 220;   // 检测到变化后的防抖

/* ================= 运行时状态 ================= */
let win = null;
const docs = [];
let nextDocId = 1;
let activeId = null;
const watchTimers = new Map();
const pendingOpen = [];

/* ================= 路径 ================= */
const statePath = () => path.join(app.getPath("userData"), "window-state.json");
const handoffPath = () => path.join(app.getPath("userData"), "open-request.json");

function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath(), "utf8")); } catch { return {}; }
}
function saveState(bounds) {
  try { fs.writeFileSync(statePath(), JSON.stringify(bounds)); } catch { /* ignore */ }
}
function readFileSafe(p) {
  try { return fs.readFileSync(p, "utf8"); }
  catch { return null; }
}

/* ================= 与渲染层通信 ================= */
/** 标签显示名：普通文件用文件名，空白页用自身名字 */
function docName(d) {
  return d.blank ? (d.name || "空白页") : path.basename(d.path);
}

/** 取一个不与其它标签重名的名字：base 已被占用就加序号 */
function uniqueName(base, self) {
  const used = new Set(docs.filter((d) => d !== self).map(docName));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function sendTabs() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("tabs:list", {
    tabs: docs.map((d) => ({
      id: d.id,
      name: docName(d),
      path: d.path || "",
      dirty: !!d.dirty,
      blank: !!d.blank,
      missing: !!d.missing,
    })),
    activeId,
  });
}

/** 文件被删除：停止轮询，保留最后一次读到的内容，只做标记 */
function markMissing(d) {
  if (d.missing) return;
  d.missing = true;
  d.dirty = false;
  unwatchDoc(d);
  dbg("file missing:", d.path);
  sendTabs();
  if (d.id === activeId) sendActiveDoc(true);
  // 文件可能只是被临时移走/替换：慢速轮询，恢复后自动重新加载
  d.recoverTimer = setInterval(() => {
    if (!docs.includes(d)) { clearInterval(d.recoverTimer); return; }
    if (!fs.existsSync(d.path)) return;
    clearInterval(d.recoverTimer);
    d.recoverTimer = null;
    d.missing = false;
    d.dirty = false;
    dbg("file recovered:", d.path);
    watchDoc(d);
    sendTabs();
    if (d.id === activeId) sendActiveDoc(false);
  }, 2000);
}

function sendActiveDoc(keepScroll) {
  if (!win || win.isDestroyed()) return;
  const d = docs.find((x) => x.id === activeId);
  if (!d) {
    win.webContents.send("doc", null);
    win.setTitle("Simple Markdown");
    return;
  }

  // 空白页：内容只存在内存里，不落盘
  if (d.blank) {
    win.webContents.send("doc", {
      id: d.id,
      path: null,
      name: docName(d),
      content: d.text || "",
      blank: true,
      keepScroll: !!keepScroll,
    });
    win.setTitle(`${docName(d)} — Simple Markdown`);
    return;
  }

  // 文件已被删除：不再读盘，发上次读到的内容 + 删除标记
  if (d.missing) {
    win.webContents.send("doc", {
      id: d.id,
      path: d.path,
      name: docName(d),
      content: d.lastText || "",
      missing: true,
      keepScroll: !!keepScroll,
    });
    win.setTitle(`${docName(d)} — Simple Markdown`);
    return;
  }

  const text = readFileSafe(d.path);
  if (text === null) { markMissing(d); return; }
  d.lastText = text;
  win.webContents.send("doc", {
    id: d.id,
    path: d.path,
    name: docName(d),
    content: text,
    keepScroll: !!keepScroll,
  });
  win.setTitle(`${docName(d)} — Simple Markdown`);
  try { win.setRepresentedFilename(d.path); } catch { /* ignore */ }
}

/* ================= 空白页 ================= */
function addBlankDoc(name = "空白页", text = "") {
  const d = { id: nextDocId++, path: null, dirty: false, blank: true, name: uniqueName(name), text };
  docs.push(d);
  activeId = d.id;
  return d;
}

function createBlankTab() {
  if (!win || win.isDestroyed()) createMainWindow();
  addBlankDoc();
  sendTabs();
  sendActiveDoc(false);
}

/** 粘贴的 Markdown 文本放进空白页；当前是文件视图时拒绝（返回原因给渲染层提示） */
function pasteToBlank(text) {
  const str = String(text || "");
  if (!str.trim()) return { ok: false, reason: "empty" };
  const cur = docs.find((x) => x.id === activeId);
  if (cur && !cur.blank) return { ok: false, reason: "file-view" };
  let d = cur;
  if (!d) {
    d = addBlankDoc("粘贴的内容", str);
  } else {
    d.text = str;
    // 已经叫「粘贴的内容…」的保持原名，其他的重新取唯一名
    if (!d.name || !d.name.startsWith("粘贴的内容")) d.name = uniqueName("粘贴的内容", d);
  }
  sendTabs();
  sendActiveDoc(false);
  return { ok: true };
}

/* ================= 文件监听 ================= */
function watchDoc(d) {
  if (!d.path) return;
  try { fs.unwatchFile(d.path); } catch { /* ignore */ }
  fs.watchFile(d.path, { interval: WATCH_INTERVAL }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
    // 文件被删除：停止刷新，保留内容并提示，不要清空
    if (curr.nlink === 0 || !fs.existsSync(d.path)) { markMissing(d); return; }
    const old = watchTimers.get(d.path);
    if (old) clearTimeout(old);
    watchTimers.set(d.path, setTimeout(() => {
      watchTimers.delete(d.path);
      if (!docs.find((x) => x.id === d.id)) return;
      if (d.id === activeId) {
        dbg("auto-refresh:", d.path);
        sendActiveDoc(true);
      } else {
        d.dirty = true;
        sendTabs();
      }
    }, WATCH_DEBOUNCE));
  });
}

function unwatchDoc(d) {
  if (!d || !d.path) return;
  if (d.recoverTimer) { clearInterval(d.recoverTimer); d.recoverTimer = null; }
  const t = watchTimers.get(d.path);
  if (t) { clearTimeout(t); watchTimers.delete(d.path); }
  try { fs.unwatchFile(d.path); } catch { /* ignore */ }
}

/* ================= 标签操作 ================= */
function openInTab(filePath) {
  if (!filePath) return;
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    dialog.showMessageBox(win || undefined, { type: "warning", message: "文件不存在", detail: abs });
    return;
  }
  if (!win || win.isDestroyed()) createMainWindow();

  const existing = docs.find((d) => d.path === abs);
  if (existing) {
    activeId = existing.id;
    existing.dirty = false;
    // 之前因文件被删停掉了刷新，文件回来后恢复监听
    if (existing.missing && fs.existsSync(existing.path)) {
      existing.missing = false;
      watchDoc(existing);
    }
    sendTabs();
    sendActiveDoc(false);
    if (!TEST_MODE) win.focus();
    return;
  }

  // 当前活动标签是空白页时，直接把它变成这个文件的标签，不再新开一个
  const cur = docs.find((x) => x.id === activeId);
  if (cur && cur.blank) {
    cur.path = abs;
    cur.blank = false;
    cur.name = undefined;
    cur.text = undefined;
    cur.lastText = null;
    cur.missing = false;
    cur.dirty = false;
    watchDoc(cur);
    dbg("blank -> file:", abs);
    sendTabs();
    sendActiveDoc(false);
    if (!TEST_MODE) win.focus();
    return;
  }

  const d = { id: nextDocId++, path: abs, dirty: false, blank: false, missing: false, lastText: null };
  docs.push(d);
  activeId = d.id;
  watchDoc(d);
  dbg("open tab:", abs, "| total:", docs.length);
  sendTabs();
  sendActiveDoc(false);
}

function closeTab(id) {
  const i = docs.findIndex((d) => d.id === id);
  if (i === -1) return;
  const [d] = docs.splice(i, 1);
  unwatchDoc(d);
  dbg("close tab:", d.path, "| left:", docs.length);
  let activeChanged = false;
  if (activeId === d.id) {
    const next = docs[Math.min(i, docs.length - 1)];
    activeId = next ? next.id : null;
    activeChanged = true;
  }
  sendTabs();
  // 只有当前标签真的被关掉时才重发文档；关的是别的标签时正文没变，
  // 重发会把当前文档的阅读位置重置到开头
  if (activeChanged) sendActiveDoc(false);
}

/** 把标签移动到指定位置（拖动排序） */
function moveTab(id, toIndex) {
  const from = docs.findIndex((d) => d.id === id);
  if (from === -1) return;
  let to = Math.max(0, Math.min(Number(toIndex), docs.length - 1));
  if (Number.isNaN(to) || to === from) return;
  const [d] = docs.splice(from, 1);
  docs.splice(to, 0, d);
  dbg("move tab:", d.path, from, "->", to);
  sendTabs();
}

function activateTab(id) {
  const d = docs.find((x) => x.id === id);
  if (!d) return;
  activeId = d.id;
  d.dirty = false;
  // 之前因文件被删停止刷新，若文件又回来了就恢复
  if (d.missing && d.path && fs.existsSync(d.path)) {
    d.missing = false;
    watchDoc(d);
  }
  sendTabs();
  sendActiveDoc(false);
}

/* ================= 窗口 ================= */
function createMainWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width || 1200,
    height: st.height || 900,
    x: TEST_MODE ? -4000 : (typeof st.x === "number" ? st.x : undefined),
    y: TEST_MODE ? -4000 : (typeof st.y === "number" ? st.y : undefined),
    focusable: !TEST_MODE,
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 19 },
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (TEST_MODE) win.setOpacity(0);   // 测试模式：窗口完全透明，肉眼不可见
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => {
    if (TEST_MODE) {
      try { win.setPosition(-4000, -4000); } catch (e) { /* ignore */ }
      win.showInactive();
    } else {
      win.show();
    }
  });
  win.on("close", () => { try { saveState(win.getBounds()); } catch { /* ignore */ } });
  win.on("closed", () => {
    docs.forEach(unwatchDoc);
    docs.length = 0;
    activeId = null;
    win = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (TEST_MODE) dbg("test-mode: skip openExternal(window.open)", url);
    else if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // 文档里的链接一律不在窗口内跳转（整页跳走会把界面冲掉、目标不存在会白屏）
  win.webContents.on("will-navigate", (e, url) => {
    e.preventDefault();
    if (TEST_MODE) { dbg("test-mode: skip openExternal(navigate)", url); return; }
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.webContents.on("render-process-gone", () => { if (win && !win.isDestroyed()) win.reload(); });
  let recovering = false;
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    dbg("did-fail-load", code, desc, url);
    const indexUrl = path.join(__dirname, "renderer", "index.html");
    if (!recovering && isMainFrame && String(url || "").indexOf(indexUrl) === -1) {
      // 万一窗口整页跳转失败了，把应用界面重新加载回来（renderer-ready 会恢复标签和当前文档）
      recovering = true;
      win.loadFile(indexUrl).catch(() => { /* ignore */ });
      setTimeout(() => { recovering = false; }, 1500);
    }
  });

  return win;
}

/* ================= 打开对话框 / 导出 PDF ================= */
async function showOpenDialog() {
  const res = await dialog.showOpenDialog(win || undefined, {
    title: "打开 Markdown 文件",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] },
      { name: "文本", extensions: ["txt"] },
      { name: "全部文件", extensions: ["*"] },
    ],
  });
  if (res.canceled) return;
  for (const f of res.filePaths) openInTab(f);
}

async function exportPdf() {
  const d = docs.find((x) => x.id === activeId);
  if (!win || !d) {
    dialog.showMessageBox(win || undefined, { type: "info", message: "请先打开一个 Markdown 文件" });
    return;
  }
  const base = d.path ? d.path.replace(MD_EXT, "") : path.join(app.getPath("documents"), docName(d));
  const res = await dialog.showSaveDialog(win, {
    title: "导出 PDF",
    defaultPath: `${base}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (res.canceled || !res.filePath) return;

  try {
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { top: 0.6, bottom: 0.6, left: 0.55, right: 0.55 },
      preferCSSPageSize: false,
    });
    fs.writeFileSync(res.filePath, data);
    const ask = await dialog.showMessageBox(win, {
      type: "info",
      message: "PDF 已导出",
      detail: res.filePath,
      buttons: ["好", "在 Finder 中显示"],
      defaultId: 0,
    });
    if (ask.response === 1) shell.showItemInFolder(res.filePath);
  } catch (e) {
    dialog.showMessageBox(win, { type: "error", message: "导出失败", detail: String(e && e.message) });
  }
}

/* ================= 菜单 ================= */
function sendToRenderer(channel) {
  if (win && !win.isDestroyed()) win.webContents.send(channel);
}

function switchTab(dir) {
  if (docs.length < 2) return;
  const i = docs.findIndex((d) => d.id === activeId);
  const next = (i + dir + docs.length) % docs.length;
  activateTab(docs[next].id);
}

function buildMenu() {
  const template = [
    {
      label: "Simple Markdown",
      submenu: [
        { role: "about", label: "关于 Simple Markdown" },
        { type: "separator" },
        { role: "hide", label: "隐藏" },
        { role: "hideOthers", label: "隐藏其他" },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "文件",
      submenu: [
        { label: "新建空白标签页", accelerator: "CmdOrCtrl+T", click: () => createBlankTab() },
        { label: "打开…", accelerator: "CmdOrCtrl+O", click: () => showOpenDialog() },
        { type: "separator" },
        { label: "导出 PDF…", accelerator: "CmdOrCtrl+Shift+E", click: () => exportPdf() },
        { type: "separator" },
        {
          label: "关闭标签页",
          accelerator: "CmdOrCtrl+W",
          click: () => { if (activeId !== null) closeTab(activeId); },
        },
        { role: "close", label: "关闭窗口", accelerator: "Shift+CmdOrCtrl+W" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        // macOS 的 Cmd+C/V/X/Z 由应用菜单分发：菜单里必须有对应 role，
        // 否则快捷键没有归宿，输入框里的粘贴 / 剪切 / 撤销都不生效。
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
        { type: "separator" },
        { label: "查找…", accelerator: "CmdOrCtrl+F", click: () => sendToRenderer("menu:find") },
        { label: "查找下一处", accelerator: "CmdOrCtrl+G", click: () => sendToRenderer("menu:find-next") },
        { label: "查找上一处", accelerator: "Shift+CmdOrCtrl+G", click: () => sendToRenderer("menu:find-prev") },
      ],
    },
    {
      label: "视图",
      submenu: [
        { label: "上一个标签页", accelerator: "Shift+CmdOrCtrl+[", click: () => switchTab(-1) },
        { label: "下一个标签页", accelerator: "Shift+CmdOrCtrl+]", click: () => switchTab(1) },
        { type: "separator" },
        { role: "reload", label: "重新载入" },
        { label: "切换目录侧栏", accelerator: "CmdOrCtrl+\\", click: () => sendToRenderer("menu:toggle-toc") },
        { label: "切换明暗主题", accelerator: "CmdOrCtrl+Shift+L", click: () => sendToRenderer("menu:toggle-theme") },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
        { role: "toggleDevTools", label: "开发者工具" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { type: "separator" },
        { role: "front", label: "前置全部窗口" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ================= IPC ================= */
ipcMain.on("renderer-ready", () => {
  sendTabs();
  sendActiveDoc(false);
});

ipcMain.on("tab:move", (_e, { id, toIndex }) => moveTab(id, toIndex));
ipcMain.on("tab:new-blank", () => createBlankTab());
ipcMain.handle("tab:paste", (_e, text) => pasteToBlank(text));
ipcMain.on("tab:activate", (_e, id) => activateTab(id));
ipcMain.on("tab:close", (_e, id) => closeTab(id));
ipcMain.handle("open-dialog", () => showOpenDialog());
ipcMain.handle("open-path", (_e, p) => { openInTab(p); });
ipcMain.handle("export-pdf", () => exportPdf());
ipcMain.handle("current-file", () => {
  const d = docs.find((x) => x.id === activeId);
  return d ? d.path : null;
});
ipcMain.handle("reveal-in-folder", () => {
  const d = docs.find((x) => x.id === activeId);
  if (d && d.path && fs.existsSync(d.path)) shell.showItemInFolder(d.path);
});

/** 处理文档内的链接点击：外部链接交给系统，本地文件按当前文档目录解析后开标签 */
async function openLink(href) {
  const raw = String(href || "").trim();
  if (!raw) return { ok: false, reason: "empty" };
  if (raw.startsWith("#")) return { ok: true, anchor: true };
  if (/^(https?|mailto|tel):/i.test(raw)) {
    if (TEST_MODE) { dbg("test-mode: skip openExternal", raw); return { ok: true, external: true, skipped: true }; }
    try { await shell.openExternal(raw); return { ok: true, external: true }; }
    catch (e) { return { ok: false, reason: String(e && e.message) }; }
  }
  if (/^file:\/\//i.test(raw)) {
    try { href = fileURLToPath(raw); } catch (e) { return { ok: false, reason: "bad-url" }; }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return { ok: false, reason: "unsupported" };
  } else {
    href = raw;
  }
  const target = String(href).split("#")[0].split("?")[0];
  if (!target) return { ok: true, anchor: true };
  const cur = docs.find((x) => x.id === activeId);
  const baseDir = cur && cur.path ? path.dirname(cur.path) : process.cwd();
  let abs = target.replace(/^~(?=$|[\\/])/, os.homedir());
  if (!path.isAbsolute(abs)) abs = path.resolve(baseDir, abs);
  try {
    if (!fs.existsSync(abs)) return { ok: false, reason: "missing", path: abs };
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      if (!TEST_MODE) shell.openPath(abs);
      return { ok: true, kind: "dir", path: abs, skipped: TEST_MODE };
    }
    if (/\.(md|markdown|mdown|mkd|mdx)$/i.test(abs)) { openInTab(abs); return { ok: true, kind: "tab", path: abs }; }
    if (!TEST_MODE) shell.openPath(abs);
    return { ok: true, kind: "external", path: abs, skipped: TEST_MODE };
  } catch (e) {
    return { ok: false, reason: String(e && e.message) };
  }
}
ipcMain.handle("open-link", (_e, href) => openLink(href));

/** 在 Finder 中显示路径：文件在就选中它，文件没了两级都试着打开所在目录 */
ipcMain.handle("reveal-path", (_e, p) => {
  if (!p || typeof p !== "string") return { ok: false, reason: "no-path" };
  try {
    if (fs.existsSync(p)) {
      shell.showItemInFolder(p);
      return { ok: true, kind: "file" };
    }
    const dir = path.dirname(p);
    if (fs.existsSync(dir)) {
      shell.openPath(dir);
      return { ok: true, kind: "dir" };
    }
  } catch (e) {
    return { ok: false, reason: String(e && e.message) };
  }
  return { ok: false, reason: "missing" };
});

/* ================= 次实例交接 ================= */
function fileFromArgv(argv) {
  for (const a of argv.slice(1)) {
    if (a.startsWith("-")) continue;
    if (!MD_EXT.test(a)) continue;
    try { if (fs.existsSync(a)) return path.resolve(a); } catch { /* ignore */ }
  }
  return null;
}

function writeHandoff(file) {
  try {
    fs.writeFileSync(handoffPath(), JSON.stringify({ file, at: Date.now() }));
    dbg("handoff written:", file);
  } catch (e) { dbg("handoff write failed:", String(e)); }
}

function watchHandoff() {
  const p = handoffPath();
  fs.watchFile(p, { interval: 300 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      if (data && data.file) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
        openInTab(data.file);
      }
    } catch { /* ignore */ }
  });
}

function queueOrOpen(file) {
  if (!file) return;
  if (app.isReady() && win) openInTab(file);
  else pendingOpen.push(file);
}

/* ================= 启动 ================= */
const gotLock = app.requestSingleInstanceLock();
dbg("requestSingleInstanceLock ->", gotLock);

if (!gotLock) {
  let urlFile = null;
  app.on("open-file", (e, filePath) => {
    e.preventDefault();
    if (MD_EXT.test(filePath)) urlFile = filePath;
  });
  setTimeout(() => {
    const f = urlFile || fileFromArgv(process.argv);
    if (f) writeHandoff(f);
    app.quit();
  }, 700);
} else {
  app.on("open-file", (e, filePath) => {
    e.preventDefault();
    dbg("open-file:", filePath);
    if (MD_EXT.test(filePath)) queueOrOpen(filePath);
  });

  app.on("second-instance", (_e, argv) => {
    const f = fileFromArgv(argv);
    if (f) openInTab(f);
    if (win) { if (win.isMinimized()) win.restore(); if (!TEST_MODE) win.focus(); }
  });

  app.whenReady().then(() => {
    dbg("whenReady");
    if (TEST_MODE && app.dock) { try { app.dock.hide(); } catch (e) { /* ignore */ } }
    buildMenu();
    watchHandoff();
    createMainWindow();
    // 启动时可能一次进来多个文件（Finder 多选 / open -a 应用 a.md b.md）：
    // 全部打开，之前只取第一个，后面的会被丢掉
    const files = pendingOpen.splice(0, pendingOpen.length);
    const fromArgv = fileFromArgv(process.argv);
    if (fromArgv && !files.includes(fromArgv)) files.push(fromArgv);
    files.forEach((f) => { try { openInTab(f); } catch (e) { dbg("open failed:", f, String(e)); } });
  });

  app.on("window-all-closed", () => app.quit());

  app.on("activate", () => {
    if (!win) { createMainWindow(); sendTabs(); sendActiveDoc(false); }
    else if (!TEST_MODE) win.focus();
  });
}
