import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { currentLink, isLoopbackAddress, wifiQrText } from "./wifi.mjs";
import { parseAllowResult, parseReachProbe, pickHosts } from "./net.mjs";
import { lanesForLink } from "./lanes.mjs";
import { APP_VERSION, checkUpdate } from "./update.mjs";
import { mergeRanges, rangeBytes } from "./resume.mjs";
import { HTTPS_PORT, ensureTls } from "./tls.mjs";
import { DISCOVER_PORT, startDiscover } from "./discover.mjs";
import { appHome, scriptFile } from "./runtime.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(appHome(), "data");
const CONFIG_PATH = path.join(DATA, "config.json");
const DEFAULT_SAVE = path.join(appHome(), "received");
const execFileAsync = promisify(execFile);
const PORT = 8730;
const STATIC_EXT = new Set([".html", ".css", ".js", ".mjs", ".svg", ".png", ".ico"]);
const CLIENT_MJS = new Set(["slice.mjs", "send.mjs", "usb-path.mjs", "resume.mjs"]);

const pairToken = crypto.randomBytes(9).toString("base64url");
const sessions = new Map();
const linkReqs = new Map();
const transfers = new Map();
const done = [];
let httpsReady = false;
let discoverHub = null;
const fileLocks = new Map();
const stats = { inflight: 0, maxInflight: 0, bytes: 0 };

let lastLanIp = "";

function currentHosts() {
  return pickHosts(nicList());
}

function lanIp() {
  const ip = currentHosts().host;
  if (ip !== lastLanIp) {
    lastLanIp = ip;
    nicProbed = false;
  }
  return ip;
}

let nicMps = 0;
let nicProbed = false;

function readNicMps() {
  if (process.platform !== "win32") return 0;
  const ip = lanIp().replace(/[^0-9.]/g, "");
  const script = `
    $ip = '${ip}'
    $idx = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -eq $ip })[0].InterfaceIndex
    if ($idx) {
      [int64](Get-NetAdapter -InterfaceIndex $idx -ErrorAction SilentlyContinue).Speed
    } else {
      [int64](@(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and $_.Speed } | Sort-Object Speed -Descending)[0].Speed)
    }
  `;
  try {
    const stdout = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      timeout: 4000,
      windowsHide: true,
      encoding: "utf8"
    });
    const bits = Number(String(stdout || "").trim());
    if (Number.isFinite(bits) && bits > 0) return bits / 8 / 1e6;
  } catch {
    /* keep 0 */
  }
  return 0;
}

function linkMps() {
  if (!nicProbed) {
    nicProbed = true;
    nicMps = readNicMps();
  }
  return nicMps;
}

function laneCount() {
  return lanesForLink(linkMps());
}

function nicList() {
  const nics = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      nics.push({
        name,
        address: addr.address,
        family: addr.family,
        internal: addr.internal
      });
    }
  }
  return nics;
}

function usbLinked() {
  return Boolean(currentHosts().usbHost);
}

let reachAt = 0;
let reachInflight = null;
let reachValue = { needAllow: false, publicNet: false, usb: false, open: true };

async function readReach() {
  const usb = usbLinked();
  if (process.platform !== "win32") return { needAllow: false, publicNet: false, usb, open: true };
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      [
        "$elinks = @(Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Elinks receiver 8730' }).Count",
        "$appAllow = @(Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Node.js|Electron' }).Count",
        "$appBlock = @(Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Node.js|Electron|Elinks' }).Count",
        "Write-Output (\"ELINKS=$elinks APPALLOW=$appAllow APPBLOCK=$appBlock\")"
      ].join("; ")
    ], { timeout: 8000, windowsHide: true, encoding: "utf8" });
    const probe = parseReachProbe(stdout);
    return { needAllow: !probe.open, publicNet: !probe.open, usb, open: probe.open };
  } catch {
    return { needAllow: true, publicNet: true, usb, open: false };
  }
}

function currentReach() {
  return reachValue;
}

function refreshReach() {
  if (reachInflight) return reachInflight;
  reachInflight = readReach().then((value) => {
    reachValue = value;
    reachAt = Date.now();
    return value;
  }).finally(() => {
    reachInflight = null;
  });
  return reachInflight;
}

function psQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

async function allowLan() {
  const cmd = scriptFile("allow-lan.cmd");
  const resultPath = path.join(DATA, "allow-lan.result");
  const ip = lanIp();
  fs.mkdirSync(DATA, { recursive: true });
  try {
    fs.unlinkSync(resultPath);
  } catch {
    /* no previous result */
  }
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Start-Process -FilePath ${psQuote(cmd)} -Verb RunAs -Wait -ArgumentList @(${psQuote(ip)},${psQuote(process.execPath)},${psQuote(DATA)})`
  ], { timeout: 180000, windowsHide: true, encoding: "utf8" });
  let result = "";
  try {
    result = fs.readFileSync(resultPath, "utf8");
  } catch {
    result = "";
  }
  reachAt = 0;
  const reach = await refreshReach();
  if (!reach.open) {
    const parsed = parseAllowResult(result);
    throw new Error(parsed.ok ? "still closed" : parsed.error);
  }
  return reach;
}

function openHotspot() {
  execFile("cmd.exe", ["/c", "start", "ms-settings:network-mobilehotspot"], { windowsHide: true });
}

function defaultAlias() {
  const raw = String(os.hostname() || "Elinks").replace(/\.local$/i, "").trim();
  return raw.slice(0, 24) || "Elinks";
}

function cleanAlias(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim().slice(0, 24);
  return text || defaultAlias();
}

function loadConfig() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(DEFAULT_SAVE, { recursive: true });
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (data && typeof data === "object") {
      return {
        savePath: String(data.savePath || DEFAULT_SAVE),
        password: String(data.password || ""),
        rings: data.rings !== false,
        alias: cleanAlias(data.alias),
        discoverable: data.discoverable !== false
      };
    }
  } catch {
    /* default */
  }
  return { savePath: DEFAULT_SAVE, password: "", rings: true, alias: defaultAlias(), discoverable: true };
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
  const cfg = loadConfig();
  const query = new URLSearchParams({ phone: "1", t: pairToken });
  const pass = String(cfg.password || "").trim();
  if (pass) query.set("p", pass);
  return `http://${lanIp()}:${PORT}/phone.html?${query.toString()}`;
}

function qrMatrixFor(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const matrix = [];
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) row.push(qr.modules.get(x, y) ? 1 : 0);
    matrix.push(row);
  }
  return matrix;
}

function qrMatrix() {
  return qrMatrixFor(phoneUrl());
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

function sessionRec(id) {
  const rec = sessions.get(id);
  if (!rec || rec.cancelled) return null;
  return rec;
}

function expireLinks() {
  const now = Date.now();
  linkReqs.forEach((row, id) => {
    if (row.status === "pending" && now - row.t > 60000) row.status = "expired";
    if (now - row.t > 120000) linkReqs.delete(id);
  });
}

function publicLink(row) {
  return {
    id: row.id,
    alias: row.alias,
    host: row.host,
    port: row.port,
    status: row.status,
    at: row.t
  };
}

function pendingLinks() {
  expireLinks();
  return [...linkReqs.values()].filter((row) => row.status === "pending").map(publicLink);
}

function mapFile(part) {
  return part + ".map";
}

function loadMap(part) {
  try {
    const raw = JSON.parse(fs.readFileSync(mapFile(part), "utf8"));
    return mergeRanges(raw.ranges);
  } catch {
    return [];
  }
}

function saveMap(item) {
  if (!item || !item.part) return;
  fs.writeFileSync(mapFile(item.part), JSON.stringify({ size: item.size, ranges: item.ranges || [] }), "utf8");
}

function uniqueDest(root, name) {
  let dest = path.join(root, name);
  let part = dest + ".part";
  if (!fs.existsSync(dest) && !fs.existsSync(part)) return dest;
  const parsed = path.parse(name);
  let i = 1;
  for (;;) {
    const candidate = path.join(root, `${parsed.name}_${i}${parsed.ext}`);
    if (!fs.existsSync(candidate) && !fs.existsSync(candidate + ".part")) return candidate;
    i += 1;
  }
}

function publicTransfer(item) {
  return {
    id: item.id,
    name: item.name,
    size: item.size,
    received: item.received,
    speed: item.speed,
    done: item.done
  };
}

function withLock(key, fn) {
  const prev = fileLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  fileLocks.set(key, next.catch(() => {}));
  return next;
}

async function ensurePart(item, size) {
  return withLock(`${item.id}:init`, async () => {
    if (item.ready) return;
    if (!fs.existsSync(item.part)) {
      const created = await fsp.open(item.part, "w");
      try {
        if (size > 0) await created.truncate(size);
      } finally {
        await created.close();
      }
    }
    item.ready = true;
  });
}

function bumpSpeed(item, n) {
  const nowMs = Date.now();
  if (!item.window) item.window = [];
  item.window.push({ t: nowMs, n });
  item.window = item.window.filter((tick) => nowMs - tick.t < 1000);
  const span = Math.max(0.2, (nowMs - item.window[0].t) / 1000);
  item.speed = item.window.reduce((sum, tick) => sum + tick.n, 0) / span;
}

async function writeRange(req, filePath, offset, onBytes) {
  let written = 0;
  const tap = new PassThrough({ highWaterMark: 64 * 1024 });
  tap.on("data", (chunk) => {
    written += chunk.length;
    if (onBytes) onBytes(chunk.length);
  });
  await pipeline(req, tap, fs.createWriteStream(filePath, {
    flags: "r+",
    start: offset,
    highWaterMark: 64 * 1024
  }));
  return written;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600"
  };
}

