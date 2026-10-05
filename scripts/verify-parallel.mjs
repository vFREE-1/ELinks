import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECEIVED = path.join(ROOT, "received");
const NAME = "verify-parallel.bin";
const DEST = path.join(RECEIVED, NAME);
const SIZE = 12 * 1024 * 1024;
const LANES = 6;
const SLICE = SIZE / LANES;
const HOST = "127.0.0.1";
const PORT = 8730;

function insideRepo(target) {
  const prefix = ROOT.toLowerCase() + path.sep;
  const full = path.resolve(target).toLowerCase();
  return full === ROOT.toLowerCase() || full.startsWith(prefix);
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: urlPath,
      method,
      headers: body
        ? { "Content-Type": "application/octet-stream", "Content-Length": body.length }
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
    return res.json;
  }
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: urlPath,
      method,
      headers: { "Content-Type": "application/json", "Content-Length": body.length }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")));
    });
    req.on("error", reject);
    req.end(body);
  });
}

if (!insideRepo(DEST)) throw new Error("refusing path outside repo");
if (path.basename(ROOT) !== "links") throw new Error("unexpected repo folder");
fs.mkdirSync(RECEIVED, { recursive: true });

const health = await json("GET", "/api/health");
if (!health.ok || health.runtime !== "node" || health.parallel !== true || health.lanes !== LANES) {
  throw new Error(`health not parallel node: ${JSON.stringify(health)}`);
}

const info = await json("GET", "/api/info");
const pair = await json("POST", "/api/pair", { token: info.token });
if (!pair.ok || !pair.session) throw new Error("pair failed");
await json("POST", "/api/stats/reset");

const payload = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) payload[i] = i % 251;
const expect = crypto.createHash("sha256").update(payload).digest("hex");

let maxSeen = 0;
const poll = setInterval(async () => {
  try {
    const stats = await json("GET", "/api/stats");
    if (stats.maxInflight > maxSeen) maxSeen = stats.maxInflight;
    if (stats.inflight > maxSeen) maxSeen = stats.inflight;
  } catch {
    /* still uploading */
  }
}, 5);

const started = Date.now();
try {
  const jobs = [];
  for (let i = 0; i < LANES; i++) {
    const offset = i * SLICE;
    const slice = payload.subarray(offset, offset + SLICE);
    const q = new URLSearchParams({
      session: pair.session,
      name: NAME,
      size: String(SIZE),
      offset: String(offset)
    });
    jobs.push(request("PUT", `/api/upload?${q}`, slice));
  }
  const results = await Promise.all(jobs);
  for (const res of results) {
    if (!res.json.ok) throw new Error(`slice failed: ${JSON.stringify(res.json)}`);
  }
} finally {
  clearInterval(poll);
}
const elapsed = Math.max(1, Date.now() - started);
const stats = await json("GET", "/api/stats");
const peak = Math.max(maxSeen, stats.maxInflight);
if (peak < 4) throw new Error(`maxInflight ${peak} < 4 (want overlapping PUTs)`);
if (!fs.existsSync(DEST)) throw new Error(`missing ${DEST}`);
const got = fs.readFileSync(DEST);
if (got.length !== SIZE) throw new Error(`size mismatch ${got.length}`);
const actual = crypto.createHash("sha256").update(got).digest("hex");
if (actual !== expect) throw new Error("bytes mismatch");
if (!insideRepo(DEST)) throw new Error("refusing delete outside repo");
fs.unlinkSync(DEST);
if (fs.existsSync(DEST)) throw new Error("failed to remove parallel fixture");
const mbps = (SIZE / elapsed) * 1000 / (1024 * 1024);
console.log(`VERIFY_PARALLEL_OK maxInflight=${peak} ${mbps.toFixed(1)} MB/s`);
