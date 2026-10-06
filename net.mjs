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

export function pickLanIp(nics) {
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
  if (usb) return usb.address;
  const priv = usable.find((row) => isPrivateLan(row.address));
  if (priv) return priv.address;
  return usable[0] ? usable[0].address : "127.0.0.1";
}

export function parseCategory(text) {
  const rows = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let publicNet = false;
  for (const line of rows) {
    if (/Public|公用/.test(line) && !/Tailscale/i.test(line)) publicNet = true;
  }
  return { publicNet };
}

export function parseBlockRules(text) {
  const raw = String(text || "");
  const blocked = /True|True\s*$|启用|Enabled/i.test(raw) && /Block|阻止/i.test(raw);
  const named = /Node\.js|Electron|Elinks/i.test(raw);
  return Boolean(blocked && named);
}
