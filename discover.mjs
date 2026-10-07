import dgram from "node:dgram";

export const DISCOVER_PORT = 8732;
export const DISCOVER_GROUP = "224.0.0.167";

export function startDiscover(opts) {
  const getHost = opts && opts.getHost ? opts.getHost : () => "127.0.0.1";
  const alias = (opts && opts.alias) || "Elinks";
  const port = Number(opts && opts.port) || 8730;
  const httpsPort = Number(opts && opts.httpsPort) || 0;
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const peers = new Map();

  function payload(probe) {
    return {
      v: 1,
      app: "Elinks",
      alias,
      host: getHost(),
      port,
      httpsPort,
      probe: Boolean(probe)
    };
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
      const reply = Buffer.from(JSON.stringify(payload(false)));
      socket.send(reply, rinfo.port, rinfo.address);
      return;
    }
    const host = String(msg.host || "");
    if (!host || host === getHost()) return;
    peers.set(host, { host, port: msg.port, httpsPort: msg.httpsPort, alias: msg.alias, at: Date.now() });
  });

  socket.bind(DISCOVER_PORT, "0.0.0.0", () => {
    try { socket.addMembership(DISCOVER_GROUP); } catch { /* single-homed ok */ }
    try { socket.setBroadcast(true); } catch { /* ignore */ }
    try { socket.setMulticastTTL(1); } catch { /* ignore */ }
  });

  const timer = setInterval(() => {
    const buf = Buffer.from(JSON.stringify(payload(false)));
    try { socket.send(buf, DISCOVER_PORT, DISCOVER_GROUP); } catch { /* ignore */ }
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
