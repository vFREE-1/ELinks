const LIVE = location.protocol === "http:" || location.protocol === "https:";
const LINKS = window.Links;
let MAX_CONN = 4;

let info = null;
let sessionId = "";
let pollTimer = 0;

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
  if ($("cap-mps")) $("cap-mps").textContent = info.linkMps ? String(info.linkMps) : "—";
  if ($("now-mps")) $("now-mps").textContent = "0";
  showNetPath();
  $("today").textContent = "今天已接收 0 个文件";
  $("active-count").textContent = "等待发送";
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
    $("brand-sub").textContent = link ? "连接请求" : send ? "传到附近" : "桌面接收";
  }
  if ($("stage")) {
    $("stage").setAttribute("aria-label", link ? "连接请求" : send ? "传到附近电脑" : "等待接收");
  }
  if (send) startUniverse();
  else stopUniverse();
  requestAnimationFrame(function () { window.dispatchEvent(new Event("resize")); });
}

$("tab-recv").addEventListener("click", function () { setDeskMode("recv"); });
$("tab-send").addEventListener("click", function () { setDeskMode("send"); });
if ($("tab-link")) $("tab-link").addEventListener("click", function () { setDeskMode("link"); });

function showPageQr() {
  qrMode = "page";
  if (pageMatrix) applyMatrix(pageMatrix);
  $("qr").setAttribute("aria-label", "接收页二维码，手机扫码后选择照片或视频");
  $("stage-title").textContent = "等待接收";
  const name = networkName();
  if (wifiMatrix) {
    $("join-wifi").hidden = false;
    $("join-wifi-title").textContent = "要连这个 Wi-Fi？";
    $("join-wifi-copy").textContent = "点这里，大码换成加入" + name + "的码。弹出后点加入，不用输密码。";
  } else {
    $("join-wifi").hidden = true;
  }
  if (info && info.usb) {
    $("stage-lead").textContent = "数据线已接上。扫码后仍在手机里选照片，文件走这条线，不用在电脑上翻文件夹。";
  } else if (name) {
    $("stage-lead").textContent = "用手机相机扫这个码，就会打开选照片。要先连 Wi-Fi" + name + "，再扫这个码。";
  } else {
    $("stage-lead").textContent = "用手机相机扫这个码，就会打开选照片。手机要和这台电脑在同一个网络。";
  }
  showAllowLan();
}

function showAllowLan() {
  const card = $("allow-lan");
  if (!card) return;
  const local = location.hostname === "127.0.0.1" || location.hostname === "localhost" || location.hostname === "[::1]";
  if (!local || qrMode !== "page" || !info || !info.needAllow) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  $("allow-lan-title").textContent = "检查过了：手机现在连不进来";
  if (info.usb) {
    $("allow-lan-copy").textContent = "点这里允许接入。只需确认一次，确认后会再检查一次。";
    return;
  }
  $("allow-lan-copy").textContent = "点这里允许接入。只需确认一次，确认后会再检查一次。";
}

function showWifiQr() {
  if (!wifiMatrix) return;
  setWaitTab("scan");
  qrMode = "wifi";
  applyMatrix(wifiMatrix);
  $("qr").setAttribute("aria-label", "加入这台电脑所在 Wi-Fi 的二维码");
  $("stage-title").textContent = "先加入这个 Wi-Fi";
  $("stage-lead").textContent = "用相机扫上面的码，弹出后点加入" + networkName() + "。";
  $("join-wifi").hidden = false;
  $("join-wifi-title").textContent = "已经加入了？";
  $("join-wifi-copy").textContent = "点这里，换回接收码，再扫一次就会打开选照片。";
  showAllowLan();
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
    $("join-wifi-title").textContent = "现在还不能换码";
    $("join-wifi-copy").textContent = "没有读到这个 Wi-Fi 的加入码，请稍后再点。";
    return;
  }
  if (qrMode === "wifi") showPageQr();
  else showWifiQr();
});

let allowing = false;
$("allow-lan").addEventListener("click", function (event) {
  event.preventDefault();
  if (allowing) return;
  allowing = true;
  $("allow-lan").disabled = true;
  $("allow-lan-title").textContent = "请在系统窗口点「是」";
  $("allow-lan-copy").textContent = "正在请求允许手机连入，这不是连 Wi-Fi。";
  fetch("/api/allow-lan", { method: "POST" }).then(function (res) { return res.json(); }).then(function (data) {
    return refreshLink().then(function () {
      allowing = false;
      $("allow-lan").disabled = false;
      if ((data && data.ok === false) || (info && info.needAllow)) {
        $("allow-lan").hidden = false;
        $("allow-lan-title").textContent = "还是连不进来";
        $("allow-lan-copy").textContent = "请再点一次，并在系统窗口选择是。确认后窗口会自己关掉。";
        return;
      }
      showPageQr();
    });
  }).catch(function () {
    allowing = false;
    $("allow-lan").disabled = false;
    $("allow-lan").hidden = false;
    $("allow-lan-title").textContent = "没有完成允许";
    $("allow-lan-copy").textContent = "请再点一次，并在系统窗口选择是。";
  });
});

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
  if ($("cap-mps")) $("cap-mps").textContent = info && info.linkMps ? String(info.linkMps) : "—";
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
  persistConfig().then(function () {
    fetch("/api/open-dir?path=" + encodeURIComponent(savePath));
  });
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
let outboundActive = false;
let outboundPeer = null;
let outboundSession = "";
let outboundBase = "";

