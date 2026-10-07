import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECEIVED = path.join(ROOT, "received");
const HOST = "127.0.0.1";
const PORT = 8730;
const HTTPS_PORT = 8731;
const DISCOVER_PORT = 8732;

function insideRepo(target) {
  const prefix = ROOT.toLowerCase() + path.sep;
  const full = path.resolve(target).toLowerCase();
  return full === ROOT.toLowerCase() || full.startsWith(prefix);
}

function request(method, urlPath, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: urlPath,
      method,
      headers: body
        ? { "Content-Type": extraHeaders && extraHeaders.json ? "application/json" : "application/octet-stream", "Content-Length": body.length }
        : { "Content-Type": "application/json", "Content-Length": 0 }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        try {
          resolve({ status: res.statusCode, json: JSON.parse(raw) });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.end(body || "");
  });
}

async function json(method, urlPath, payload) {
  if (!payload) {
    const res = await request(method, urlPath);
    return { status: res.status, ...res.json };
  }
  const body = Buffer.from(JSON.stringify(payload));
  const res = await request(method, urlPath, body, { json: true });
  return { status: res.status, ...res.json };
}

function httpsHealth() {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: HOST,
      port: HTTPS_PORT,
      path: "/api/health",
      rejectUnauthorized: false
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(4000, () => {
      req.destroy();
      reject(new Error("https timeout"));
    });
  });
}

function discoverOnce() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      reject(new Error("discover timeout"));
    }, 2500);
    socket.on("message", (buf) => {
      try {
        const msg = JSON.parse(String(buf || ""));
        if (msg && msg.app === "Elinks" && Number(msg.port) === PORT) {
          clearTimeout(timer);
          try { socket.close(); } catch { /* ignore */ }
          resolve(msg);
        }
      } catch {
        /* ignore */
      }
    });
    socket.bind(0, () => {
      const payload = Buffer.from(JSON.stringify({ app: "Elinks", probe: true }));
      socket.send(payload, DISCOVER_PORT, HOST);
    });
  });
}

if (!insideRepo(RECEIVED)) throw new Error("refusing path outside repo");
fs.mkdirSync(RECEIVED, { recursive: true });

const info = await json("GET", "/api/info");
const pair = await json("POST", "/api/pair", { token: info.token });
if (!pair.ok || !pair.session) throw new Error("pair failed");

const NAME = "verify-resume.bin";
const DEST = path.join(RECEIVED, NAME);
const SIZE = 8 * 1024 * 1024;
const payload = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) payload[i] = i % 251;
if (fs.existsSync(DEST) && insideRepo(DEST)) fs.unlinkSync(DEST);
const part = DEST + ".part";
if (fs.existsSync(part) && insideRepo(part)) fs.unlinkSync(part);
const map = part + ".map";
if (fs.existsSync(map) && insideRepo(map)) fs.unlinkSync(map);

const firstEnd = 3 * 1024 * 1024;
const q1 = new URLSearchParams({ session: pair.session, name: NAME, size: String(SIZE), offset: "0" });
const put1 = await request("PUT", "/api/upload?" + q1, payload.subarray(0, firstEnd));
if (!put1.json.ok) throw new Error("first slice failed");
const resume = await json("GET", `/api/resume?session=${pair.session}&name=${NAME}&size=${SIZE}`);
if (!resume.ok) throw new Error("resume missing");
if (Number(resume.received) < firstEnd) throw new Error(`resume received ${resume.received}`);

const q2 = new URLSearchParams({ session: pair.session, name: NAME, size: String(SIZE), offset: String(firstEnd) });
const put2 = await request("PUT", "/api/upload?" + q2, payload.subarray(firstEnd));
if (!put2.json.ok || !put2.json.done) throw new Error("second slice should finish the file");
if (!fs.existsSync(DEST)) throw new Error("resumed file missing");
const got = fs.readFileSync(DEST);
if (crypto.createHash("sha256").update(got).digest("hex") !== crypto.createHash("sha256").update(payload).digest("hex")) {
  throw new Error("resume bytes mismatch");
}
if (insideRepo(DEST)) fs.unlinkSync(DEST);

const pair2 = await json("POST", "/api/pair", { token: info.token });
const NAME2 = "verify-cancel.bin";
const DEST2 = path.join(RECEIVED, NAME2);
const SIZE2 = 4 * 1024 * 1024;
const q3 = new URLSearchParams({ session: pair2.session, name: NAME2, size: String(SIZE2), offset: "0" });
const put3 = await request("PUT", "/api/upload?" + q3, payload.subarray(0, 1024 * 1024));
if (!put3.json.ok) throw new Error("cancel setup put failed");
const cancelled = await json("POST", "/api/cancel", { session: pair2.session });
if (!cancelled.ok) throw new Error("cancel failed");
const put4 = await request("PUT", "/api/upload?" + q3, payload.subarray(0, 1024 * 1024));
if (put4.status !== 409 && put4.status !== 403) throw new Error(`expected cancel to block later PUTs, got ${put4.status}`);
const leftover = path.join(RECEIVED, NAME2 + ".part");
if (fs.existsSync(leftover) && insideRepo(leftover)) throw new Error("cancel left a part file");
if (fs.existsSync(DEST2) && insideRepo(DEST2)) fs.unlinkSync(DEST2);

let tls = null;
for (let i = 0; i < 20; i++) {
  try {
    tls = await httpsHealth();
    if (tls.json && tls.json.ok) break;
  } catch {
    tls = null;
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!tls || !tls.json || !tls.json.ok) throw new Error("https health failed");
if (tls.json.tls !== true) throw new Error("https health should report tls");

const beacon = await discoverOnce();
if (beacon.app !== "Elinks") throw new Error("discover reply missing");
if (Number(beacon.httpsPort) !== HTTPS_PORT) throw new Error("discover httpsPort missing");
if (!beacon.token || beacon.token !== info.token) throw new Error("discover token missing");

console.log("PROTOCOL_OK resume=1 cancel=1 tls=1 discover=1");
