import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, screen, shell } from "electron";
import { PORT, startServer } from "../server.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE = process.env.LINKS_SMOKE === "1";
const TITLEBAR = 40;

let mainWindow = null;

function createWindow() {
  Menu.setApplicationMenu(null);
  const work = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(960, work.width - 48),
    height: Math.min(680, work.height - 48),
    minWidth: 800,
    minHeight: 500,
    backgroundColor: "#ffffff",
    title: "Elinks",
    icon: path.join(ROOT, "assets", "icon.png"),
    autoHideMenuBar: true,
    show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#ffffff",
      symbolColor: "#1d1d1f",
      height: TITLEBAR
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.webContents.on("did-finish-load", () => {
    fitWindow(win)
      .catch(() => {})
      .finally(() => {
        if (!win.isDestroyed() && !win.isVisible()) win.show();
      });
    setTimeout(() => fitWindow(win, { growOnly: true }).catch(() => {}), 400);
    setTimeout(() => fitWindow(win, { growOnly: true }).catch(() => {}), 1200);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  return win;
}

async function measureCopy(win) {
  return win.webContents.executeJavaScript(`(() => {
    const top = document.querySelector(".top");
    const copy = document.querySelector(".stage-copy");
    const status = document.querySelector(".status");
    const stage = document.querySelector(".stage");
    const join = document.querySelector(".stage.has-join");
    const qr = join ? 188 : 248;
    const ring = join ? 28 : 48;
    const need = Math.ceil((top ? top.offsetHeight : 40) + qr + ring + (copy ? copy.offsetHeight : 0) + (status ? status.offsetHeight : 36));
    const extra = stage ? Math.max(0, stage.scrollHeight - stage.clientHeight) : 0;
    return { need, extra, inner: window.innerHeight };
  })()`);
}

async function fitWindow(win, opts = {}) {
  if (!win || win.isDestroyed() || win.isMaximized()) return;
  const work = screen.getPrimaryDisplay().workAreaSize;
  const first = await measureCopy(win);
  const current = win.getContentSize();
  const width = Math.min(960, Math.max(880, Math.min(current[0], work.width - 48)));
  const maxH = Math.max(500, work.height - 24);
  let height = Math.min(Math.max(first.need + (first.extra > 1 ? first.extra : 0), 520), maxH);
  if (opts.growOnly) {
    if (first.extra <= 1 && first.need <= current[1]) return;
    height = Math.min(Math.max(current[1], first.need, current[1] + first.extra), maxH);
  }
  win.setMinimumSize(800, 500);
  win.setContentSize(width, height);
  const second = await measureCopy(win);
  if (second.extra > 1) {
    win.setContentSize(width, Math.min(height + second.extra + 12, maxH));
  }
}

async function checkHealth() {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
  const json = await res.json();
  if (!json.ok || json.runtime !== "node") {
    throw new Error(`desktop health failed: ${JSON.stringify(json)}`);
  }
}

async function boot() {
  await startServer();
  if (SMOKE) {
    await checkHealth();
    console.log("DESKTOP_SMOKE_OK");
    app.exit(0);
    return;
  }
  mainWindow = createWindow();
  await mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);
}

const locked = app.requestSingleInstanceLock();
if (!locked) {
  if (SMOKE) {
    checkHealth().then(() => {
      console.log("DESKTOP_SMOKE_OK");
      app.exit(0);
    }).catch((err) => {
      console.error(err);
      app.exit(1);
    });
  } else {
    app.quit();
  }
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("links.desktop");
    return boot();
  }).catch((err) => {
    console.error(err);
    app.exit(1);
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
}