function sendJson(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...corsHeaders()
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
  if (ext === ".mjs" && !CLIENT_MJS.has(path.basename(target))) {
    sendJson(res, { error: "not found" }, 404);
    return;
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon"
  };
  const data = fs.readFileSync(target);
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Content-Length": data.length,
    "Cache-Control": "no-store"
  });
  res.end(data);
}

async function cancelSession(session) {
  const rec = sessions.get(session);
  if (!rec) return { ok: false, error: "no session" };
  rec.cancelled = true;
  const gone = [];
  for (const [key, item] of transfers) {
    if (!String(key).startsWith(session + ":") || item.finalized) continue;
    gone.push(item);
    transfers.delete(key);
  }
  gone.forEach((item) => {
    if (item.reqs) item.reqs.forEach((sock) => {
      try { sock.destroy(); } catch { /* ignore */ }
    });
    try { if (item.part && inside(saveRoot(), item.part)) fs.unlinkSync(item.part); } catch { /* ignore */ }
    try {
      const map = item.part ? mapFile(item.part) : "";
      if (map && inside(saveRoot(), map)) fs.unlinkSync(map);
    } catch { /* ignore */ }
  });
  return { ok: true };
}

async function handleUpload(req, res, url) {
  const session = url.searchParams.get("session") || req.headers["x-session"] || "";
  if (!sessionRec(session)) {
    sendJson(res, { ok: false, error: sessions.get(session) && sessions.get(session).cancelled ? "cancelled" : "no session" }, sessions.get(session) ? 409 : 403);
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
  let item;
  try {
    await withLock(`xfer:${key}`, async () => {
      item = transfers.get(key);
      if (item) return;
      const destNamed = path.join(root, name);
      const partNamed = destNamed + ".part";
      let dest;
      let part;
      let ranges = [];
      if (fs.existsSync(partNamed) && !fs.existsSync(destNamed)) {
        dest = destNamed;
        part = partNamed;
        ranges = loadMap(part);
      } else {
        dest = uniqueDest(root, name);
        part = dest + ".part";
      }
      if (!inside(root, dest)) throw new Error("path");
    item = {
      id: key,
      name: path.basename(dest),
      size,
      received: rangeBytes(ranges),
      ranges,
      speed: 0,
      t: now,
      part,
      dest,
      done: false,
      ready: false,
      finalized: false,
      reqs: new Set()
    };
    transfers.set(key, item);
    });
  } catch {
    sendJson(res, { ok: false, error: "path" }, 400);
    return;
  }
  if (!inside(root, item.part) || !inside(root, item.dest)) {
    sendJson(res, { ok: false, error: "path" }, 400);
    return;
  }

  let written = 0;
  let finished = false;
  await ensurePart(item, size);
  if (!item.reqs) item.reqs = new Set();
  item.reqs.add(req);
  stats.inflight += 1;
  if (stats.inflight > stats.maxInflight) stats.maxInflight = stats.inflight;
  try {
    if (size > 0) {
      let incoming = 0;
      written = await writeRange(req, item.part, offset, (n) => {
        incoming += n;
        bumpSpeed(item, n);
        item.received = Math.min(size, rangeBytes(item.ranges) + incoming);
      });
    } else {
      req.resume();
      await new Promise((resolve) => req.on("end", resolve));
    }
  } catch (err) {
    if (!sessionRec(session)) {
      sendJson(res, { ok: false, error: "cancelled" }, 409);
      return;
    }
    throw err;
  } finally {
    item.reqs.delete(req);
    stats.inflight = Math.max(0, stats.inflight - 1);
  }
  stats.bytes += written;
  await withLock(`${item.id}:meta`, async () => {
    if (size > 0 && written > 0) {
      item.ranges = mergeRanges((item.ranges || []).concat([[offset, offset + written]]));
      item.received = rangeBytes(item.ranges);
      saveMap(item);
    } else item.received += written;
    const complete = (size > 0 && item.received >= size) || (size === 0 && !item.finalized);
    if (complete && !item.finalized) {
      item.finalized = true;
      item.done = true;
      finished = true;
      transfers.delete(key);
      done.push({ name: path.basename(item.dest), size, speed: item.speed });
      let dest = item.dest;
      if (fs.existsSync(dest)) dest = uniqueDest(root, path.basename(dest));
      fs.renameSync(item.part, dest);
      try { fs.unlinkSync(mapFile(item.part)); } catch { /* ignore */ }
    }
  });
  sendJson(res, { ok: true, received: item.received, done: finished });
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, {
        ok: true,
        runtime: "node",
        parallel: true,
        lanes: laneCount(),
        adaptive: true,
        tls: httpsReady,
        discover: Boolean(discoverHub)
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/info") {
      const cfg = loadConfig();
      const link = await currentLink();
      const hosts = currentHosts();
      const reach = !reachAt || Date.now() - reachAt > 2500 ? await refreshReach() : currentReach();
      sendJson(res, {
        host: `${hosts.host}:${PORT}`,
        savePath: cfg.savePath,
        passwordSet: Boolean(String(cfg.password || "").trim()),
        token: pairToken,
        phoneUrl: phoneUrl(),
        lanes: laneCount(),
        linkMps: Math.round(linkMps()),
        ssid: link.ssid,
        wifiJoin: link.wifiJoin,
        rings: cfg.rings !== false,
        version: APP_VERSION,
        needAllow: reach.needAllow,
        publicNet: reach.publicNet,
        usb: Boolean(hosts.usbHost),
        usbHost: hosts.usbHost,
        wifiHost: hosts.wifiHost,
        open: reach.open === true,
        path: hosts.path,
        tls: httpsReady,
        httpsPort: HTTPS_PORT,
        httpsUrl: `https://${hosts.host}:${HTTPS_PORT}/`,
        discover: Boolean(discoverHub),
        discoverPort: DISCOVER_PORT,
        alias: cfg.alias,
        discoverable: cfg.discoverable !== false,
        link: true,
        openDir: true
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/update") {
      const local = url.searchParams.get("local") === "1";
      const result = await checkUpdate({ local, timeoutMs: 2500 });
      sendJson(res, result);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/qr-matrix") {
      const kind = url.searchParams.get("kind") || "page";
      if (kind === "wifi") {
        if (!isLoopbackAddress(req.socket.remoteAddress)) {
          sendJson(res, { ok: false, error: "local only" }, 403);
          return;
        }
        const link = await currentLink();
        const text = wifiQrText();
        if (!link.wifiJoin || !text) {
          sendJson(res, { ok: false, error: "no wifi" }, 404);
          return;
        }
        try {
          sendJson(res, { matrix: qrMatrixFor(text) });
        } catch {
          sendJson(res, { ok: false, error: "no wifi" }, 404);
        }
        return;
      }
      sendJson(res, { matrix: qrMatrix() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/stats") {
      sendJson(res, { inflight: stats.inflight, maxInflight: stats.maxInflight, bytes: stats.bytes, lanes: laneCount() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/stats/reset") {
      stats.inflight = 0;
      stats.maxInflight = 0;
      stats.bytes = 0;
      sendJson(res, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/transfers") {
      expireLinks();
      const local = isLoopbackAddress(req.socket.remoteAddress);
      sendJson(res, {
        active: [...transfers.values()].map(publicTransfer),
        done: done.slice(-20),
        pendingLinks: local ? pendingLinks() : []
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/open-dir") {
      const cfg = loadConfig();
      const requested = String(url.searchParams.get("path") || "").trim();
      if (requested) cfg.savePath = requested;
      fs.mkdirSync(path.resolve(cfg.savePath), { recursive: true });
      saveConfig(cfg);
      const root = path.resolve(cfg.savePath);
      execFile("cmd.exe", ["/c", "start", "", "explorer.exe", root], { windowsHide: true });
      sendJson(res, { ok: true, savePath: root });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/config") {
      const incoming = await readJson(req);
      const cfg = loadConfig();
      if ("savePath" in incoming) cfg.savePath = String(incoming.savePath || "").trim() || cfg.savePath;
      if ("password" in incoming) cfg.password = String(incoming.password);
      if ("rings" in incoming) cfg.rings = incoming.rings !== false;
      if ("alias" in incoming) cfg.alias = cleanAlias(incoming.alias);
      if ("discoverable" in incoming) cfg.discoverable = incoming.discoverable !== false;
      fs.mkdirSync(path.resolve(cfg.savePath), { recursive: true });
      saveConfig(cfg);
      sendJson(res, {
        ok: true,
        savePath: cfg.savePath,
        passwordSet: Boolean(String(cfg.password).trim()),
        rings: cfg.rings !== false,
        alias: cfg.alias,
        discoverable: cfg.discoverable !== false
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/allow-lan") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        sendJson(res, { ok: false, error: "local only" }, 403);
        return;
      }
      try {
        const reach = await allowLan();
        sendJson(res, { ok: true, ...reach });
      } catch (err) {
        sendJson(res, { ok: false, error: String(err && err.message ? err.message : err) });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/open-hotspot") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        sendJson(res, { ok: false, error: "local only" }, 403);
        return;
      }
      openHotspot();
      sendJson(res, { ok: true });
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
      sessions.set(session, { t: Date.now(), cancelled: false });
      sendJson(res, { ok: true, session });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/link") {
      const incoming = await readJson(req);
      if (String(incoming.token || "") !== pairToken) {
        sendJson(res, { ok: false, error: "bad token" }, 403);
        return;
      }
      expireLinks();
      const id = crypto.randomBytes(12).toString("base64url");
      const row = {
        id,
        alias: cleanAlias(incoming.alias),
        host: String(incoming.host || "").trim(),
        port: Number(incoming.port) || PORT,
        status: "pending",
        session: "",
        t: Date.now()
      };
      linkReqs.set(id, row);
      sendJson(res, { ok: true, id, status: "pending" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/link-status") {
      expireLinks();
      const id = String(url.searchParams.get("id") || "");
      const row = linkReqs.get(id);
      if (!row) {
        sendJson(res, { ok: false, error: "no link" }, 404);
        return;
      }
      const payload = { ok: true, id: row.id, status: row.status };
      if (row.status === "accepted" && row.session) payload.session = row.session;
      sendJson(res, payload);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/link-respond") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        sendJson(res, { ok: false, error: "local only" }, 403);
        return;
      }
      const incoming = await readJson(req);
      expireLinks();
      const row = linkReqs.get(String(incoming.id || ""));
      if (!row || row.status !== "pending") {
        sendJson(res, { ok: false, error: "no link" }, 404);
        return;
      }
      if (incoming.allow === true) {
        const session = crypto.randomBytes(12).toString("base64url");
        sessions.set(session, { t: Date.now(), cancelled: false });
        row.session = session;
        row.status = "accepted";
        sendJson(res, { ok: true, id: row.id, status: "accepted" });
        return;
      }
      row.status = "denied";
      sendJson(res, { ok: true, id: row.id, status: "denied" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/resume") {
      const session = url.searchParams.get("session") || "";
      if (!sessionRec(session)) {
        sendJson(res, { ok: false, error: "no session" }, 403);
        return;
      }
      let name;
      let size;
      try {
        name = safeName(url.searchParams.get("name") || "");
        size = Number(url.searchParams.get("size") || "0");
      } catch {
        sendJson(res, { ok: false, error: "bad meta" }, 400);
        return;
      }
      const key = `${session}:${name}:${size}`;
      const item = transfers.get(key);
      if (item) {
        sendJson(res, { ok: true, ranges: mergeRanges(item.ranges), received: rangeBytes(item.ranges), size });
        return;
      }
      const part = path.join(saveRoot(), name) + ".part";
      const ranges = fs.existsSync(part) ? loadMap(part) : [];
      sendJson(res, { ok: true, ranges, received: rangeBytes(ranges), size });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cancel") {
      const incoming = await readJson(req);
      const session = String(incoming.session || url.searchParams.get("session") || "");
      const result = await cancelSession(session);
      sendJson(res, result, result.ok ? 200 : 403);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/discover") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        sendJson(res, { ok: false, error: "local only" }, 403);
        return;
      }
      sendJson(res, { ok: true, peers: discoverHub ? discoverHub.peers() : [], port: DISCOVER_PORT });
      return;
    }
    if (req.method === "PUT" && url.pathname === "/api/upload") {
      await handleUpload(req, res, url);
      return;
    }
    if (req.method === "GET" && url.pathname === "/" && url.searchParams.get("phone") === "1") {
      res.writeHead(302, {
        Location: "/phone.html?" + url.searchParams.toString(),
        "Cache-Control": "no-store"
      });
      res.end();
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
}

const server = http.createServer(handleRequest);
let httpsServer = null;

export { PORT, HTTPS_PORT, DISCOVER_PORT, lanIp, server };

function startTlsAndDiscover() {
  if (!discoverHub) {
    discoverHub = startDiscover({
      getHost: lanIp,
      getAlias: () => loadConfig().alias,
      getToken: () => pairToken,
      getDiscoverable: () => loadConfig().discoverable !== false,
      port: PORT,
      httpsPort: HTTPS_PORT
    });
  }
  if (httpsServer) return;
  try {
    const tlsOpts = ensureTls(DATA, [lanIp()]);
    httpsServer = https.createServer(tlsOpts, handleRequest);
    httpsServer.maxConnections = 128;
    httpsServer.once("error", () => {
      httpsReady = false;
    });
    httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
      httpsReady = true;
      console.log(`Elinks TLS https://${lanIp()}:${HTTPS_PORT}`);
    });
  } catch {
    httpsReady = false;
  }
}

export function startServer() {
  loadConfig();
  refreshReach().catch(() => {});
  server.maxConnections = 128;
  if (server.listening) {
    linkMps();
    startTlsAndDiscover();
    return Promise.resolve({ port: PORT, host: lanIp(), reused: true });
  }
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListen);
      if (err && err.code === "EADDRINUSE") {
        startTlsAndDiscover();
        resolve({ port: PORT, host: lanIp(), reused: true });
        return;
      }
      reject(err);
    };
    const onListen = () => {
      server.off("error", onError);
      console.log(`Elinks receiver http://${lanIp()}:${PORT}`);
      console.log(`Save path ${saveRoot()}`);
      startTlsAndDiscover();
      resolve({ port: PORT, host: lanIp(), reused: false });
      setImmediate(() => {
        try { linkMps(); } catch { /* probe later on /api/info */ }
      });
    };
    server.once("error", onError);
    server.once("listening", onListen);
    server.listen(PORT, "0.0.0.0");
  });
}

const launched = process.argv[1]
  ? path.resolve(fileURLToPath(import.meta.url)).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()
  : false;
if (launched) startServer();
