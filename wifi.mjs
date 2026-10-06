import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let secretPayload = "";
let inflight = null;
let cache = { at: 0, ssid: "", wifiJoin: false, connected: false };

export function escapeWifi(value) {
  return String(value).replace(/([\\;,:"])/g, "\\$1");
}

export function wifiPayload(ssid, password, auth) {
  const type = auth === "WEP" ? "WEP" : auth === "nopass" ? "nopass" : "WPA";
  const pass = type === "nopass" ? "" : escapeWifi(password);
  return `WIFI:T:${type};S:${escapeWifi(ssid)};P:${pass};H:false;;`;
}

export function isLoopbackAddress(address) {
  const ip = String(address || "").replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1";
}

export function field(text, label) {
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text || "").match(new RegExp("^\\s*" + escaped + "\\s*:\\s*(.*)$", "im"));
  return match ? match[1].trim() : "";
}

export function authType(authentication) {
  const value = String(authentication || "").toLowerCase();
  if (value.includes("wep")) return "WEP";
  if (value.includes("open") || value.includes("开放") || value.includes("none")) return "nopass";
  return "WPA";
}

function isConnectedState(state) {
  const value = String(state || "").toLowerCase();
  return value === "connected" || String(state || "").includes("已连接");
}

export function parseInterface(text) {
  const blocks = String(text || "").split(/\r?\n(?=\s*(?:Name|名称)\s*:)/);
  for (const block of blocks) {
    const state = field(block, "State") || field(block, "状态");
    if (!isConnectedState(state)) continue;
    const ssid = field(block, "SSID");
    if (!ssid) continue;
    return {
      ssid,
      profile: field(block, "Profile") || field(block, "配置文件") || ssid,
      authentication: field(block, "Authentication") || field(block, "身份验证")
    };
  }
  return null;
}

export function parseProfile(text) {
  const key = field(text, "Key Content") || field(text, "关键内容");
  const flag = field(text, "Security key") || field(text, "安全密钥");
  let secured = null;
  if (flag) {
    if (/absent|不存在|^no$|^否$/i.test(flag)) secured = false;
    else if (/present|存在|^yes$|^是$/i.test(flag)) secured = true;
  }
  if (secured === null) secured = Boolean(key);
  return { key, secured };
}

function decodeNetsh(buf) {
  const utf8 = Buffer.from(buf || "").toString("utf8");
  if (/SSID|Key Content|关键内容|Profile|配置文件|State|状态/.test(utf8)) return utf8;
  try {
    const gbk = new TextDecoder("gbk").decode(buf);
    if (/SSID|Key Content|关键内容|Profile|配置文件|State|状态/.test(gbk)) return gbk;
  } catch {
    /* utf8 */
  }
  return utf8;
}

async function netsh(args) {
  const { stdout } = await execFileAsync("netsh", args, {
    windowsHide: true,
    timeout: 8000,
    encoding: "buffer"
  });
  return decodeNetsh(stdout);
}

async function loadLink() {
  secretPayload = "";
  const empty = { ssid: "", wifiJoin: false, connected: false };
  if (process.platform !== "win32") return empty;
  let interfaces = "";
  try {
    interfaces = await netsh(["wlan", "show", "interfaces"]);
  } catch {
    return empty;
  }
  const iface = parseInterface(interfaces);
  if (!iface) return empty;
  let profileText = "";
  try {
    profileText = await netsh(["wlan", "show", "profile", `name=${iface.profile}`, "key=clear"]);
  } catch {
    return { ssid: iface.ssid, wifiJoin: false, connected: true };
  }
  const profile = parseProfile(profileText);
  const auth = authType(iface.authentication);
  if (auth === "nopass" || profile.secured === false) {
    secretPayload = wifiPayload(iface.ssid, "", "nopass");
    return { ssid: iface.ssid, wifiJoin: true, connected: true };
  }
  if (!profile.key) return { ssid: iface.ssid, wifiJoin: false, connected: true };
  secretPayload = wifiPayload(iface.ssid, profile.key, auth === "WEP" ? "WEP" : "WPA");
  return { ssid: iface.ssid, wifiJoin: true, connected: true };
}

function publicCache() {
  return { ssid: cache.ssid, wifiJoin: cache.wifiJoin, connected: cache.connected };
}

export function currentLink() {
  if (cache.at && Date.now() - cache.at < 4000) return Promise.resolve(publicCache());
  if (!inflight) {
    inflight = loadLink().then((value) => {
      cache = { at: Date.now(), ssid: value.ssid, wifiJoin: value.wifiJoin, connected: value.connected };
      return publicCache();
    }).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function wifiQrText() {
  return secretPayload;
}