function hashStr(text) {
  let n = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) n = Math.imul(n ^ s.charCodeAt(i), 16777619);
  return n >>> 0;
}

function orbPoint(host) {
  const n = hashStr(host);
  const angle = ((n % 360) / 180) * Math.PI;
  const radius = 28 + (n % 11);
  return {
    x: Math.max(14, Math.min(86, 50 + Math.cos(angle) * radius)),
    y: Math.max(18, Math.min(78, 48 + Math.sin(angle) * radius * 0.78))
  };
}

function renderOrbs(peers) {
  const field = $("universe");
  const empty = $("universe-empty");
  if (!field) return;
  const seen = new Set();
  (peers || []).forEach(function (peer) {
    if (!peer || !peer.host) return;
    seen.add(peer.host);
    let node = orbNodes.get(peer.host);
    if (!node) {
      const point = orbPoint(peer.host);
      const seed = hashStr(peer.host);
      node = document.createElement("button");
      node.type = "button";
      node.className = "orb";
      node.style.setProperty("--x", point.x.toFixed(1));
      node.style.setProperty("--y", point.y.toFixed(1));
      node.style.animationDelay = "-" + ((seed % 17) * 0.37).toFixed(2) + "s";
      node.style.animationDuration = (7.2 + (seed % 5) * 0.7).toFixed(1) + "s";
      node.appendChild(document.createElement("i"));
      node.appendChild(document.createElement("span"));
      node.addEventListener("click", function () { choosePeer(peer.host); });
      field.appendChild(node);
      orbNodes.set(peer.host, node);
    }
    node.querySelector("span").textContent = peer.alias || peer.host;
    node._peer = peer;
  });
  orbNodes.forEach(function (node, host) {
    if (seen.has(host)) return;
    node.remove();
    orbNodes.delete(host);
  });
  if (empty) {
    empty.hidden = false;
    empty.textContent = seen.size ? "点一台电脑，发给它" : "附近没有其他电脑";
  }
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

function setModalStatus(text) {
  if ($("peer-modal-status")) $("peer-modal-status").textContent = text || "";
}

function closePeerModal() {
  stopLinkPoll();
  outboundLinkId = "";
  if ($("peer-modal")) $("peer-modal").hidden = true;
  if ($("peer-modal-link")) $("peer-modal-link").hidden = false;
  if ($("send-pick-files")) $("send-pick-files").hidden = true;
  setModalStatus("");
}

function openPeerModal(peer) {
  outboundPeer = peer;
  outboundSession = "";
  outboundBase = "";
  outboundLinkId = "";
  stopLinkPoll();
  const alias = peer.alias || peer.host || "未命名";
  if ($("peer-modal-alias")) $("peer-modal-alias").textContent = alias;
  if ($("peer-fact-alias")) $("peer-fact-alias").textContent = alias;
  if ($("peer-fact-ip")) $("peer-fact-ip").textContent = peer.host || "—";
  if ($("peer-fact-port")) $("peer-fact-port").textContent = String(peer.port || 8730);
  if ($("peer-fact-tls")) {
    $("peer-fact-tls").textContent = peer.httpsPort ? String(peer.httpsPort) : "无";
  }
  if ($("peer-modal-link")) {
    $("peer-modal-link").hidden = false;
    $("peer-modal-link").disabled = false;
  }
  if ($("send-pick-files")) $("send-pick-files").hidden = true;
  setModalStatus("确认是这台电脑后，建立发送链接。对方允许后才能选文件。");
  if ($("peer-modal")) $("peer-modal").hidden = false;
}

function applyLinkStatus(data) {
  if (!data || !data.ok) return;
  if (data.status === "pending") {
    setModalStatus("已发出请求，等待对方允许…");
    return;
  }
  if (data.status === "denied" || data.status === "expired") {
    stopLinkPoll();
    if ($("peer-modal-link")) $("peer-modal-link").hidden = false;
    setModalStatus(data.status === "denied" ? "对方拒绝了这次连接。" : "对方没有回应。");
    return;
  }
  if (data.status === "accepted" && data.session) {
    stopLinkPoll();
    outboundSession = data.session;
    outboundBase = peerBase(outboundPeer);
    if ($("peer-modal-link")) $("peer-modal-link").hidden = true;
    if ($("send-pick-files")) $("send-pick-files").hidden = false;
    setModalStatus("对方已允许。现在可以选文件发送。");
  }
}

async function requestLink() {
  const peer = outboundPeer;
  if (!peer) return;
  if (!peer.token) {
    setModalStatus("这台电脑还不能这样传。");
    return;
  }
  const base = peerBase(peer);
  const selfHost = info && info.host ? String(info.host).split(":")[0] : "";
  $("peer-modal-link").disabled = true;
  setModalStatus("正在请求对方允许…");
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
      $("peer-modal-link").disabled = false;
      setModalStatus("打不开这台电脑。");
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
    $("peer-modal-link").disabled = false;
    setModalStatus("打不开这台电脑。");
  }
}

