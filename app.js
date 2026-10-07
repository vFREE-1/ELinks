function $(id) {
  return document.getElementById("" + id);
}

function setMode(busy) {
  document.documentElement.classList.toggle("is-busy", busy);
  if (busy) document.documentElement.classList.remove("is-phone");
  $("mode").textContent = busy ? "返回接收" : "查看接收";
  $("mode").classList.toggle("nav-back", busy);
  $("mode").title = busy ? "点这里返回接收页" : "";
}

$("mode").addEventListener("click", function () {
  setMode(!document.documentElement.classList.contains("is-busy"));
});

const memory = {
  path: localStorage.getItem("links.path") || "",
  password: localStorage.getItem("links.password") || "",
  host: localStorage.getItem("links.host") || "192.168.1.24:8730"
};

if (memory.path) {
  $("save-path").value = memory.path;
  $("save-path-bar").value = memory.path;
}
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
  $("mode").classList.remove("nav-back");
  $("mode").title = "";
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
  /* Phone uploads stay on phone.html from the QR. The desktop window is not a phone page. */
}

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
  const layer = document.querySelector(".ripples");
  const app = document.querySelector(".app");
  const sendField = document.getElementById("universe");
  const origin = document.documentElement.classList.contains("is-send") && sendField ? sendField : plate;
  if (!layer || !app || !origin) return;
  const qrBox = origin.getBoundingClientRect();
  const appBox = app.getBoundingClientRect();
  if (qrBox.width < 8 || appBox.width < 8) return;
  const cx = qrBox.left + qrBox.width / 2 - appBox.left;
  const cy = qrBox.top + qrBox.height / 2 - appBox.top;
  const reach = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(appBox.width - cx, cy),
    Math.hypot(cx, appBox.height - cy),
    Math.hypot(appBox.width - cx, appBox.height - cy)
  );
  const scale = Math.max(4, (reach * 2.08) / qrBox.width);
  layer.style.setProperty("--qr-size", Math.round(qrBox.width) + "px");
  layer.style.setProperty("--qr-x", Math.round(cx) + "px");
  layer.style.setProperty("--qr-y", Math.round(cy) + "px");
  layer.style.setProperty("--ring-scale", scale.toFixed(3));
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
