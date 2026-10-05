const linkMbps = 940;

const videos = [
  {
    bytes: 4.8 * 1024 ** 3,
    done: 0.22,
    weight: 1.15,
    speed: "v1-speed",
    eta: "v1-eta",
    bar: "v1-bar",
    bytesLabel: "v1-bytes",
    label: "视频 · 8 路 · ",
  },
  {
    bytes: 2.2 * 1024 ** 3,
    done: 0.37,
    weight: 0.95,
    speed: "v2-speed",
    eta: "v2-eta",
    bar: "v2-bar",
    bytesLabel: "v2-bytes",
    label: "视频 · 8 路 · ",
  },
];

const photos = {
  bytes: 180 * 1024 ** 2,
  done: 0.45,
  weight: 0.22,
  alive: true,
};

let last = performance.now();
let running = false;

function $(id) {
  return document.getElementById(id);
}

function formatGb(bytes) {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return gb.toFixed(2) + " GB";
  return Math.round(bytes / 1024 ** 2) + " MB";
}

function formatEta(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return "剩余 " + r + " 秒";
  return "剩余 " + m + " 分 " + String(r).padStart(2, "0") + " 秒";
}

function setMode(busy) {
  document.documentElement.classList.toggle("is-busy", busy);
  if (busy) document.documentElement.classList.remove("is-phone");
  $("mode").textContent = busy ? "返回等待" : "查看接收";
  $("open-phone").textContent = "手机页";
  if (busy && !running) {
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
}

$("mode").addEventListener("click", function () {
  setMode(!document.documentElement.classList.contains("is-busy"));
});

if (document.documentElement.classList.contains("is-busy")) setMode(true);

function activeItems() {
  const items = videos.filter(function (video) { return video.done < 1; }).map(function (video) {
    return { item: video, weight: video.weight };
  });
  if (photos.alive) items.push({ item: photos, weight: photos.weight });
  return items;
}

function paintFile(file) {
  const ratio = Math.min(1, file.done);
  const left = file.bytes * (1 - ratio);
  const bytesPerSec = (file.mbps / 8) * 1024 * 1024;
  $(file.bar).style.width = (ratio * 100).toFixed(1) + "%";
  $(file.speed).textContent = (file.mbps / 8).toFixed(1) + " MB/s";
  $(file.eta).textContent = formatEta(left / bytesPerSec);
  $(file.bytesLabel).textContent = file.label + formatGb(file.bytes * ratio) + " / " + formatGb(file.bytes);
}

function paintPhotos() {
  const ratio = Math.min(1, photos.done);
  const left = photos.bytes * (1 - ratio);
  const bytesPerSec = (photos.mbps / 8) * 1024 * 1024;
  $("p-bar").style.width = (ratio * 100).toFixed(1) + "%";
  $("p-speed").textContent = (photos.mbps / 8).toFixed(1) + " MB/s";
  $("p-eta").textContent = formatEta(left / bytesPerSec);
  $("p-bytes").textContent = "照片 · " + Math.round((photos.bytes * ratio) / 1024 ** 2) + " MB / 180 MB";
}

function finishPhotos() {
  photos.alive = false;
  $("file-photos").remove();
  const row = document.createElement("div");
  row.className = "done-row";
  row.innerHTML = "<b>IMG_8831.HEIC</b><span>180 MB</span><span>9 秒</span><span>20 MB/s</span>";
  $("done-anchor").before(row);
  $("active-count").textContent = "9 个文件并行";
  $("today").textContent = "今天已接收 5 个文件 · 1.29 GB";
}

function frame(now) {
  if (!document.documentElement.classList.contains("is-busy")) {
    running = false;
    return;
  }

  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const items = activeItems();
  const weightSum = items.reduce(function (sum, entry) { return sum + entry.weight; }, 0);
  const cap = linkMbps * (0.985 + Math.sin(now / 650) * 0.01);
  let total = 0;

  items.forEach(function (entry) {
    const jitter = 0.96 + Math.sin(now / 280 + entry.weight * 5) * 0.04;
    entry.item.mbps = cap * (entry.weight / weightSum) * jitter;
    total += entry.item.mbps;
  });

  const scale = cap / total;
  items.forEach(function (entry) {
    entry.item.mbps *= scale;
    entry.item.done += ((entry.item.mbps / 8) * 1024 * 1024 * dt) / entry.item.bytes;
  });

  videos.forEach(paintFile);
  if (photos.alive) {
    paintPhotos();
    if (photos.done >= 1) finishPhotos();
  }

  const used = Math.min(linkMbps, items.reduce(function (sum, entry) { return sum + entry.item.mbps; }, 0));
  $("mbps").textContent = Math.round(used).toString();
  $("mbs").textContent = (used / 8).toFixed(0) + " MB/s";
  $("util").textContent = Math.round((used / linkMbps) * 100) + "%";
  $("meter-fill").style.width = ((used / linkMbps) * 100).toFixed(1) + "%";
  requestAnimationFrame(frame);
}

const memory = {
  path: localStorage.getItem("links.path") || "D:\\Links\\接收",
  password: localStorage.getItem("links.password") || "",
  host: localStorage.getItem("links.host") || "192.168.1.24:8730"
};

$("save-path").value = memory.path;
$("save-path-bar").value = memory.path;
$("receive-password").value = memory.password;
$("host").value = memory.host;
$("desk-host").value = memory.host;

function rememberPath(value) {
  memory.path = value;
  localStorage.setItem("links.path", value);
  $("save-path").value = value;
  $("save-path-bar").value = value;
}

function rememberPassword(value) {
  memory.password = value;
  localStorage.setItem("links.password", value);
  $("pass-flag").hidden = value.trim() === "";
}

$("save-path").addEventListener("input", function () { rememberPath($("save-path").value); });
$("save-path-bar").addEventListener("input", function () { rememberPath($("save-path-bar").value); });
$("receive-password").addEventListener("input", function () { rememberPassword($("receive-password").value); });
rememberPassword(memory.password);

$("open-settings").addEventListener("click", function () {
  $("settings").hidden = !$("settings").hidden;
});
$("close-settings").addEventListener("click", function () {
  $("settings").hidden = true;
});
$("open-dir").addEventListener("click", function () {
  document.documentElement.classList.remove("is-busy", "is-phone");
  $("mode").textContent = "查看接收";
  $("open-phone").textContent = "手机页";
  $("save-path-bar").focus();
  $("save-path-bar").select();
});

let passwordAsked = false;

function resetJoin() {
  passwordAsked = false;
  $("password-block").classList.remove("open");
  $("password-error").hidden = true;
  $("join-password").value = "";
  $("join-go").textContent = "连接";
  $("join-form").hidden = false;
  $("pick").hidden = true;
}

function showPhone() {
  document.documentElement.classList.remove("is-busy");
  document.documentElement.classList.add("is-phone");
  $("mode").textContent = "查看接收";
  $("open-phone").textContent = "返回等待";
  $("settings").hidden = true;
  resetJoin();
  $("host").value = localStorage.getItem("links.host") || memory.host;
}

$("open-phone").addEventListener("click", function () {
  if (document.documentElement.classList.contains("is-phone")) {
    document.documentElement.classList.remove("is-phone");
    $("open-phone").textContent = "手机页";
    return;
  }
  showPhone();
});

function openPicker() {
  $("join-form").hidden = true;
  $("pick").hidden = false;
}

function continueJoin(fromScan) {
  const host = (fromScan ? memory.host : $("host").value).trim();
  if (!host) return;
  memory.host = host;
  localStorage.setItem("links.host", host);
  $("host").value = host;
  $("desk-host").value = host;
  const secret = $("receive-password").value;
  if (secret.trim() && !passwordAsked) {
    passwordAsked = true;
    $("password-block").classList.add("open");
    $("join-go").textContent = "确认";
    $("join-password").focus();
    return;
  }
  if (secret.trim() && $("join-password").value !== secret) {
    $("password-error").hidden = false;
    return;
  }
  openPicker();
}

$("join-form").addEventListener("submit", function (event) {
  event.preventDefault();
  $("password-error").hidden = true;
  continueJoin(false);
});

$("scan").addEventListener("click", function () {
  resetJoin();
  continueJoin(true);
});

const QR_MATRIX = [[1,1,1,1,1,1,1,0,0,0,0,1,0,1,0,0,1,0,1,1,1,1,1,1,1],[1,0,0,0,0,0,1,0,1,1,1,1,0,1,0,0,0,0,1,0,0,0,0,0,1],[1,0,1,1,1,0,1,0,1,1,0,0,1,0,0,0,1,0,1,0,1,1,1,0,1],[1,0,1,1,1,0,1,0,1,1,1,1,1,1,1,1,1,0,1,0,1,1,1,0,1],[1,0,1,1,1,0,1,0,0,0,1,1,0,0,1,0,0,0,1,0,1,1,1,0,1],[1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,1,0,1,0,0,0,0,0,1],[1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,0,1,0,1,1,1,1,1,1,1],[0,0,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,1,0,1,0,1,0,1,1,0,1,1,1,1,0,0,1,1,1,0],[1,1,1,1,0,0,0,0,0,0,1,1,1,1,0,1,1,1,0,0,1,1,1,1,0],[1,1,1,1,0,0,1,0,0,1,0,0,0,1,0,1,0,0,1,1,0,1,0,1,1],[0,0,0,0,1,1,0,0,0,0,1,0,1,0,0,1,1,0,0,0,1,1,0,0,1],[0,1,0,0,1,0,1,1,0,1,0,0,1,0,1,0,1,1,1,0,0,0,0,0,1],[1,0,0,1,0,0,0,0,1,0,1,0,0,1,1,1,0,0,0,0,0,0,0,1,0],[1,0,0,1,1,0,1,1,1,0,0,1,1,0,0,1,0,1,0,1,0,1,0,1,1],[1,0,1,0,0,0,0,0,0,1,1,1,0,0,1,0,1,0,0,0,1,0,1,0,1],[1,0,1,1,1,1,1,0,1,0,0,1,1,1,0,0,1,1,1,1,1,0,1,0,0],[0,0,0,0,0,0,0,0,1,1,0,0,1,0,1,1,1,0,0,0,1,0,1,0,0],[1,1,1,1,1,1,1,0,0,0,1,1,1,0,0,0,1,0,1,0,1,1,0,0,1],[1,0,0,0,0,0,1,0,0,1,1,0,1,0,1,0,1,0,0,0,1,0,0,0,1],[1,0,1,1,1,0,1,0,0,1,0,0,1,1,0,1,1,1,1,1,1,1,1,0,0],[1,0,1,1,1,0,1,0,0,1,1,0,1,0,0,0,0,0,1,1,0,1,0,1,1],[1,0,1,1,1,0,1,0,0,1,0,0,1,1,0,0,0,1,0,0,0,0,1,0,1],[1,0,0,0,0,0,1,0,0,1,1,0,1,0,1,1,1,0,1,1,1,0,0,0,1],[1,1,1,1,1,1,1,0,1,0,0,1,0,0,1,1,1,0,1,0,0,1,0,0,1]];

const TAU = Math.PI * 2;
const qrCanvas = $("qr");
const qrCtx = qrCanvas.getContext("2d");
const plate = document.querySelector(".listen");
const dots = [];

function inFinder(r, c, size) {
  return (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);
}

function rebuildDots() {
  dots.length = 0;
  const size = QR_MATRIX.length;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!QR_MATRIX[r][c] || inFinder(r, c, size)) continue;
      const dx = c - (size - 1) / 2;
      const dy = r - (size - 1) / 2;
      dots.push({
        r: r,
        c: c,
        dist: Math.hypot(dx, dy),
        phase: Math.hypot(dx, dy) * 0.42 + (r * 12.9898 + c * 78.233) % 1
      });
    }
  }
}

