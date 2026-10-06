const LIVE = location.protocol === "http:" || location.protocol === "https:";
const LINKS = window.Links;
let MAX_CONN = 6;
const SLICE = 4 * 1024 * 1024;

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
  $("desk-host").value = info.host;
  $("host").value = info.host;
  $("save-path").value = info.savePath;
  $("save-path-bar").value = info.savePath;
  $("pass-flag").hidden = !info.passwordSet;
  if ($("cap-mps")) $("cap-mps").textContent = info.linkMps ? String(info.linkMps) : "—";
  if ($("now-mps")) $("now-mps").textContent = "0";
  $("today").textContent = "今天已接收 0 个文件";
  $("active-count").textContent = "等待发送";
  $("mbps").textContent = "0";
  $("mbs").textContent = "0 M/s";
  $("util").textContent = "0%";
  $("meter-fill").style.width = "0%";
  $("lane-count").textContent = MAX_CONN + " 路并行 · 顶满带宽";

  const qr = await fetch("/api/qr-matrix").then(function (res) { return res.json(); });
  if (qr.matrix && qr.matrix.length) {
    pageMatrix = qr.matrix;
    applyMatrix(pageMatrix);
  }
  await loadWifiJoin();

  const params = new URLSearchParams(location.search);
  if (params.get("phone") === "1") {
    if (params.get("t")) info.token = params.get("t");
    LINKS.showPhone();
    pair(false);
  }

  pollTransfers();
  pollTimer = setInterval(pollTransfers, 400);
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
  return info && info.ssid ? "「" + info.ssid + "」" : "";
}

function showPageQr() {
  qrMode = "page";
  if (pageMatrix) applyMatrix(pageMatrix);
  $("qr").setAttribute("aria-label", "接收页二维码，手机扫码后选择照片或视频");
  $("stage-title").textContent = "等待接收";
  const name = networkName();
  if (wifiMatrix) {
    $("stage-lead").textContent = "用手机相机扫码，就会打开选照片。";
    $("join-wifi").hidden = false;
    $("join-wifi").textContent = "还没连上" + name + "？";
    return;
  }
  $("join-wifi").hidden = true;
  if (name) $("stage-lead").textContent = "用手机相机扫码，就会打开选照片。手机要连着 Wi-Fi" + name + "。";
  else $("stage-lead").textContent = "用手机相机扫码，就会打开选照片。手机要和这台电脑在同一个网络。";
}

function showWifiQr() {
  if (!wifiMatrix) return;
  qrMode = "wifi";
  applyMatrix(wifiMatrix);
  $("qr").setAttribute("aria-label", "加入这台电脑所在 Wi-Fi 的二维码");
  $("stage-title").textContent = "加入 Wi-Fi";
  $("stage-lead").textContent = "用相机扫这个码，弹出后点加入" + networkName() + "。连上后点下面，再扫接收码。";
  $("join-wifi").hidden = false;
  $("join-wifi").textContent = "已连上，显示接收码";
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

$("join-wifi").addEventListener("click", function () {
  if (qrMode === "wifi") showPageQr();
  else showWifiQr();
});

function persistConfig() {
  const body = {
    savePath: $("save-path-bar").value || $("save-path").value,
    password: $("receive-password").value
  };
  fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (res) { return res.json(); }).then(function (data) {
    if (data.savePath) {
      $("save-path").value = data.savePath;
      $("save-path-bar").value = data.savePath;
    }
    $("pass-flag").hidden = !data.passwordSet;
  }).catch(function () {});
}

$("save-path").addEventListener("change", persistConfig);
$("save-path-bar").addEventListener("change", persistConfig);
$("receive-password").addEventListener("change", persistConfig);
$("close-settings").addEventListener("click", persistConfig);

$("open-dir").addEventListener("click", function () {
  if (!LIVE) return;
  fetch("/api/open-dir", { method: "GET" });
});

async function pair(fromForm) {
  const payload = { token: info.token };
  if (fromForm) payload.password = $("join-password").value;
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
  files.forEach(function (file) { uploadFile(file); });
});

let inflight = 0;
const waiting = [];

function withConn(fn) {
  return new Promise(function (resolve, reject) {
    function run() {
      inflight += 1;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .then(function () {
          inflight -= 1;
          const next = waiting.shift();
          if (next) next();
        });
    }
    if (inflight < MAX_CONN) run();
    else waiting.push(run);
  });
}

function uploadFile(file) {
  const size = file.size;
  const jobs = [];
  for (let start = 0; start < size; start += SLICE) {
    const end = Math.min(size, start + SLICE);
    jobs.push(withConn(function () { return putSlice(file, start, end, size); }));
  }
  return Promise.all(jobs);
}

function putSlice(file, start, end, size) {
  const blob = file.slice(start, end);
  const query = new URLSearchParams({
    session: sessionId,
    name: file.name,
    size: String(size),
    offset: String(start)
  });
  return fetch("/api/upload?" + query.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob
  });
}

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
