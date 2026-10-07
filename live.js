const LIVE = location.protocol === "http:" || location.protocol === "https:";
const LINKS = window.Links;
let MAX_CONN = 4;

let info = null;
let sessionId = "";
let pollTimer = 0;
let allowing = false;

function $(id) {
  return document.getElementById(id);
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + " GB";
  if (bytes >= 1024 ** 2) return Math.max(1, Math.round(bytes / 1024 ** 2)) + " MB";
  return bytes + " B";
}

if (LIVE && LINKS) {
  boot();
}

async function boot() {
  showAllowLan();
  fetch("/api/qr-matrix").then(function (res) { return res.json(); }).then(function (qr) {
    if (qr && qr.matrix && qr.matrix.length) {
      pageMatrix = qr.matrix;
      applyMatrix(pageMatrix);
    }
  }).catch(function () {});
  info = await fetch("/api/info").then(function (res) { return res.json(); });
  if (info.lanes) MAX_CONN = info.lanes;
  LINKS.memory.host = info.host;
  LINKS.memory.path = info.savePath;
  $("desk-host").value = info.phoneUrl || info.host;
  $("host").value = info.host;
  $("save-path").value = info.savePath;
  $("save-path-bar").value = info.savePath;
  $("pass-flag").hidden = !info.passwordSet;
  applyRings(info.rings !== false);
  applyDiscoverable(info.discoverable !== false);
  if ($("alias-name")) $("alias-name").value = info.alias || "";
  if ($("orb-self-name")) $("orb-self-name").textContent = info.alias || "Elinks";
  if ($("app-version") && info.version) $("app-version").textContent = info.version;
  showNetPath();
  if ($("now-mps")) $("now-mps").textContent = "0";
  $("today").textContent = "今天已接收 0 个文件";
  $("active-count").textContent = "0 个进行中";
  $("mbps").textContent = "0";
  $("mbs").textContent = "0 M/s";
  $("util").textContent = "0%";
  $("meter-fill").style.width = "0%";
  $("lane-count").textContent = MAX_CONN + " 路并行 · 按链路调整";

  const qr = await fetch("/api/qr-matrix").then(function (res) { return res.json(); });
  if (qr.matrix && qr.matrix.length) {
    pageMatrix = qr.matrix;
    applyMatrix(pageMatrix);
  }
  await loadWifiJoin();

  const params = new URLSearchParams(location.search);
  if (params.get("phone") === "1") {
    location.replace("/phone.html" + location.search);
    return;
  }

  restoreBonds();
  pollTransfers();
  pollTimer = setInterval(pollTransfers, 400);
  checkForUpdate(false);
  setInterval(function () {
      const prevHost = info && info.host;
      const prevUsb = info && info.usb;
      const prevUsbHost = info && info.usbHost;
      const prevAllow = info && info.needAllow;
      refreshLink().then(function () {
        showNetPath();
        if (info && (info.host !== prevHost || info.usb !== prevUsb || info.usbHost !== prevUsbHost || info.needAllow !== prevAllow)) showPageQr();
      }).catch(function () {});
  }, 2500);
}

let pageMatrix = null;
let wifiMatrix = null;
let qrMode = "page";

function applyMatrix(matrix) {
  LINKS.QR_MATRIX.length = 0;
  matrix.forEach(function (row) { LINKS.QR_MATRIX.push(row.slice()); });
  LINKS.rebuildDots();
}

function networkName() {
  const ssid = info && String(info.ssid || "").trim();
  if (ssid) return "「" + ssid + "」";
  if (info && info.wifiJoin) return "电脑正在用的 Wi-Fi";
  return "";
}

function setWaitTab(id) {
  const scan = id !== "addr";
  const tabScan = $("tab-scan");
  const tabAddr = $("tab-addr");
  const panelScan = $("panel-scan");
  const panelAddr = $("panel-addr");
  if (!tabScan || !tabAddr || !panelScan || !panelAddr) return;
  tabScan.setAttribute("aria-selected", scan ? "true" : "false");
  tabAddr.setAttribute("aria-selected", scan ? "false" : "true");
  panelScan.hidden = !scan;
  panelAddr.hidden = scan;
  if (scan) {
    requestAnimationFrame(function () { window.dispatchEvent(new Event("resize")); });
  }
}

function setDeskMode(mode) {
  const send = mode === "send";
  const link = mode === "link";
  const tabRecv = $("tab-recv");
  const tabSend = $("tab-send");
  const tabLink = $("tab-link");
  const modeRecv = $("mode-recv");
  const modeSend = $("mode-send");
  const modeLink = $("mode-link");
  if (!tabRecv || !tabSend || !modeRecv || !modeSend) return;
  tabRecv.setAttribute("aria-selected", !send && !link ? "true" : "false");
  tabSend.setAttribute("aria-selected", send ? "true" : "false");
  if (tabLink) tabLink.setAttribute("aria-selected", link ? "true" : "false");
  modeRecv.hidden = send || link;
  modeSend.hidden = !send;
  if (modeLink) modeLink.hidden = !link;
  document.documentElement.classList.toggle("is-send", send);
  document.documentElement.classList.toggle("is-link", link);
  if ($("brand-sub")) {
    $("brand-sub").textContent = link ? "连接请求" : send ? "传到附近" : "局域网文件互传";
  }
  if ($("stage")) {
    $("stage").setAttribute("aria-label", link ? "连接请求" : send ? "传到附近电脑" : "等待接收");
  }
  if (send) startUniverse();
  else if (universeTimer && !document.documentElement.classList.contains("is-send")) stopUniverse();
  requestAnimationFrame(function () { window.dispatchEvent(new Event("resize")); });
}

$("tab-recv").addEventListener("click", function () { setDeskMode("recv"); });
$("tab-send").addEventListener("click", function () { setDeskMode("send"); });
if ($("tab-link")) $("tab-link").addEventListener("click", function () { setDeskMode("link"); });

