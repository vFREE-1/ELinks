import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));

export function isPackaged() {
  return Boolean(process.versions && process.versions.electron) && !process.defaultApp;
}

export function unpackPath(filePath) {
  const parts = String(filePath).split(path.sep);
  const index = parts.lastIndexOf("app.asar");
  if (index === -1) return filePath;
  const unpacked = parts.slice();
  unpacked[index] = "app.asar.unpacked";
  return unpacked.join(path.sep);
}

export function outsideAsar(filePath) {
  const unpacked = unpackPath(filePath);
  if (unpacked !== filePath && fs.existsSync(unpacked)) return unpacked;
  return filePath;
}

export function scriptFile(name) {
  return outsideAsar(path.join(APP_ROOT, "scripts", name));
}

export function assetFile(name) {
  return outsideAsar(path.join(APP_ROOT, "assets", name));
}

function packagedHome() {
  try {
    const { app } = require("electron");
    const docs = app.getPath("documents");
    if (docs) return path.join(docs, "Elinks");
  } catch {
    /* plain node, or documents path not ready yet */
  }
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "Elinks");
  return path.join(os.homedir(), "Documents", "Elinks");
}

export function appHome() {
  if (!isPackaged()) return APP_ROOT;
  return packagedHome();
}
