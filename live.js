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
  if ($("app-version") && info.version) $("app-version").textContent = info.version;
  if ($("cap-mps")) $("cap-mps").textContent = info.linkMps ? String(info.linkMps) : "—";
  if ($("now-mps")) $("now-mps").textContent = "0";
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

async function refreshLink() {
  info = await fetch("/api/info").then(function (res) { return res.json(); });
  $("desk-host").value = info.phoneUrl || info.host;
  $("host").value = info.host;
  const qr = await fetch("/api/qr-matrix").then(function (res) { return res.json(); });
  if (qr.matrix && qr.matrix.length) {
    pageMatrix = qr.matrix;
    if (qrMode === "page") applyMatrix(pageMatrix);
  }
}

function persistConfig() {
  const ringsOn = !$("rings-toggle") || $("rings-toggle").getAttribute("aria-checked") !== "false";
  const body = {
    savePath: $("save-path-bar").value || $("save-path").value,
    password: $("receive-password").value,
    rings: ringsOn
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

$("pick-files").addEventListener("click", function () {
  $("file-input").click();
});

$("file-input").addEventListener("change", function () {
  const files = Array.prototype.slice.call($("file-input").files || []);
  $("file-input").value = "";
  if (!files.length || !sessionId) return;
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
  if ((data.active || []).length) LINKS.setMode(true);
}