function setJoinWifiHint() {
  const name = networkName();
  if ($("join-wifi-title")) $("join-wifi-title").textContent = "手机要连同一个 Wi-Fi";
  if ($("join-wifi-copy")) {
    $("join-wifi-copy").textContent = name
      ? ("点这里扫码，加入电脑正在用的" + name)
      : "点这里扫码，加入电脑正在用的 Wi-Fi。";
  }
}

function showPageQr() {
  qrMode = "page";
  if (pageMatrix) applyMatrix(pageMatrix);
  $("qr").setAttribute("aria-label", "接收页二维码，手机扫码后选择照片或视频");
  $("stage-title").textContent = "等待接收";
  if (wifiMatrix) {
    $("join-wifi").hidden = false;
    setJoinWifiHint();
  } else {
    $("join-wifi").hidden = true;
  }
  if (info && info.usb) {
    $("stage-lead").textContent = "数据线已接上。扫码后仍在手机里选照片，文件走这条线，不用在电脑上翻文件夹。";
  } else {
    $("stage-lead").textContent = "用手机相机扫码，就会打开选照片。";
  }
  showAllowLan();
}

function isDeskLocal() {
  return location.hostname === "127.0.0.1" || location.hostname === "localhost" || location.hostname === "[::1]";
}

function setAllowBusy(busy) {
  ["allow-lan", "nav-allow-lan", "settings-allow-lan"].forEach(function (id) {
    const el = $(id);
    if (el) el.disabled = busy;
  });
}

function showAllowLan() {
  const card = $("allow-lan");
  const nav = $("nav-allow-lan");
  const settings = $("settings-allow-lan");
  const local = isDeskLocal();
  if (card) card.hidden = !local;
  if (nav) nav.hidden = !local;
  if (settings) settings.hidden = !local;
  if (!local || allowing) return;
  if ($("allow-lan-title")) $("allow-lan-title").textContent = "同一 Wi-Fi 还是打不开？";
  if ($("allow-lan-copy")) $("allow-lan-copy").textContent = "点这里允许通过防火墙。";
}

function paintWifiModal(matrix) {
  const canvas = $("wifi-join-canvas");
  if (!canvas || !matrix || !matrix.length) return;
  const n = matrix.length;
  const css = 200;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(css * dpr);
  canvas.height = Math.floor(css * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, css, css);
  const quiet = 1.15;
  const cell = css / (n + quiet * 2);
  const origin = quiet * cell;
  ctx.fillStyle = "#1f6feb";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix[r][c]) continue;
      ctx.fillRect(origin + c * cell, origin + r * cell, cell + 0.35, cell + 0.35);
    }
  }
}

function closeWifiModal() {
  if ($("wifi-modal")) $("wifi-modal").hidden = true;
}

function openWifiModal() {
  if (!wifiMatrix) return;
  setWaitTab("scan");
  const name = networkName();
  if ($("wifi-modal-title")) $("wifi-modal-title").textContent = name ? ("加入" + name) : "连同一个 Wi-Fi";
  if ($("wifi-modal-copy")) {
    $("wifi-modal-copy").textContent = name
      ? ("用手机扫这个码，加入电脑正在用的" + name + "。弹出后点加入，不用输密码。")
      : "用手机扫这个码，加入电脑正在用的 Wi-Fi。弹出后点加入，不用输密码。";
  }
  paintWifiModal(wifiMatrix);
  if ($("wifi-modal")) $("wifi-modal").hidden = false;
}

async function loadWifiJoin() {
  const local = location.hostname === "127.0.0.1" || location.hostname === "localhost" || location.hostname === "[::1]";
  if (!local || !info || !info.wifiJoin) {
    showPageQr();
    return;
  }
  try {
    const res = await fetch("/api/qr-matrix?kind=wifi");
    const body = res.ok ? await res.json() : null;
    wifiMatrix = body && body.matrix && body.matrix.length ? body.matrix : null;
  } catch (err) {
    wifiMatrix = null;
  }
  showPageQr();
}

$("tab-scan").addEventListener("click", function () { setWaitTab("scan"); });
$("tab-addr").addEventListener("click", function () { setWaitTab("addr"); });

$("join-wifi").addEventListener("click", function (event) {
  event.preventDefault();
  if (!wifiMatrix) {
    $("join-wifi").hidden = false;
    $("join-wifi-title").textContent = "手机要连同一个 Wi-Fi";
    $("join-wifi-copy").textContent = "现在还没有加入码，请稍后再点。";
    return;
  }
  openWifiModal();
});

if ($("wifi-modal-close")) {
  $("wifi-modal-close").addEventListener("click", function () { closeWifiModal(); });
}
if ($("wifi-modal")) {
  $("wifi-modal").addEventListener("click", function (event) {
    if (event.target.id === "wifi-modal") closeWifiModal();
  });
}

function requestAllowLan(event) {
  if (event) event.preventDefault();
  if (allowing) return;
  allowing = true;
  setAllowBusy(true);
  if ($("allow-lan-title")) $("allow-lan-title").textContent = "请在系统窗口点「是」";
  if ($("allow-lan-copy")) $("allow-lan-copy").textContent = "允许之后，同一 Wi-Fi 下就能打开。";
  fetch("/api/allow-lan", { method: "POST" }).then(function (res) { return res.json(); }).then(function (data) {
    return refreshLink().then(function () {
      allowing = false;
      setAllowBusy(false);
      if ((data && data.ok === false) || (info && info.needAllow)) {
        if ($("allow-lan-title")) $("allow-lan-title").textContent = "还没有允许成功";
        if ($("allow-lan-copy")) $("allow-lan-copy").textContent = "再点一次，并在系统窗口选择「是」。";
        return;
      }
      showPageQr();
    });
  }).catch(function () {
    allowing = false;
    setAllowBusy(false);
    if ($("allow-lan-title")) $("allow-lan-title").textContent = "还没有允许成功";
    if ($("allow-lan-copy")) $("allow-lan-copy").textContent = "再点一次，并在系统窗口选择「是」。";
  });
}
if ($("allow-lan")) $("allow-lan").addEventListener("click", requestAllowLan);
if ($("nav-allow-lan")) $("nav-allow-lan").addEventListener("click", requestAllowLan);
if ($("settings-allow-lan")) $("settings-allow-lan").addEventListener("click", requestAllowLan);

