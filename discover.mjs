import dgram from "node:dgram";
import os from "node:os";
import { isPrivateLan, isUsbAddress } from "./net.mjs";

export const DISCOVER_PORT = 8732;
export const DISCOVER_GROUP = "224.0.0.167";

export function directedBroadcast(address, netmask) {
  const ip = String(address || "").split(".").map(Number);
  const mask = String(netmask || "").split(".").map(Number);
  if (ip.length !== 4 || mask.length !== 4) return "";
  if (ip.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return "";
  if (mask.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return "";
  return ip.map((octet, i) => octet | (~mask[i] & 255)).join(".");
}

function lanIfaces() {
  const rows = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.internal) continue;
      const family = String(addr.family || "");
      if (family !== "IPv4" && family !== "4") continue;
      const ip = String(addr.address || "");
      if (!ip || ip.startsWith("169.254.")) continue;
      rows.push({ ip, netmask: String(addr.netmask || "") });
    }
  }
  return rows;
}

export function startDiscover(opts) {
  const getHost = opts && opts.getHost ? opts.getHost : () => "127.0.0.1";
  const getAlias = opts && opts.getAlias ? opts.getAlias : () => (opts && opts.alias) || "轻传File";
  const getToken = opts && opts.getToken ? opts.getToken : () => "";
  const getDiscoverable = opts && opts.getDiscoverable ? opts.getDiscoverable : () => true;
  const port = Number(opts && opts.port) || 8730;
  const httpsPort = Number(opts && opts.httpsPort) || 0;
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const peers = new Map();
  const joined = new Set();

  function payload(probe) {
    return {
      v: 1,
      app: "Elinks",
      alias: getAlias(),
      host: getHost(),
      port,
      httpsPort,
      token: getToken(),
      probe: Boolean(probe)
    };
  }

  function isSelf(ip) {
    const addr = String(ip || "");
    if (!addr || addr === getHost()) return true;
    if (addr === "127.0.0.1" || addr === "0.0.0.0") return true;
    return lanIfaces().some((nic) => nic.ip === addr);
  }

  function joinIfaces() {
    lanIfaces().forEach((nic) => {
      if (joined.has(nic.ip)) return;
      try {
        socket.addMembership(DISCOVER_GROUP, nic.ip);
        joined.add(nic.ip);
      } catch {
        /* nic may not support multicast */
      }
    });
  }

  function announce(probe) {
    const buf = Buffer.from(JSON.stringify(payload(probe)));
    lanIfaces().forEach((nic) => {
      try { socket.setMulticastInterface(nic.ip); } catch { /* ignore */ }
      try { socket.send(buf, DISCOVER_PORT, DISCOVER_GROUP); } catch { /* ignore */ }
      const bcast = directedBroadcast(nic.ip, nic.netmask);
      if (bcast) {
        try { socket.send(buf, DISCOVER_PORT, bcast); } catch { /* ignore */ }
      }
    });
    try { socket.send(buf, DISCOVER_PORT, "255.255.255.255"); } catch { /* ignore */ }
  }

  socket.on("error", () => { /* keep beacon optional */ });
  socket.on("message", (buf, rinfo) => {
    let msg;
    try {
      msg = JSON.parse(String(buf || ""));
    } catch {
      return;
    }
    if (!msg || msg.app !== "Elinks") return;
    if (msg.probe) {
      if (!getDiscoverable()) return;
      const reply = Buffer.from(JSON.stringify(payload(false)));
      socket.send(reply, rinfo.port, rinfo.address);
      return;
    }
    const host = String(rinfo && rinfo.address ? rinfo.address : msg.host || "");
    if (isSelf(host) || isUsbAddress(host, "") || !isPrivateLan(host)) return;
    peers.set(host, {
      host,
      port: Number(msg.port) || port,
      httpsPort: msg.httpsPort,
      alias: msg.alias,
      token: msg.token || "",
      at: Date.now()
    });
  });

  socket.bind(DISCOVER_PORT, "0.0.0.0", () => {
    try { socket.setBroadcast(true); } catch { /* ignore */ }
    try { socket.setMulticastTTL(1); } catch { /* ignore */ }
    joinIfaces();
    if (getDiscoverable()) {
      announce(false);
      announce(true);
    }
  });

  const timer = setInterval(() => {
    joinIfaces();
    if (!getDiscoverable()) return;
    announce(false);
    announce(true);
  }, 2000);
  if (timer.unref) timer.unref();

  return {
    port: DISCOVER_PORT,
    peers() {
      const now = Date.now();
      const rows = [];
      peers.forEach((row, key) => {
        if (now - row.at > 8000) peers.delete(key);
        else rows.push(row);
      });
      return rows;
    },
    stop() {
      clearInterval(timer);
      try { socket.close(); } catch { /* ignore */ }
    }
  };
}