function choosePeer(host) {
  const node = orbNodes.get(host);
  const peer = node && node._peer;
  if (!peer) return;
  openPeerModal(peer);
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
    if (data && data.ok && allow) setDeskMode("recv");
  }).catch(function () {});
}

function setBusyDirection(kind) {
  const sending = kind === "send";
  const name = (outboundPeer && (outboundPeer.alias || outboundPeer.host)) || "附近电脑";
  if ($("busy-live-title")) $("busy-live-title").textContent = sending ? "正在发送" : "正在接收";
  if ($("busy-done-title")) $("busy-done-title").textContent = "已完成";
  if ($("busy-done-note")) $("busy-done-note").textContent = sending ? ("发到 " + name) : "保存在接收目录";
  if ($("lane-count")) {
    $("lane-count").textContent = sending ? (MAX_CONN + " 路并行发送") : (MAX_CONN + " 路并行 · 按链路调整");
  }
}

function renderOutbound(items) {
  const live = $("live-list");
  const doneBox = $("live-done");
  if (!live || !doneBox) return;
  live.innerHTML = "";
  doneBox.innerHTML = "";
  let used = 0;
  let activeCount = 0;
  (items || []).forEach(function (item) {
    const row = {
      name: item.name,
      size: item.size,
      received: item.sent || 0,
      speed: 0
    };
    if (item.done) {
      const node = document.createElement("div");
      node.className = "done-row";
      node.innerHTML = "<b></b><span></span><span></span><span></span>";
      node.querySelector("b").textContent = item.name;
      node.children[1].textContent = formatSize(item.size);
      node.children[2].textContent = item.error ? "失败" : "已发出";
      node.children[3].textContent = item.error ? item.error : "完成";
      doneBox.appendChild(node);
      return;
    }
    activeCount += 1;
    live.insertAdjacentHTML("beforeend", renderRow(row));
    fillRow(live.lastElementChild, row);
  });
  const cap = ((info && info.linkMps) || 125) * 1e6;
  if ($("now-mps")) $("now-mps").textContent = Math.round(used / 1e6).toString();
  $("mbps").textContent = Math.round(used / 1e6).toString();
  $("mbs").textContent = Math.round(used / 1e6) + " M/s";
  $("util").textContent = Math.min(100, Math.round((used / cap) * 100)) + "%";
  $("meter-fill").style.width = Math.min(100, (used / cap) * 100).toFixed(1) + "%";
  $("active-count").textContent = activeCount ? (activeCount + " 个文件并行") : "发送完成";
  $("today").textContent = "这次已发送 " + (items || []).filter(function (item) { return item.done && !item.error; }).length + " 个文件";
}

function startOutbound(files) {
  closePeerModal();
  outboundActive = true;
  setBusyDirection("send");
  LINKS.setMode(true);
  import("./send.mjs").then(function (mod) {
    return mod.sendFiles(files, {
      session: outboundSession,
      lanes: MAX_CONN,
      base: outboundBase,
      onProgress: renderOutbound
    });
  }).then(function () {
    outboundActive = false;
  }).catch(function () {
    outboundActive = false;
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

if ($("peer-modal-link")) {
  $("peer-modal-link").addEventListener("click", function () { requestLink(); });
}

if ($("peer-modal-close")) {
  $("peer-modal-close").addEventListener("click", function () { closePeerModal(); });
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
  if (outboundActive) return;
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
  $("active-count").textContent = (data.active || []).length ? (data.active.length + " 个文件并行") : "等待发送";
  $("today").textContent = "今天已接收 " + (data.done || []).length + " 个文件";
  if ((data.active || []).length) {
    setBusyDirection("recv");
    LINKS.setMode(true);
  }
}