if ($("open-hotspot")) {
  $("open-hotspot").addEventListener("click", function () {
    fetch("/api/open-hotspot", { method: "POST" });
  });
}

function applyRings(on) {
  const btn = $("rings-toggle");
  if (btn) {
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
  }
  document.documentElement.classList.toggle("rings-off", !on);
  try { localStorage.setItem("links.rings", on ? "1" : "0"); } catch (err) {}
}

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function showNetPath() {
  const node = $("net-path");
  if (!node) return;
  const usb = Boolean(info && (info.path === "usb" || info.usb));
  node.textContent = usb ? "数据线" : "Wi-Fi";
  node.classList.toggle("usb", usb);
  const chip = $("net-chip");
  if (chip) {
    chip.title = usb ? "已接数据线，USB 为传输通道" : "当前走 Wi-Fi / 网卡最高速度";
  }
  if ($("cap-mps")) {
    const cap = info && Number(info.linkMps);
    $("cap-mps").textContent = Number.isFinite(cap) && cap > 0 ? String(Math.round(cap)) : "检测中";
  }
}

async function refreshLink() {
  info = await fetch("/api/info").then(function (res) { return res.json(); });
  $("desk-host").value = info.phoneUrl || info.host;
  $("host").value = info.host;
  showNetPath();
  const qr = await fetch("/api/qr-matrix").then(function (res) { return res.json(); });
  if (qr.matrix && qr.matrix.length) {
    pageMatrix = qr.matrix;
    if (qrMode === "page") applyMatrix(pageMatrix);
  }
}

function persistConfig() {
  const ringsOn = !$("rings-toggle") || $("rings-toggle").getAttribute("aria-checked") !== "false";
  const discoverOn = !$("discover-toggle") || $("discover-toggle").getAttribute("aria-checked") !== "false";
  const body = {
    savePath: $("save-path-bar").value || $("save-path").value,
    password: $("receive-password").value,
    rings: ringsOn,
    alias: $("alias-name") ? $("alias-name").value : "",
    discoverable: discoverOn
  };
  return fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (res) { return res.json(); }).then(function (data) {
    if (data.savePath) {
      $("save-path").value = data.savePath;
      $("save-path-bar").value = data.savePath;
      LINKS.memory.path = data.savePath;
    }
    $("pass-flag").hidden = !data.passwordSet;
    applyRings(data.rings !== false);
    applyDiscoverable(data.discoverable !== false);
    if (data.alias) {
      if ($("alias-name")) $("alias-name").value = data.alias;
      if ($("orb-self-name")) $("orb-self-name").textContent = data.alias;
    }
    return refreshLink();
  }).catch(function () {});
}

$("save-path").addEventListener("change", persistConfig);
$("save-path-bar").addEventListener("change", persistConfig);
$("receive-password").addEventListener("change", persistConfig);
$("close-settings").addEventListener("click", persistConfig);

$("random-password").addEventListener("click", function () {
  $("receive-password").value = randomPassword();
  LINKS.memory.password = $("receive-password").value;
  persistConfig();
});

$("rings-toggle").addEventListener("click", function () {
  applyRings($("rings-toggle").getAttribute("aria-checked") !== "true");
  persistConfig();
});

function applyDiscoverable(on) {
  const btn = $("discover-toggle");
  if (btn) {
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
  }
}

if ($("discover-toggle")) {
  $("discover-toggle").addEventListener("click", function () {
    applyDiscoverable($("discover-toggle").getAttribute("aria-checked") !== "true");
    persistConfig();
  });
}

if ($("alias-name")) {
  $("alias-name").addEventListener("change", persistConfig);
}

function setUpdateStatus(html) {
  const node = $("update-status");
  if (!node) return;
  node.innerHTML = html || "";
}

function checkForUpdate(manual) {
  const btn = $("check-update");
  if (manual && btn) btn.textContent = "正在检查";
  return fetch("/api/update").then(function (res) { return res.json(); }).then(function (data) {
    if ($("app-version") && data.current) $("app-version").textContent = data.current;
    if (data.newer) {
      const href = data.page && /^https?:\/\//i.test(data.page) ? String(data.page).replace(/"/g, "") : "";
      const via = data.source ? "（" + data.source + "）" : "";
      setUpdateStatus(
        "有新版本 " + data.version + via +
        (href ? " · <a class=\"text\" href=\"" + href + "\" target=\"_blank\" rel=\"noreferrer\">打开更新</a>" : "")
      );
      if (btn) btn.textContent = "有新版本";
      return;
    }
    if (manual) setUpdateStatus(data.source ? "已是最新 " + data.current : "还没有发布包，当前 " + data.current);
    else setUpdateStatus("");
    if (btn) btn.textContent = "检查更新";
  }).catch(function () {
    if (manual) setUpdateStatus("暂时连不上更新源");
    if (btn) btn.textContent = "检查更新";
  });
}

$("check-update").addEventListener("click", function () {
  checkForUpdate(true);
});

