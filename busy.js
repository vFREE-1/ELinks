const linkMbps = 940;

const files = [
  { name: "海岸延时.mov", kind: "video", bytes: 4.8 * 1024 ** 3, done: 0.18, weight: 1.2, lanes: 8 },
  { name: "晚会舞台.mp4", kind: "video", bytes: 2.2 * 1024 ** 3, done: 0.34, weight: 0.95, lanes: 8 },
  { name: "门口夜景.mov", kind: "video", bytes: 1.6 * 1024 ** 3, done: 0.22, weight: 0.72, lanes: 8 },
  { name: "IMG_8831.HEIC", kind: "photo", bytes: 42 * 1024 ** 2, done: 0.48, weight: 0.12 },
  { name: "IMG_8832.HEIC", kind: "photo", bytes: 28 * 1024 ** 2, done: 0.41, weight: 0.1 },
  { name: "IMG_8833.HEIC", kind: "photo", bytes: 22 * 1024 ** 2, done: 0.36, weight: 0.09 },
  { name: "IMG_8834.HEIC", kind: "photo", bytes: 31 * 1024 ** 2, done: 0.44, weight: 0.11 },
  { name: "IMG_8835.HEIC", kind: "photo", bytes: 19 * 1024 ** 2, done: 0.39, weight: 0.08 },
  { name: "IMG_8836.HEIC", kind: "photo", bytes: 26 * 1024 ** 2, done: 0.33, weight: 0.09 },
  { name: "DSC_4410.JPG", kind: "photo", bytes: 9 * 1024 ** 2, done: 0.52, weight: 0.07 }
];

const icon = {
  video: '<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="3" width="14" height="10" rx="1.4" fill="none" stroke="#1f6feb" stroke-width="1.2"/><path d="M6.2 5.6v4.8L11 8z" fill="#1f6feb"/></svg>',
  photo: '<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.4" fill="none" stroke="#1f6feb" stroke-width="1.2"/><circle cx="5.5" cy="6" r="1.1" fill="#1f6feb"/><path d="M2.5 11.2l3.2-2.6 2.2 1.6 1.6-1.2 3.8 2.6" fill="none" stroke="#1f6feb" stroke-width="1.1"/></svg>'
};

const list = document.getElementById("live-list");
const doneList = document.getElementById("done-list");
let last = performance.now();
let finished = 3;
let finishedBytes = 1.11 * 1024 ** 3;

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(2) + " GB";
  return Math.max(1, Math.round(bytes / 1024 ** 2)) + " MB";
}

function formatEta(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return "剩余 " + r + " 秒";
  return "剩余 " + m + " 分 " + String(r).padStart(2, "0") + " 秒";
}

function kindLabel(file) {
  if (file.kind === "video") return "视频 · " + file.lanes + " 路";
  return "照片";
}

files.forEach(function (file, index) {
  const row = document.createElement("article");
  row.className = "row";
  row.id = "file-" + index;
  row.innerHTML = icon[file.kind] +
    '<div class="name"><b></b><small></small></div>' +
    '<div class="speed"><b></b><small></small></div>' +
    '<div class="line"><i></i></div>';
  row.querySelector("b").textContent = file.name;
  list.appendChild(row);
  file.el = row;
});

function complete(file) {
  const elapsed = Math.max(1, Math.round(file.bytes / ((file.mbps / 8) * 1024 * 1024)));
  const row = document.createElement("div");
  row.className = "done-row";
  row.innerHTML = "<b></b><span></span><span></span><span></span>";
  row.querySelector("b").textContent = file.name;
  row.children[1].textContent = formatSize(file.bytes);
  row.children[2].textContent = elapsed + " 秒";
  row.children[3].textContent = (file.mbps / 8).toFixed(0) + " MB/s";
  doneList.prepend(row);
  file.el.remove();
  finished += 1;
  finishedBytes += file.bytes;
  document.getElementById("today").textContent =
    "今天已接收 " + finished + " 个文件 · " + formatSize(finishedBytes);
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const live = files.filter(function (file) { return file.done < 1; });
  document.getElementById("active-count").textContent = live.length + " 个文件并行";
  document.getElementById("lane-count").textContent =
    (live.filter(function (file) { return file.kind === "video"; }).length * 8 +
      live.filter(function (file) { return file.kind === "photo"; }).length) + " 路 · 不切片";

  if (!live.length) {
    document.getElementById("mbps").textContent = "0";
    document.getElementById("mbs").textContent = "0 MB/s";
    document.getElementById("util").textContent = "0%";
    document.getElementById("meter-fill").style.width = "0%";
    return;
  }

  const weightSum = live.reduce(function (sum, file) { return sum + file.weight; }, 0);
  const cap = linkMbps * (0.985 + Math.sin(now / 700) * 0.012);
  live.forEach(function (file) {
    const jitter = 0.96 + Math.sin(now / 260 + file.weight * 6) * 0.04;
    file.mbps = cap * (file.weight / weightSum) * jitter;
  });
  const total = live.reduce(function (sum, file) { return sum + file.mbps; }, 0);
  const scale = cap / total;
  let used = 0;

  live.forEach(function (file) {
    file.mbps *= scale;
    file.done += ((file.mbps / 8) * 1024 * 1024 * dt) / file.bytes;
    if (file.done >= 1) {
      file.done = 1;
      complete(file);
      return;
    }
    used += file.mbps;
    const ratio = file.done;
    const left = file.bytes * (1 - ratio);
    const bytesPerSec = (file.mbps / 8) * 1024 * 1024;
    file.el.querySelector(".name small").textContent =
      kindLabel(file) + " · " + formatSize(file.bytes * ratio) + " / " + formatSize(file.bytes);
    file.el.querySelector(".speed b").textContent = (file.mbps / 8).toFixed(1) + " MB/s";
    file.el.querySelector(".speed small").textContent = formatEta(left / bytesPerSec);
    file.el.querySelector(".line i").style.width = (ratio * 100).toFixed(1) + "%";
  });

  document.getElementById("mbps").textContent = Math.round(used).toString();
  document.getElementById("mbs").textContent = (used / 8).toFixed(0) + " MB/s";
  document.getElementById("util").textContent = Math.round((used / linkMbps) * 100) + "%";
  document.getElementById("meter-fill").style.width = ((used / linkMbps) * 100).toFixed(1) + "%";
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
