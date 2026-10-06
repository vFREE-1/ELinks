import { app, BrowserWindow, Menu, shell } from "electron";
import { PORT, startServer } from "../server.mjs";

const SMOKE = process.env.LINKS_SMOKE === "1";

let mainWindow = null;

function createWindow() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#ffffff",
    title: "Links",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  return win;
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
  app.whenReady().then(boot).catch((err) => {
    console.error(err);
    app.exit(1);
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
}