$("copy-host").addEventListener("click", function () {
  const raw = $("desk-host").value.trim();
  const text = /^https?:\/\//i.test(raw) ? raw : "http://" + raw;
  const done = function () {
    $("copy-host").textContent = "已复制";
    setTimeout(function () { $("copy-host").textContent = "复制"; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () {
      $("desk-host").select();
      document.execCommand("copy");
      done();
    });
    return;
  }
  $("desk-host").select();
  document.execCommand("copy");
  done();
});

$("open-dir").addEventListener("click", function () {
  if (!LIVE) return;
  const savePath = $("save-path-bar").value || $("save-path").value;
  fetch("/api/open-dir?path=" + encodeURIComponent(savePath));
  persistConfig();
});

async function pair(fromForm) {
  const payload = { token: info.token };
  const fromQuery = new URLSearchParams(location.search).get("p");
  if (fromForm) payload.password = $("join-password").value || fromQuery || "";
  else if (fromQuery) payload.password = fromQuery;
  const res = await fetch("/api/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  $("password-error").hidden = true;
  if (data.needPassword) {
    $("password-block").classList.add("open");
    $("join-go").textContent = "确认";
    $("join-password").focus();
    return false;
  }
  if (!data.ok) {
    $("password-error").hidden = false;
    $("password-block").classList.add("open");
    return false;
  }
  sessionId = data.session;
  LINKS.openPicker();
  return true;
}

$("join-form").addEventListener("submit", function (event) {
  if (!LIVE) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  pair(true);
}, true);

$("scan").addEventListener("click", function (event) {
  if (!LIVE) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  LINKS.resetJoin();
  pair(false);
}, true);

let universeTimer = 0;
const orbNodes = new Map();
const recvOrbNodes = new Map();
const senderBonds = new Map();
let lastBonds = [];
let liveSessions = new Set();
let modalRole = "send";
let outboundActive = false;
let outboundPeer = null;
let outboundSession = "";
let outboundBase = "";
let busyKind = "";
let outboundLog = [];
let outboundTick = { t: 0, sent: 0 };
const BOND_STORE = "elinks.bonds";

function hashStr(text) {
  let n = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) n = Math.imul(n ^ s.charCodeAt(i), 16777619);
  return n >>> 0;
}

function orbPoint(host, opts) {
  const n = hashStr(host);
  const angle = ((n % 360) / 180) * Math.PI;
  const minR = (opts && opts.minR) || 28;
  const yScale = (opts && opts.yScale) || 0.78;
  const radius = minR + (n % 11);
  return {
    x: Math.max(12, Math.min(88, 50 + Math.cos(angle) * radius)),
    y: Math.max(14, Math.min(86, 50 + Math.sin(angle) * radius * yScale))
  };
}

function holdLabel(until) {
  const ms = Math.max(0, Number(until) - Date.now());
  const min = Math.round(ms / 60000);
  if (!until || ms <= 0) return "";
  if (min >= 55) return "还剩约 1 小时";
  if (min <= 1) return "还剩不到 1 分钟";
  return "还剩约 " + min + " 分钟";
}

function restoreBonds() {
  senderBonds.clear();
  try {
    const rows = JSON.parse(localStorage.getItem(BOND_STORE) || "[]");
    (rows || []).forEach(function (row) {
      if (!row || !row.host || !row.session) return;
      if (Number(row.until) <= Date.now()) return;
      senderBonds.set(row.host, row);
    });
  } catch (err) {}
}

function persistBonds() {
  const rows = [];
  senderBonds.forEach(function (row) {
    if (row && row.host && row.session && Number(row.until) > Date.now()) rows.push(row);
  });
  try { localStorage.setItem(BOND_STORE, JSON.stringify(rows)); } catch (err) {}
}

function forgetSenderBond(host) {
  if (host) senderBonds.delete(host);
  persistBonds();
  if (outboundPeer && outboundPeer.host === host) {
    outboundSession = "";
    outboundBase = "";
    outboundLinkId = "";
  }
}

function rememberSenderBond(peer, data) {
  if (!peer || !peer.host || !data || !data.session) return;
  const until = Number(data.until) || (Date.now() + 60 * 60 * 1000);
  senderBonds.set(peer.host, {
    id: data.id || "",
    alias: peer.alias || "",
    host: peer.host,
    port: peer.port || 8730,
    httpsPort: peer.httpsPort || 0,
    token: peer.token || "",
    session: data.session,
    until: until
  });
  persistBonds();
}

function liveSenderBond(host) {
  const row = senderBonds.get(host);
  if (!row || Number(row.until) <= Date.now() || !row.session) {
    if (row) {
      senderBonds.delete(host);
      persistBonds();
    }
    return null;
  }
  return row;
}

function bondState(peer) {
  if (!peer || !peer.host) return "idle";
  const host = peer.host;
  if (outboundActive && outboundPeer && outboundPeer.host === host) return "live";
  if (peer.session && liveSessions.has(peer.session)) return "live";
  const bonded = liveSenderBond(host) || (peer.status === "accepted" && Number(peer.until) > Date.now());
  if (outboundPeer && outboundPeer.host === host && outboundLinkId && !outboundSession) return "pending";
  if (bonded) return "linked";
  return "idle";
}

function setOrbState(node, state) {
  if (!node) return;
  node.classList.remove("idle", "pending", "linked", "live");
  node.classList.add(state || "idle");
}

function drawLines(svg, hub, spokes) {
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  (spokes || []).forEach(function (spoke) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(hub.x));
    line.setAttribute("y1", String(hub.y));
    line.setAttribute("x2", String(spoke.x));
    line.setAttribute("y2", String(spoke.y));
    line.setAttribute("class", "orb-line " + (spoke.state || "idle"));
    line.setAttribute("stroke-width", "1.25");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(line);
  });
}

function makeOrb(field, peer, clickHost, point) {
  const seed = hashStr(peer.host);
  const node = document.createElement("button");
  node.type = "button";
  node.className = "orb idle";
  node.style.setProperty("--x", point.x.toFixed(1));
  node.style.setProperty("--y", point.y.toFixed(1));
  node.style.animationDelay = "-" + ((seed % 17) * 0.37).toFixed(2) + "s";
  node.style.animationDuration = (7.2 + (seed % 5) * 0.7).toFixed(1) + "s";
  node.appendChild(document.createElement("i"));
  node.appendChild(document.createElement("span"));
  node.addEventListener("click", function () { clickHost(peer.host); });
  field.appendChild(node);
  return node;
}