rebuildDots();

function sizeCanvas(canvas, ctx, width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(width * dpr));
  const h = Math.max(1, Math.floor(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function placeRipples() {
  const stage = document.querySelector(".stage");
  if (!stage || !plate) return;
  const stageBox = stage.getBoundingClientRect();
  const qrBox = plate.getBoundingClientRect();
  const top = ((qrBox.top + qrBox.height / 2 - stageBox.top) / stageBox.height) * 100;
  stage.style.setProperty("--qr-top", top + "%");
}

function resizeField() {
  const qrBox = qrCanvas.getBoundingClientRect();
  sizeCanvas(qrCanvas, qrCtx, qrBox.width, qrBox.height);
  placeRipples();
}

window.addEventListener("resize", resizeField);
window.addEventListener("load", resizeField);
requestAnimationFrame(resizeField);
resizeField();

function rounded(ctx, x, y, s, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, s, s, radius);
}

function paintQr(t) {
  const box = qrCanvas.getBoundingClientRect();
  const size = box.width;
  if (size < 8) return;
  const n = QR_MATRIX.length;
  const quiet = 1.15;
  const cell = size / (n + quiet * 2);
  const origin = quiet * cell;
  const mid = (n - 1) / 2;
  qrCtx.clearRect(0, 0, size, size);

  dots.forEach(function (dot) {
    const wave = 0.5 + 0.5 * Math.sin(t * 1.35 - dot.dist * 0.55 + dot.phase);
    const radius = cell * (0.3 + 0.1 * wave);
    qrCtx.beginPath();
    qrCtx.fillStyle = "rgba(31,111,235," + (0.78 + wave * 0.22).toFixed(3) + ")";
    qrCtx.arc(origin + (dot.c + 0.5) * cell, origin + (dot.r + 0.5) * cell, radius, 0, TAU);
    qrCtx.fill();
  });

  const pulse = 0.5 + 0.5 * Math.sin(t * 1.1);
  [[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (pos) {
    const x = origin + pos[0] * cell;
    const y = origin + pos[1] * cell;
    const outer = 7 * cell;
    qrCtx.fillStyle = "#1f6feb";
    rounded(qrCtx, x, y, outer, cell * 1.85);
    qrCtx.fill();
    qrCtx.fillStyle = "#fff";
    rounded(qrCtx, x + cell, y + cell, 5 * cell, cell * 1.35);
    qrCtx.fill();
    const inner = 3 * cell * (0.92 + pulse * 0.06);
    const inset = (outer - inner) / 2;
    qrCtx.fillStyle = "#1f6feb";
    rounded(qrCtx, x + inset, y + inset, inner, cell * 1.05);
    qrCtx.fill();
  });
}

function paintQrFrame(now) {
  requestAnimationFrame(paintQrFrame);
  paintQr(now / 1000);
}

requestAnimationFrame(paintQrFrame);

window.Links = {
  setMode: setMode,
  rebuildDots: rebuildDots,
  memory: memory,
  showPhone: showPhone,
  openPicker: openPicker,
  resetJoin: resetJoin,
  QR_MATRIX: QR_MATRIX,
  $: $
};
