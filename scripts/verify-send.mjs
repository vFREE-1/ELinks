import http from "node:http";
import dgram from "node:dgram";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const PORT = 8730;
const DISCOVER_PORT = 8732;

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
        const headers = res.headers || {};
        if (method === "OPTIONS") {
          resolve({ status: res.statusCode, headers, json: {} });
          return;
        }
        try {
          resolve({ status: res.statusCode, headers, json: JSON.parse(raw) });
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

function probe(timeoutMs) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      resolve(null);
    }, timeoutMs);
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
      socket.send(Buffer.from(JSON.stringify({ app: "Elinks", probe: true })), DISCOVER_PORT, HOST);
    });
  });
}

const indexPath = path.join(ROOT, "index.html");
const index = fs.readFileSync(indexPath, "utf8");
if (!index.includes('id="tab-recv"') || !index.includes('id="tab-send"')) throw new Error("receive/send tabs missing");
if (!index.includes('id="universe"') || !index.includes('id="orb-self"')) throw new Error("send universe missing");
if (!index.includes('id="alias-name"') || !index.includes('id="discover-toggle"')) throw new Error("alias/discover settings missing");
if (!index.includes('id="send-pick-files"')) throw new Error("send picker missing");

const live = fs.readFileSync(path.join(ROOT, "live.js"), "utf8");
if (!live.includes("function setDeskMode")) throw new Error("desk mode switch missing");
if (!live.includes("function renderOrbs")) throw new Error("universe orbs missing");

const snapshot = await json("GET", "/api/info");
if (typeof snapshot.alias !== "string" || !snapshot.alias.trim()) throw new Error("info.alias missing");
if (snapshot.discoverable !== true && snapshot.discoverable !== false) throw new Error("info.discoverable missing");

try {
  const named = await json("POST", "/api/config", { alias: "VerifyBox" });
  if (named.alias !== "VerifyBox") throw new Error("alias did not persist");
  const info2 = await json("GET", "/api/info");
  if (info2.alias !== "VerifyBox") throw new Error("info.alias should be VerifyBox");

  const disc = await json("GET", "/api/discover");
  if (!disc.ok || !Array.isArray(disc.peers)) throw new Error("discover list missing");

  const opt = await request("OPTIONS", "/api/pair");
  if (opt.status !== 204 && (opt.status < 200 || opt.status >= 300)) throw new Error("pair OPTIONS failed");
  if (opt.headers["access-control-allow-origin"] !== "*") throw new Error("pair CORS missing");

  await json("POST", "/api/config", { discoverable: false });
  const silent = await probe(700);
  if (silent) throw new Error("discoverable off should not reply to probe");

  await json("POST", "/api/config", { discoverable: true, alias: "VerifyBox" });
  const beacon = await probe(2500);
  if (!beacon) throw new Error("discoverable on should reply to probe");
  if (beacon.alias !== "VerifyBox") throw new Error("beacon alias should follow config");
  if (!beacon.token || beacon.token !== snapshot.token) throw new Error("beacon token missing");
} finally {
  await json("POST", "/api/config", { alias: snapshot.alias, discoverable: true });
}

console.log("SEND_OK");