function mergeSendPeers(peers) {
  [...senderBonds.keys()].forEach(function (host) { liveSenderBond(host); });
  const list = [];
  const seen = new Set();
  (peers || []).concat([...senderBonds.values()]).forEach(function (peer) {
    if (!peer || !peer.host || seen.has(peer.host)) return;
    seen.add(peer.host);
    const bond = liveSenderBond(peer.host);
    list.push(bond ? Object.assign({}, peer, bond) : peer);
  });
  return list;
}

function renderOrbs(peers) {
  const field = $("universe");
  const empty = $("universe-empty");
  if (!field) return;
  const list = mergeSendPeers(peers);
  const seen = new Set();
  const spokes = [];
  list.forEach(function (peer) {
    if (!peer || !peer.host) return;
    seen.add(peer.host);
    let node = orbNodes.get(peer.host);
    if (!node) {
      node = makeOrb(field, peer, choosePeer, orbPoint(peer.host));
      orbNodes.set(peer.host, node);
    }
    node.querySelector("span").textContent = peer.alias || peer.host;
    node._peer = peer;
    const state = bondState(peer);
    setOrbState(node, state);
    spokes.push({
      x: Number(node.style.getPropertyValue("--x")) || 50,
      y: Number(node.style.getPropertyValue("--y")) || 50,
      state: state
    });
  });
  orbNodes.forEach(function (node, host) {
    if (seen.has(host)) return;
    node.remove();
    orbNodes.delete(host);
  });
  drawLines($("send-lines"), { x: 50, y: 50 }, spokes);
  if (empty) {
    empty.hidden = false;
    empty.textContent = seen.size ? "点一台电脑，发给它" : "附近没有其他电脑。两台都要打开 Elinks，并在两边点允许防火墙。";
  }
}

function renderRecvOrbs(bonds) {
  const field = $("recv-universe");
  if (!field) return;
  lastBonds = bonds || [];
  const seen = new Set();
  const spokes = [];
  lastBonds.forEach(function (peer) {
    if (!peer || !peer.host) return;
    seen.add(peer.host);
    let node = recvOrbNodes.get(peer.host);
    if (!node) {
      node = makeOrb(field, peer, chooseRecvPeer, orbPoint(peer.host, { minR: 40, yScale: 0.82 }));
      recvOrbNodes.set(peer.host, node);
    }
    node.querySelector("span").textContent = peer.alias || peer.host;
    node._peer = peer;
    const state = bondState(peer);
    setOrbState(node, state);
    spokes.push({
      x: Number(node.style.getPropertyValue("--x")) || 50,
      y: Number(node.style.getPropertyValue("--y")) || 50,
      state: state
    });
  });
  recvOrbNodes.forEach(function (node, host) {
    if (seen.has(host)) return;
    node.remove();
    recvOrbNodes.delete(host);
  });
  drawLines($("recv-lines"), { x: 50, y: 50 }, spokes);
}

async function refreshUniverse() {
  if (!LIVE || !document.documentElement.classList.contains("is-send")) return;
  try {
    const data = await fetch("/api/discover").then(function (res) { return res.json(); });
    renderOrbs(data && data.ok ? (data.peers || []) : []);
  } catch (err) {
    renderOrbs([]);
  }
}

function startUniverse() {
  refreshUniverse();
  if (universeTimer) return;
  universeTimer = setInterval(refreshUniverse, 2000);
}

function stopUniverse() {
  if (!universeTimer) return;
  clearInterval(universeTimer);
  universeTimer = 0;
}

let outboundLinkId = "";
let linkPollTimer = 0;
let currentIncomingId = "";
const seenLinkIds = new Set();

function peerBase(peer) {
  return "http://" + peer.host + ":" + (Number(peer.port) || 8730);
}

function stopLinkPoll() {
  if (!linkPollTimer) return;
  clearInterval(linkPollTimer);
  linkPollTimer = 0;
}

function setLinkButton(label, busy) {
  const btn = $("peer-modal-link");
  if (!btn) return;
  btn.hidden = false;
  btn.disabled = Boolean(busy);
  btn.textContent = label || "建立发送链接";
}

function setHoldRow(until) {
  const row = $("peer-fact-hold-row");
  const label = holdLabel(until);
  if (row) row.hidden = !label;
  if ($("peer-fact-hold")) $("peer-fact-hold").textContent = label || "";
}

function closePeerModal() {
  stopLinkPoll();
  outboundLinkId = "";
  modalRole = "send";
  if ($("peer-modal")) $("peer-modal").hidden = true;
  setLinkButton("建立发送链接", false);
  if ($("send-pick-files")) $("send-pick-files").hidden = true;
  if ($("peer-modal-drop")) $("peer-modal-drop").hidden = true;
  setHoldRow(0);
}

function fillPeerFacts(peer) {
  const alias = (peer && (peer.alias || peer.host)) || "未命名";
  if ($("peer-modal-alias")) $("peer-modal-alias").textContent = alias;
  if ($("peer-fact-alias")) $("peer-fact-alias").textContent = alias;
  if ($("peer-fact-ip")) $("peer-fact-ip").textContent = (peer && peer.host) || "—";
  if ($("peer-fact-port")) $("peer-fact-port").textContent = String((peer && peer.port) || 8730);
  if ($("peer-fact-tls")) {
    $("peer-fact-tls").textContent = peer && peer.httpsPort ? String(peer.httpsPort) : "无";
  }
}

