import http from "node:http";
import dgram from "node:dgram";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { directedBroadcast } from "../discover.mjs";

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
if (!index.includes('id="send-lines"') || !index.includes('id="recv-lines"')) throw new Error("orb state lines missing");
if (!index.includes('id="recv-universe"') || !index.includes('id="peer-modal-drop"')) throw new Error("receive-page orbs or disconnect missing");
if (!index.includes('class="recv-stage"')) throw new Error("receive QR must keep its original layout block");
if (!index.includes('id="alias-name"') || !index.includes('id="discover-toggle"')) throw new Error("alias/discover settings missing");
if (!index.includes('id="send-pick-files"')) throw new Error("send picker missing");
if (!index.includes('id="peer-modal"') || !index.includes("建立发送链接")) throw new Error("peer confirm modal missing");
if (!index.includes('id="tab-link"') || !index.includes("允许建立")) throw new Error("receiver allow/deny tab missing");
if (!index.includes("点一台电脑，发给它")) throw new Error("send hint missing");
if (!index.includes('id="busy-pick-more"')) throw new Error("send progress must offer pick more files");
if (!index.includes('id="clear-done"')) throw new Error("completed list must offer to clear display records");
if (!index.includes('id="wifi-modal"') || !index.includes('id="wifi-join-canvas"')) throw new Error("same-wifi hint must open a floating qr");
if (!index.includes("同一个 Wi-Fi") || !index.includes("允许通过防火墙")) throw new Error("waiting hints must tell users to join the same wifi then allow the firewall");
if (!index.includes("busy-hero") || !index.includes("busy-boards")) throw new Error("progress page layout missing");
if (directedBroadcast("192.168.1.22", "255.255.255.0") !== "192.168.1.255") throw new Error("discover must compute the subnet broadcast");
const discoverSrc = fs.readFileSync(path.join(ROOT, "discover.mjs"), "utf8");
if (!discoverSrc.includes("255.255.255.255")) throw new Error("discover must broadcast on the lan");
if (!discoverSrc.includes("setMulticastInterface")) throw new Error("discover must send on each nic so vpn adapters are not the only path");
if (!discoverSrc.includes("announce(true)")) throw new Error("discover must probe nearby machines, not only wait for multicast");

const live = fs.readFileSync(path.join(ROOT, "live.js"), "utf8");
if (!live.includes("function rememberOutbound")) throw new Error("send progress must keep completed files");
if (!live.includes('busyKind === "send"')) throw new Error("send progress must not be replaced by the receive poll");
if (!live.includes("function setDeskMode")) throw new Error("desk mode switch missing");
if (!live.includes("function renderOrbs")) throw new Error("universe orbs missing");
if (!live.includes("function requestLink") || !live.includes("function respondLink")) throw new Error("link handshake missing");
if (!live.includes("function drawLines") || !live.includes("function dropBond")) throw new Error("orb lines or receiver disconnect missing");
if (!live.includes("function renderRecvOrbs") || !live.includes("elinks.bonds")) throw new Error("receive orbs or 1h bond cache missing");
if (!live.includes("function clearDoneRecords")) throw new Error("completed list must clear display records");
if (!live.includes("function openWifiModal") || live.includes("function showWifiQr")) throw new Error("wifi join must open a floating qr instead of swapping the receive code");
if (live.includes("has-orbs")) throw new Error("receive orbs must not resize the QR layout");
const appJs = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
if (appJs.includes("返回等待") || !appJs.includes("返回接收") || !appJs.includes("nav-back")) {
  throw new Error("busy nav must highlight 返回接收");
}

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

  const badLink = await request("POST", "/api/link", Buffer.from(JSON.stringify({ token: "nope", alias: "X", host: "127.0.0.1" })), { json: true });
  if (badLink.status !== 403) throw new Error("link without token should fail");

  const pending = await request("POST", "/api/link", Buffer.from(JSON.stringify({
    token: snapshot.token,
    alias: "SenderBox",
    host: "127.0.0.1",
    port: 8730
  })), { json: true });
  if (!pending.json.ok || !pending.json.id || pending.json.status !== "pending") throw new Error("link request should stay pending");

  const listed = await json("GET", "/api/transfers");
  if (!Array.isArray(listed.pendingLinks) || !listed.pendingLinks.some((row) => row.id === pending.json.id)) {
    throw new Error("pending link should appear for the receiver");
  }

  const denied = await request("POST", "/api/link", Buffer.from(JSON.stringify({
    token: snapshot.token,
    alias: "DeniedBox",
    host: "127.0.0.1"
  })), { json: true });
  const denyRes = await request("POST", "/api/link-respond", Buffer.from(JSON.stringify({ id: denied.json.id, allow: false })), { json: true });
  if (denyRes.json.status !== "denied") throw new Error("deny should mark the link denied");
  const denySt = await json("GET", "/api/link-status?id=" + encodeURIComponent(denied.json.id));
  if (denySt.status !== "denied" || denySt.session) throw new Error("denied link must not yield a session");

  const accepted = await request("POST", "/api/link", Buffer.from(JSON.stringify({
    token: snapshot.token,
    alias: "AllowBox",
    host: "127.0.0.1"
  })), { json: true });
  const allowRes = await request("POST", "/api/link-respond", Buffer.from(JSON.stringify({ id: accepted.json.id, allow: true })), { json: true });
  if (allowRes.json.status !== "accepted") throw new Error("allow should accept the link");
  const allowSt = await json("GET", "/api/link-status?id=" + encodeURIComponent(accepted.json.id));
  if (allowSt.status !== "accepted" || !allowSt.session) throw new Error("accepted link should yield a session");
  if (!allowSt.until || allowSt.until < Date.now() + 50 * 60 * 1000) throw new Error("accepted link should stay valid for an hour");

  const bonded = await json("GET", "/api/transfers");
  if (!Array.isArray(bonded.bonds) || !bonded.bonds.some((row) => row.id === accepted.json.id && row.session === allowSt.session)) {
    throw new Error("receiver should list the live 1h bond");
  }

  const reused = await request("POST", "/api/link", Buffer.from(JSON.stringify({
    token: snapshot.token,
    alias: "AllowBox",
    host: "127.0.0.1"
  })), { json: true });
  if (reused.json.status !== "accepted" || reused.json.session !== allowSt.session) {
    throw new Error("same host should reuse the accepted link within the hour");
  }

  const dropRes = await request("POST", "/api/link-drop", Buffer.from(JSON.stringify({ id: accepted.json.id })), { json: true });
  if (!dropRes.json.ok || dropRes.json.status !== "dropped") throw new Error("receiver should be able to drop the bond");
  const dropped = await request("GET", "/api/link-status?id=" + encodeURIComponent(accepted.json.id));
  if (dropped.status !== 404) throw new Error("dropped link should be gone");
  const afterDrop = await json("GET", "/api/transfers");
  if ((afterDrop.bonds || []).some((row) => row.id === accepted.json.id)) throw new Error("dropped bond must leave the receiver list");

  const again = await request("POST", "/api/link", Buffer.from(JSON.stringify({
    token: snapshot.token,
    alias: "AllowBox",
    host: "127.0.0.1"
  })), { json: true });
  if (again.json.status !== "pending") throw new Error("after drop the next link must handshake again");
} finally {
  await json("POST", "/api/config", { alias: snapshot.alias, discoverable: true });
}

console.log("SEND_OK");
