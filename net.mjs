export function isUsbAddress(address, ifaceName) {
  const ip = String(address || "");
  const name = String(ifaceName || "");
  if (/^(192\.168\.(42|43|137)\.|172\.20\.10\.)/.test(ip)) return true;
  if (/(rndis|usbncm|usb.?ncm|iphone|apple|mobile|tether|ndis|usb)/i.test(name)) return true;
  return false;
}

export function isPrivateLan(address) {
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(String(address || ""));
}

export function pickHosts(nics) {
  const usable = [];
  for (const nic of nics || []) {
    if (nic && nic.internal) continue;
    const family = String(nic && nic.family ? nic.family : "");
    if (family !== "IPv4" && family !== "4") continue;
    const address = String(nic.address || "");
    if (!address || address.startsWith("169.254.")) continue;
    usable.push({
      address,
      name: nic.name || "",
      usb: isUsbAddress(address, nic.name || "")
    });
  }
  const usb = usable.find((row) => row.usb);
  const wifi = usable.find((row) => !row.usb && isPrivateLan(row.address));
  const chosen = usb || wifi || usable[0];
  return {
    host: chosen ? chosen.address : "127.0.0.1",
    usbHost: usb ? usb.address : "",
    wifiHost: wifi ? wifi.address : "",
    path: usb ? "usb" : "wifi"
  };
}

export function pickLanIp(nics) {
  return pickHosts(nics).host;
}

export function pathLabel(path) {
  return String(path) === "usb" ? "数据线" : "Wi-Fi";
}

export function parseCategory(text) {
  const rows = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let publicNet = false;
  for (const line of rows) {
    if (/Public|公用/.test(line) && !/Tailscale/i.test(line)) publicNet = true;
  }
  return { publicNet };
}

export function parseReachProbe(text) {
  const raw = String(text || "");
  const num = (label) => {
    const match = raw.match(new RegExp(label + "=(\\d+)", "i"));
    return match ? Number(match[1]) : 0;
  };
  const elinks = num("ELINKS");
  const appAllow = num("APPALLOW");
  const appBlock = num("APPBLOCK");
  return {
    elinks,
    appAllow,
    appBlock,
    open: inboundOpen({ elinks, appAllow, appBlock })
  };
}

export function inboundOpen(probe) {
  const elinks = Number(probe && probe.elinks) || 0;
  const appAllow = Number(probe && probe.appAllow) || 0;
  const appBlock = Number(probe && probe.appBlock) || 0;
  if (appBlock > 0) return false;
  return elinks > 0 || appAllow > 0;
}

export { shouldSwitchToUsb } from "./usb-path.mjs";

export function parseAllowResult(text) {
  const raw = String(text || "").trim();
  if (raw === "ALLOW_LAN_OK" || raw.startsWith("ALLOW_LAN_OK")) {
    return { ok: true, error: "" };
  }
  const error = raw.replace(/^ALLOW_LAN_ERR\s*/i, "").trim();
  return { ok: false, error: error || "allow failed" };
}
