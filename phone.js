import { cancelSend, sendFiles } from "./send.mjs";
import { shouldSwitchToUsb } from "./usb-path.mjs";

function $(id) {
  return document.getElementById(id);
}

function get(name) {
  return new URLSearchParams(location.search).get(name);
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + " GB";
  if (bytes >= 1024 ** 2) return Math.max(1, Math.round(bytes / 1024 ** 2)) + " MB";
  return bytes + " B";
}

let info = null;
let sessionId = "";
let lanes = 4;
let sending = false;
let paintTimer = 0;

function inWeChat() {
  return /MicroMessenger/i.test(navigator.userAgent || "");
}

function inAndroid() {
  return /Android/i.test(navigator.userAgent || "");
}

function pickHint() {
  const limited = inWeChat() || inAndroid();
  if ($("wechat-hint")) $("wechat-hint").hidden = !limited;
  if (limited) {
    return "系统相册一次大约最多 100 张，不是上传限制。选完会马上开始传，更多请再选一些。";
  }
  return "选好就传到这台电脑，不用再改地址。";
}

function takeInputFiles(input) {
  const files = Array.prototype.slice.call((input && input.files) || []);
  if (input) input.value = "";
  return files;
}

function setStatus(text) {
  $("phone-status").textContent = text;
}

async function pair(fromForm) {
  const payload = { token: info.token };
  const fromQuery = get("p");
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
    $("join-pass").hidden = false;
    $("pick").hidden = true;
    $("join-password").focus();
    setStatus("这台电脑设了接收密码。");
    return false;
  }
  if (!data.ok) {
    $("join-pass").hidden = false;
    $("pick").hidden = true;
    $("password-error").hidden = false;
    return false;
  }
  sessionId = data.session;
  $("join-pass").hidden = true;
  $("pick").hidden = false;
  setStatus(pickHint());
  return true;
}

function paint(items) {
  const box = $("send-list");
  if (!box) return;
  let sent = 0;
  let total = 0;
  let live = 0;
  let done = 0;
  items.forEach(function (item, index) {
    sent += item.sent || 0;
    total += item.size || 0;
    if (item.done && !item.error) done += 1;
    else if (!item.done) live += 1;
    let row = box.children[index];
    if (!row) {
      row = document.createElement("article");
      row.className = "phone-row";
      row.innerHTML = "<b></b><span></span><div class=\"line\"><i></i></div>";
      box.appendChild(row);
    }
    const ratio = item.size ? item.sent / item.size : 0;
    row.querySelector("b").textContent = item.name;
    row.querySelector("span").textContent = item.error === "cancelled"
      ? "已停止"
      : (item.error
        ? "没传上，请再选一次"
        : (item.done ? "已传到电脑" : formatSize(item.sent || 0) + " / " + formatSize(item.size || 0)));
    row.querySelector("i").style.width = (Math.min(1, ratio) * 100).toFixed(1) + "%";
  });
  while (box.children.length > items.length) box.removeChild(box.lastChild);
  const pct = total ? Math.round((sent / total) * 100) : 0;
  if ($("send-pct")) $("send-pct").textContent = pct + "%";
  if ($("send-fill")) $("send-fill").style.width = Math.min(100, pct) + "%";
  if ($("send-count")) {
    $("send-count").textContent = done + " / " + items.length + " · " + formatSize(sent) + " / " + formatSize(total);
  }
  if ($("send-lead")) $("send-lead").textContent = live ? "正在上传" : "已经传到电脑";
}

function queueFiles(list) {
  const raw = Array.prototype.slice.call(list || []);
  const files = raw.filter(function (file) {
    return file && Number(file.size) > 0;
  });
  if (!sessionId) {
    setStatus("还没连上电脑，请重新扫码。");
    return;
  }
  if (!raw.length) {
    setStatus("没有选到文件，请再选一次。");
    return;
  }
  if (!files.length) {
    setStatus("还没读到这些照片，请再选一次，或等云端下完。");
    return;
  }
  if (sending) {
    setStatus("这一批还在传，传完再选。");
    return;
  }
  sending = true;
  $("pick").hidden = true;
  $("send").hidden = false;
  if ($("send-stop")) $("send-stop").hidden = false;
  setStatus("已选 " + files.length + " 个，开始传。");
  paint(files.map(function (file, index) {
    return {
      name: file.name || ("file-" + (index + 1)),
      size: Number(file.size) || 0,
      sent: 0,
      done: false,
      error: ""
    };
  }));
  sendFiles(files, {
    session: sessionId,
    lanes: lanes,
    onProgress: function (items) {
      if (paintTimer) return;
      paintTimer = requestAnimationFrame(function () {
        paintTimer = 0;
        paint(items);
      });
    }
  }).then(function (items) {
    sending = false;
    if ($("send-stop")) $("send-stop").hidden = true;
    paint(items);
    const stopped = items.some(function (item) { return item.error === "cancelled"; });
    const failed = items.some(function (item) { return item.error && item.error !== "cancelled"; });
    setStatus(stopped ? "已经停止。可以再选一次。" : (failed ? "有的没传上，可以再选一次。" : "可以继续选。"));
    watchPath();
  }).catch(function () {
    sending = false;
    if ($("send-stop")) $("send-stop").hidden = true;
    setStatus("这次没传上，请再选一次。");
    watchPath();
  });
}

function stopSend() {
  cancelSend();
  if (!sessionId) return;
  fetch("/api/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: sessionId })
  }).catch(function () {});
}

function followUsb(data) {
  if (sending) return false;
  if (!shouldSwitchToUsb(location.hostname, data)) return false;
  if (!data.phoneUrl) return false;
  setStatus("改走数据线传。");
  location.replace(data.phoneUrl);
  return true;
}

async function watchPath() {
  try {
    const data = await fetch("/api/info").then(function (res) { return res.json(); });
    info = data;
    if (data.lanes) lanes = data.lanes;
    followUsb(data);
  } catch (err) {
    /* keep current path */
  }
}

$("join-pass").addEventListener("submit", function (event) {
  event.preventDefault();
  pair(true);
});

$("file-input").addEventListener("change", function () {
  queueFiles(takeInputFiles($("file-input")));
});

$("file-more").addEventListener("change", function () {
  queueFiles(takeInputFiles($("file-more")));
});

if ($("send-stop")) {
  $("send-stop").addEventListener("click", function () {
    stopSend();
  });
}

window.addEventListener("pagehide", function () {
  if (sending) stopSend();
});

async function boot() {
  const token = get("t") || "";
  if (get("p")) $("join-password").value = get("p");
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 2500) : 0;
  try {
    info = await fetch("/api/info", ctrl ? { signal: ctrl.signal } : undefined).then(function (res) { return res.json(); });
  } catch (err) {
    info = { token: token, lanes: 4 };
  }
  if (timer) clearTimeout(timer);
  lanes = info.lanes || 4;
  if (token) info.token = token;
  if (followUsb(info)) return;
  if (!info.token) {
    $("pick").hidden = true;
    setStatus("请用电脑上的码扫进来。");
    return;
  }
  await pair(Boolean(get("p")));
  setInterval(watchPath, 2000);
}

boot().catch(function () {
  setStatus("连不上这台电脑，请回到电脑重新扫码。");
  $("pick").hidden = true;
});