function openPeerModal(peer, role) {
  outboundPeer = peer;
  modalRole = role || "send";
  stopLinkPoll();
  fillPeerFacts(peer);
  const recv = modalRole === "recv";
  const bond = recv ? peer : liveSenderBond(peer && peer.host);
  const linked = Boolean(bond && (bond.session || recv) && Number(bond.until || peer.until) > Date.now());
  if (recv) {
    outboundSession = "";
    outboundBase = "";
    outboundLinkId = "";
    if ($("peer-modal-link")) $("peer-modal-link").hidden = true;
    if ($("send-pick-files")) $("send-pick-files").hidden = true;
    if ($("peer-modal-drop")) $("peer-modal-drop").hidden = false;
    setHoldRow(peer && peer.until);
  } else if (linked) {
    outboundSession = bond.session;
    outboundBase = peerBase(peer);
    outboundLinkId = bond.id || "";
    if ($("peer-modal-link")) $("peer-modal-link").hidden = true;
    if ($("send-pick-files")) $("send-pick-files").hidden = false;
    if ($("peer-modal-drop")) $("peer-modal-drop").hidden = true;
    setHoldRow(bond.until);
  } else {
    outboundSession = "";
    outboundBase = "";
    outboundLinkId = "";
    setLinkButton("建立发送链接", false);
    if ($("send-pick-files")) $("send-pick-files").hidden = true;
    if ($("peer-modal-drop")) $("peer-modal-drop").hidden = true;
    setHoldRow(0);
  }
  if ($("peer-modal")) $("peer-modal").hidden = false;
}

function paintSendOrbs() {
  renderOrbs([...orbNodes.values()].map(function (node) { return node._peer; }).filter(Boolean));
}

function applyLinkStatus(data) {
  if (!data || !data.ok) return;
  if (data.status === "pending") {
    setLinkButton("等待对方允许…", true);
    paintSendOrbs();
    return;
  }
  if (data.status === "denied" || data.status === "expired") {
    stopLinkPoll();
    outboundLinkId = "";
    setLinkButton(data.status === "denied" ? "对方拒绝了，再试一次" : "对方没有回应，再试一次", false);
    paintSendOrbs();
    return;
  }
  if (data.status === "accepted" && data.session) {
    stopLinkPoll();
    outboundSession = data.session;
    outboundBase = peerBase(outboundPeer);
    rememberSenderBond(outboundPeer, data);
    if ($("peer-modal-link")) $("peer-modal-link").hidden = true;
    if ($("send-pick-files")) $("send-pick-files").hidden = false;
    if ($("peer-modal-drop")) $("peer-modal-drop").hidden = true;
    setHoldRow(data.until);
    paintSendOrbs();
  }
}

async function requestLink() {
  const peer = outboundPeer;
  if (!peer) return;
  if (!peer.token) {
    setLinkButton("这台电脑还不能这样传", true);
    return;
  }
  const base = peerBase(peer);
  const selfHost = info && info.host ? String(info.host).split(":")[0] : "";
  setLinkButton("等待对方允许…", true);
  try {
    const res = await fetch(base + "/api/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: peer.token,
        alias: (info && info.alias) || "",
        host: selfHost,
        port: 8730
      })
    });
    const data = await res.json();
    if (!data.ok || !data.id) {
      setLinkButton("打不开这台电脑，再试一次", false);
      return;
    }
    outboundLinkId = data.id;
    applyLinkStatus(data);
    stopLinkPoll();
    linkPollTimer = setInterval(function () {
      fetch(base + "/api/link-status?id=" + encodeURIComponent(outboundLinkId))
        .then(function (res) { return res.json(); })
        .then(applyLinkStatus)
        .catch(function () {});
    }, 400);
  } catch (err) {
    setLinkButton("打不开这台电脑，再试一次", false);
  }
}

function choosePeer(host) {
  const node = orbNodes.get(host);
  const peer = node && node._peer;
  if (!peer) return;
  openPeerModal(peer, "send");
}

function chooseRecvPeer(host) {
  const node = recvOrbNodes.get(host);
  const peer = node && node._peer;
  if (!peer) return;
  openPeerModal(peer, "recv");
}

function dropBond() {
  const peer = outboundPeer;
  if (!peer || !peer.id || modalRole !== "recv") return;
  fetch("/api/link-drop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: peer.id })
  }).then(function (res) { return res.json(); }).then(function (data) {
    if (!data || !data.ok) return;
    forgetSenderBond(peer.host);
    lastBonds = lastBonds.filter(function (row) { return row.id !== peer.id; });
    closePeerModal();
    renderRecvOrbs(lastBonds);
    if (document.documentElement.classList.contains("is-send")) refreshUniverse();
  }).catch(function () {});
}

function showIncomingLink(row) {
  currentIncomingId = row && row.id ? row.id : "";
  const has = Boolean(currentIncomingId);
  if ($("link-empty")) $("link-empty").hidden = has;
  if ($("link-detail")) $("link-detail").hidden = !has;
  if (!has) return;
  if ($("link-alias")) $("link-alias").textContent = row.alias || "未命名";
  if ($("link-host")) $("link-host").textContent = row.host || "—";
  if ($("link-port")) $("link-port").textContent = String(row.port || 8730);
}

function showLinkTab(pending) {
  const tab = $("tab-link");
  if (!tab) return;
  const list = pending || [];
  tab.hidden = list.length === 0;
  if (!list.length) {
    showIncomingLink(null);
    if (document.documentElement.classList.contains("is-link")) setDeskMode("recv");
    return;
  }
  const fresh = list.filter(function (row) { return !seenLinkIds.has(row.id); });
  list.forEach(function (row) { seenLinkIds.add(row.id); });
  showIncomingLink(list[0]);
  if (fresh.length) setDeskMode("link");
}

function respondLink(allow) {
  if (!currentIncomingId) return;
  fetch("/api/link-respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: currentIncomingId, allow: allow })
  }).then(function (res) { return res.json(); }).then(function (data) {
    if (data && data.ok && allow) {
      setBusyDirection("recv");
      LINKS.setMode(true);
    }
  }).catch(function () {});
}

