import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, "data");
const CONFIG_PATH = path.join(DATA, "config.json");
const DEFAULT_SAVE = path.join(ROOT, "received");
const PORT = 8730;
const LANES = 8;
const STATIC_EXT = new Set([".html", ".css", ".js", ".svg", ".png", ".ico"]);

const pairToken = crypto.randomBytes(9).toString("base64url");
const sessions = new Map();
const transfers = new Map();
const done = [];
const fileLocks = new Map();

function lanIp() {
  const preferred = [];
  const other = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      if (addr.address.startsWith("169.254.")) continue;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(addr.address)) preferred.push(addr.address);
      else other.push(addr.address);
    }
  }
  return preferred[0] || other[0] || "127.0.0.1";
}

function loadConfig() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(DEFAULT_SAVE, { recursive: true });
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (data && typeof data === "object") {
      return {
        savePath: String(data.savePath || DEFAULT_SAVE),
        password: String(data.password || "")
      };
    }
  } catch {
    /* default */
  }
  return { savePath: DEFAULT_SAVE, password: "" };
}

function saveConfig(cfg) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

function saveRoot() {
  const root = path.resolve(loadConfig().savePath);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function phoneUrl() {
  return `http://${lanIp()}:${PORT}/?phone=1&t=${pairToken}`;
}

function qrMatrix() {
  const qr = QRCode.create(phoneUrl(), { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const matrix = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) row.push(qr.modules.get(x, y) ? 1 : 0);
    matrix.push(row);
  }
  return matrix;
}

function inside(root, target) {
  const prefix = root.toLowerCase().replace(/[/\\]+$/, "") + path.sep;
  const full = path.resolve(target).toLowerCase();
  return full === root.toLowerCase() || full.startsWith(prefix);
}

function safeName(name) {
  const base = path.basename(decodeURIComponent(name || "")).replace(/\0/g, "").trim();
  if (!base || base === "." || base === "..") throw new Error("bad name");
  if (/[<>:"|?*\\/]/.test(base)) throw new Error("bad name");
  return base.slice(0, 180);
}

function uniqueDest(root, name) {
  let dest = path.join(root, name);
  let part = dest + ".part";
  if (!fs.existsSync(dest) && !fs.existsSync(part)) return dest;
  const parsed = path.parse(name);
  let i = 1;
  for (;;) {
    const candidate = path.join(root, `${parsed.name}_${i}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    i += 1;
  }
}

function withLock(key, fn) {
  const prev = fileLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  fileLocks.set(key, next.catch(() => {}));
  return next;
}

function sendJson(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  const data = JSON.parse(raw);
  return data && typeof data === "object" ? data : {};
}

async function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const target = path.resolve(ROOT, rel.replace(/^\/+/, ""));
  const ext = path.extname(target).toLowerCase();
  if (!inside(ROOT, target) || !STATIC_EXT.has(ext) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    sendJson(res, { error: "not found" }, 404);
    return;
  }
  if (target.split(path.sep).includes("data") || path.basename(target) === "server.mjs") {
    sendJson(res, { error: "not found" }, 404);
    return;
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon"
  };
  const data = fs.readFileSync(target);
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Content-Length": data.length });
  res.end(data);
}

async function handleUpload(req, res, url) {
  const session = url.searchParams.get("session") || req.headers["x-session"] || "";
  if (!sessions.has(session)) {
    sendJson(res, { ok: false, error: "no session" }, 403);
    return;
  }
  let name;
  let size;
  let offset;
  try {
    name = safeName(url.searchParams.get("name") || "");
    size = Number(url.searchParams.get("size") || "0");
    offset = Number(url.searchParams.get("offset") || "0");
  } catch {
    sendJson(res, { ok: false, error: "bad meta" }, 400);
    return;
  }
  if (size < 0 || offset < 0 || (size && offset >= size)) {
    sendJson(res, { ok: false, error: "bad range" }, 400);
    return;
  }
  const root = saveRoot();
  const key = `${session}:${name}:${size}`;
  const now = Date.now();
  let item = transfers.get(key);
  if (!item) {
    const dest = uniqueDest(root, name);
    if (!inside(root, dest)) {
      sendJson(res, { ok: false, error: "path" }, 400);
      return;
    }
    item = {
      id: key,
      name: path.basename(dest),
      size,
      received: 0,
      speed: 0,
      t: now,
      part: dest + ".part",
      dest,
      done: false
    };
    transfers.set(key, item);
  }
  if (!inside(root, item.part) || !inside(root, item.dest)) {
    sendJson(res, { ok: false, error: "path" }, 400);
    return;
  }

  let written = 0;
  let finished = false;
  await withLock(key, async () => {
    if (!fs.existsSync(item.part)) {
      const fh = await fsp.open(item.part, "w");
      try {
        if (size > 0) await fh.write(Buffer.alloc(1), 0, 1, size - 1);
      } finally {
        await fh.close();
      }
    }
    const fh = await fsp.open(item.part, "r+");
    try {
      let pos = offset;
      for await (const chunk of req) {
        await fh.write(chunk, 0, chunk.length, pos);
        pos += chunk.length;
        written += chunk.length;
      }
    } finally {
      await fh.close();
    }
    const dt = Math.max(0.001, (Date.now() - item.t) / 1000);
    item.received = Math.min(size, item.received + written);
    item.speed = written / dt;
    item.t = Date.now();
    finished = size > 0 && item.received >= size;
    if (finished) {
      item.done = true;
      item.received = size;
      transfers.delete(key);
      done.push({ name: path.basename(item.dest), size, speed: item.speed });
      let dest = item.dest;
      if (fs.existsSync(dest)) dest = uniqueDest(root, path.basename(dest));
      fs.renameSync(item.part, dest);
    }
  });
  sendJson(res, { ok: true, received: item.received, done: finished });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, { ok: true, runtime: "node" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/info") {
      const cfg = loadConfig();
      sendJson(res, {
        host: `${lanIp()}:${PORT}`,
        savePath: cfg.savePath,
        passwordSet: Boolean(String(cfg.password || "").trim()),
        token: pairToken,
        phoneUrl: phoneUrl(),
        lanes: LANES
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/qr-matrix") {
      sendJson(res, { matrix: qrMatrix() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/transfers") {
      sendJson(res, { active: [...transfers.values()], done: done.slice(-20) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/open-dir") {
      execFile("explorer.exe", [saveRoot()]);
      sendJson(res, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/config") {
      const incoming = await readJson(req);
      const cfg = loadConfig();
      if ("savePath" in incoming) cfg.savePath = String(incoming.savePath || "").trim() || cfg.savePath;
      if ("password" in incoming) cfg.password = String(incoming.password);
      fs.mkdirSync(path.resolve(cfg.savePath), { recursive: true });
      saveConfig(cfg);
      sendJson(res, { ok: true, savePath: cfg.savePath, passwordSet: Boolean(String(cfg.password).trim()) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/pair") {
      const incoming = await readJson(req);
      const cfg = loadConfig();
      if (String(incoming.token || "") !== pairToken) {
        sendJson(res, { ok: false, error: "bad token" }, 403);
        return;
      }
      const secret = String(cfg.password || "");
      if (secret.trim() && !incoming.password) {
        sendJson(res, { ok: false, needPassword: true });
        return;
      }
      if (secret.trim() && incoming.password !== secret) {
        sendJson(res, { ok: false, error: "bad password" }, 403);
        return;
      }
      const session = crypto.randomBytes(12).toString("base64url");
      sessions.set(session, Date.now());
      sendJson(res, { ok: true, session });
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/upload") {
      await handleUpload(req, res, url);
      return;
    }
    if (req.method === "GET") {
      await serveStatic(res, url.pathname);
      return;
    }
    sendJson(res, { error: "not found" }, 404);
  } catch (err) {
    sendJson(res, { error: String(err && err.message ? err.message : err) }, 500);
  }
});

loadConfig();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Links receiver http://${lanIp()}:${PORT}`);
  console.log(`Save path ${saveRoot()}`);
});