function setBusyDirection(kind) {
  busyKind = kind;
  const sending = kind === "send";
  const name = (outboundPeer && (outboundPeer.alias || outboundPeer.host)) || "附近电脑";
  if ($("busy")) $("busy").setAttribute("aria-label", sending ? "正在发送" : "正在接收");
  if ($("busy-live-title")) $("busy-live-title").textContent = sending ? "正在发送" : "正在接收";
  if ($("busy-done-title")) $("busy-done-title").textContent = "已完成";
  if ($("busy-done-note")) $("busy-done-note").textContent = sending ? ("发到 " + name) : "保存在接收目录";
  if ($("busy-lead")) {
    $("busy-lead").textContent = sending
      ? ("发到 " + name + "。传完的文件会到右边。")
      : "对方开始传以后，文件会出现在左边。";
  }
  if ($("live-empty")) $("live-empty").textContent = sending ? "还没有正在发送的文件。" : "还没有文件传过来。";
  if ($("done-empty")) $("done-empty").textContent = sending ? "发完的文件会列在这里。" : "收完的文件会列在这里。";
  if ($("lane-count")) {
    $("lane-count").textContent = sending ? (MAX_CONN + " 路并行发送") : (MAX_CONN + " 路并行 · 按链路调整");
  }
  const more = $("busy-pick-more");
  if (more) {
    more.hidden = !sending;
    more.disabled = !sending || outboundActive;
  }
}

function syncBusyEmpty() {
  if ($("live-empty")) $("live-empty").hidden = Boolean($("live-list") && $("live-list").children.length);
  if ($("done-empty")) $("done-empty").hidden = Boolean($("live-done") && $("live-done").children.length);
}

function appendDoneRow(box, item) {
  const node = document.createElement("div");
  node.className = "done-row";
  node.innerHTML = "<b></b><span></span><span></span><span></span>";
  node.querySelector("b").textContent = item.name;
  node.children[1].textContent = formatSize(item.size);
  node.children[2].textContent = item.mid || (item.error ? "失败" : "已发出");
  node.children[3].textContent = item.end || (item.error ? item.error : "完成");
  box.appendChild(node);
}

function renderOutbound(items) {
  const live = $("live-list");
  const doneBox = $("live-done");
  if (!live || !doneBox) return;
  live.innerHTML = "";
  doneBox.innerHTML = "";
  let sent = 0;
  let activeCount = 0;
  outboundLog.forEach(function (item) { appendDoneRow(doneBox, item); });
  (items || []).forEach(function (item) {
    sent += Number(item.sent) || 0;
    if (item.done) {
      appendDoneRow(doneBox, item);
      return;
    }
    activeCount += 1;
    const row = {
      name: item.name,
      size: item.size,
      received: item.sent || 0,
      speed: 0
    };
    live.insertAdjacentHTML("beforeend", renderRow(row));
    fillRow(live.lastElementChild, row);
  });
  const now = Date.now();
  let used = 0;
  if (outboundTick.t) {
    const dt = Math.max(0.2, (now - outboundTick.t) / 1000);
    used = Math.max(0, (sent - outboundTick.sent) / dt);
  }
  outboundTick = { t: now, sent: sent };
  const cap = ((info && info.linkMps) || 125) * 1e6;
  if ($("now-mps")) $("now-mps").textContent = Math.round(used / 1e6).toString();
  $("mbps").textContent = Math.round(used / 1e6).toString();
  $("mbs").textContent = Math.round(used / 1e6) + " M/s";
  $("util").textContent = Math.min(100, Math.round((used / cap) * 100)) + "%";
  $("meter-fill").style.width = Math.min(100, (used / cap) * 100).toFixed(1) + "%";
  $("active-count").textContent = activeCount ? (activeCount + " 个进行中") : "没有进行中";
  const doneCount = outboundLog.length + (items || []).filter(function (item) { return item.done && !item.error; }).length;
  $("today").textContent = "这次已发送 " + doneCount + " 个文件";
  syncBusyEmpty();
}

function rememberOutbound(items) {
  (items || []).forEach(function (item) {
    if (!item || !item.done) return;
    outboundLog.push({
      name: item.name,
      size: item.size,
      error: item.error || "",
      mid: item.error ? "失败" : "已发出",
      end: item.error ? item.error : "完成"
    });
  });
}

function startOutbound(files) {
  closePeerModal();
  outboundActive = true;
  outboundTick = { t: 0, sent: 0 };
  setBusyDirection("send");
  LINKS.setMode(true);
  import("./send.mjs").then(function (mod) {
    return mod.sendFiles(files, {
      session: outboundSession,
      lanes: MAX_CONN,
      base: outboundBase,
      onProgress: renderOutbound
    });
  }).then(function (items) {
    const blocked = (items || []).some(function (item) { return item && item.error === "cancelled"; });
    if (blocked && outboundPeer) forgetSenderBond(outboundPeer.host);
    rememberOutbound(items);
    outboundActive = false;
    setBusyDirection("send");
    renderOutbound([]);
  }).catch(function () {
    if (outboundPeer) forgetSenderBond(outboundPeer.host);
    outboundActive = false;
    setBusyDirection("send");
    renderOutbound([]);
  });
}

$("pick-files").addEventListener("click", function () {
  $("file-input").click();
});

if ($("send-pick-files")) {
  $("send-pick-files").addEventListener("click", function () {
    if (!outboundSession || !outboundBase) return;
    $("file-input").click();
  });
}

if ($("busy-pick-more")) {
  $("busy-pick-more").addEventListener("click", function () {
    if (!outboundSession || !outboundBase || outboundActive) return;
    $("file-input").click();
  });
}

function clearDoneRecords() {
  if (busyKind === "send") {
    outboundLog = [];
    renderOutbound([]);
    return;
  }
  fetch("/api/transfers-clear", { method: "POST" }).then(function (res) { return res.json(); }).then(function (data) {
    if (!data || !data.ok) return;
    const box = $("live-done");
    if (box) box.innerHTML = "";
    syncBusyEmpty();
    if ($("today")) $("today").textContent = "今天已接收 0 个文件";
  }).catch(function () {});
}

if ($("clear-done")) {
  $("clear-done").addEventListener("click", function () { clearDoneRecords(); });
}

if ($("peer-modal-link")) {
  $("peer-modal-link").addEventListener("click", function () { requestLink(); });
}

if ($("peer-modal-close")) {
  $("peer-modal-close").addEventListener("click", function () { closePeerModal(); });
}

if ($("peer-modal-drop")) {
  $("peer-modal-drop").addEventListener("click", function () { dropBond(); });
}

if ($("link-allow")) {
  $("link-allow").addEventListener("click", function () { respondLink(true); });
}

if ($("link-deny")) {
  $("link-deny").addEventListener("click", function () { respondLink(false); });
}

$("file-input").addEventListener("change", function () {
  const files = Array.prototype.slice.call($("file-input").files || []);
  $("file-input").value = "";
  if (!files.length) return;
  if (outboundSession && outboundBase) {
    startOutbound(files);
    return;
  }
  if (!sessionId) return;
  setBusyDirection("recv");
  LINKS.setMode(true);
  import("./send.mjs").then(function (mod) {
    return mod.sendFiles(files, { session: sessionId, lanes: MAX_CONN });
  });
});

const icon = {
  video: '<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="3" width="14" height="10" rx="1.4" fill="none" stroke="#1f6feb" stroke-width="1.2"/><path d="M6.2 5.6v4.8L11 8z" fill="#1f6feb"/></svg>',
  photo: '<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.4" fill="none" stroke="#1f6feb" stroke-width="1.2"/><circle cx="5.5" cy="6" r="1.1" fill="#1f6feb"/><path d="M2.5 11.2l3.2-2.6 2.2 1.6 1.6-1.2 3.8 2.6" fill="none" stroke="#1f6feb" stroke-width="1.1"/></svg>'
};

function kindOf(name) {
  return /\.(mov|mp4|m4v|webm|mkv)$/i.test(name) ? "video" : "photo";
}

function renderRow(item) {
  const kind = kindOf(item.name);
  const ratio = item.size ? item.received / item.size : 0;
  const left = Math.max(0, item.size - item.received);
  const eta = item.speed > 0 ? Math.round(left / item.speed) : 0;
  return '<article class="row">' + icon[kind] +
    '<div class="name"><b></b><small></small></div>' +
    '<div class="speed"><b></b><small></small></div>' +
    '<div class="line"><i></i></div></article>';
}

function fillRow(node, item) {
  const kind = kindOf(item.name);
  const ratio = item.size ? item.received / item.size : 0;
  const left = Math.max(0, item.size - item.received);
  const eta = item.speed > 0 ? Math.round(left / item.speed) : 0;
  node.querySelector(".name b").textContent = item.name;
  node.querySelector(".name small").textContent =
    (kind === "video" ? "视频 · " + MAX_CONN + " 路 · " : "照片 · ") +
    formatSize(item.received) + " / " + formatSize(item.size);
  node.querySelector(".speed b").textContent = (item.speed / 1e6).toFixed(1) + " M/s";
  node.querySelector(".speed small").textContent = eta ? "剩余 " + eta + " 秒" : "进行中";
  node.querySelector(".line i").style.width = (Math.min(1, ratio) * 100).toFixed(1) + "%";
}

async function pollTransfers() {
  if (!LIVE) return;
  const data = await fetch("/api/transfers").then(function (res) { return res.json(); });
  showLinkTab(data.pendingLinks || []);
  liveSessions = new Set((data.active || []).map(function (item) { return item && item.session; }).filter(Boolean));
  renderRecvOrbs(data.bonds || []);
  if (document.documentElement.classList.contains("is-send")) paintSendOrbs();
  if (outboundActive) return;
  if (busyKind === "send" && !(data.active || []).length) return;
  const live = $("live-list");
  live.innerHTML = "";
  let used = 0;
  (data.active || []).forEach(function (item) {
    live.insertAdjacentHTML("beforeend", renderRow(item));
    fillRow(live.lastElementChild, item);
    used += item.speed || 0;
  });
  const doneBox = $("live-done");
  doneBox.innerHTML = "";
  (data.done || []).slice().reverse().forEach(function (item) {
    const row = document.createElement("div");
    row.className = "done-row";
    row.innerHTML = "<b></b><span></span><span></span><span></span>";
    row.querySelector("b").textContent = item.name;
    row.children[1].textContent = formatSize(item.size);
    row.children[3].textContent = item.speed ? (item.speed / 1e6).toFixed(0) + " M/s" : "完成";
    row.children[2].textContent = "已保存";
    doneBox.appendChild(row);
  });
  const cap = ((info && info.linkMps) || 125) * 1e6;
  const usedM = used / 1e6;
  if ($("now-mps")) $("now-mps").textContent = Math.round(usedM).toString();
  $("mbps").textContent = Math.round(usedM).toString();
  $("mbs").textContent = Math.round(usedM) + " M/s";
  $("util").textContent = Math.min(100, Math.round((used / cap) * 100)) + "%";
  $("meter-fill").style.width = Math.min(100, (used / cap) * 100).toFixed(1) + "%";
  $("active-count").textContent = (data.active || []).length ? (data.active.length + " 个进行中") : "0 个进行中";
  $("today").textContent = "今天已接收 " + (data.done || []).length + " 个文件";
  syncBusyEmpty();
  if ((data.active || []).length) {
    setBusyDirection("recv");
    LINKS.setMode(true);
  }
}
