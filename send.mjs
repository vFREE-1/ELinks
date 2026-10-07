import { isIosUa, isVideoFile, sliceBytes } from "./slice.mjs";
import { missingSlices, rangeBytes } from "./resume.mjs";

let active = {
  cancelled: false,
  xhrs: []
};

export function cancelSend() {
  active.cancelled = true;
  active.xhrs.splice(0).forEach(function (xhr) {
    try { xhr.abort(); } catch (err) { /* ignore */ }
  });
}

function putSlice(item, start, end, session, onProgress) {
  return new Promise(function (resolve, reject) {
    if (active.cancelled) {
      reject(new Error("cancelled"));
      return;
    }
    const blob = item.file.slice(start, end);
    const query = new URLSearchParams({
      session: session,
      name: item.name,
      size: String(item.size),
      offset: String(start)
    });
    const xhr = new XMLHttpRequest();
    active.xhrs.push(xhr);
    xhr.open("PUT", "/api/upload?" + query.toString());
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = function (ev) {
      if (ev.lengthComputable && onProgress) onProgress(ev.loaded);
    };
    xhr.onload = function () {
      const idx = active.xhrs.indexOf(xhr);
      if (idx >= 0) active.xhrs.splice(idx, 1);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("upload " + xhr.status));
    };
    xhr.onerror = function () {
      const idx = active.xhrs.indexOf(xhr);
      if (idx >= 0) active.xhrs.splice(idx, 1);
      reject(new Error(active.cancelled ? "cancelled" : "network"));
    };
    xhr.onabort = function () {
      const idx = active.xhrs.indexOf(xhr);
      if (idx >= 0) active.xhrs.splice(idx, 1);
      reject(new Error("cancelled"));
    };
    xhr.send(blob);
  });
}

function takeJob(items) {
  const activeVideo = items.find(function (item) {
    return isVideoFile(item.name, item.file.type) && item.slices && item.slices.length && item.sent > 0 && !item.done;
  });
  const order = activeVideo ? [activeVideo] : items;
  for (let i = 0; i < order.length; i++) {
    const item = order[i];
    if (item.done || item.error) continue;
    if (item.size <= 0) {
      item.error = "empty";
      item.done = true;
      continue;
    }
    if (!item.slices || !item.slices.length) {
      item.done = true;
      continue;
    }
    const pair = item.slices.shift();
    return { item: item, start: pair[0], end: pair[1] };
  }
  return null;
}

async function loadResume(item, session) {
  const query = new URLSearchParams({
    session: session,
    name: item.name,
    size: String(item.size)
  });
  try {
    const data = await fetch("/api/resume?" + query.toString()).then(function (res) { return res.json(); });
    item.ranges = data && data.ranges ? data.ranges : [];
  } catch (err) {
    item.ranges = [];
  }
  item.sent = rangeBytes(item.ranges);
  item.slices = missingSlices(item.size, item.ranges, item.chunk);
  if (!item.slices.length) {
    item.done = true;
    item.sent = item.size;
  }
}

export async function sendFiles(files, opts) {
  const session = opts.session;
  const lanes = Math.max(1, Number(opts.lanes) || 4);
  const ios = isIosUa(typeof navigator !== "undefined" ? navigator.userAgent : "", typeof document !== "undefined" && "ontouchend" in document);
  active = { cancelled: false, xhrs: [] };
  const items = Array.prototype.map.call(files, function (file, index) {
    const name = file.name || ("file-" + (index + 1));
    return {
      file: file,
      name: name,
      size: Number(file.size) || 0,
      chunk: sliceBytes(file.size, ios),
      sent: 0,
      ranges: [],
      slices: [],
      done: false,
      error: ""
    };
  });
  for (let i = 0; i < items.length; i++) {
    if (active.cancelled) break;
    await loadResume(items[i], session);
  }

  function report() {
    if (opts.onProgress) opts.onProgress(items);
  }

  return new Promise(function (resolve) {
    let inflight = 0;
    let settled = false;

    function finish() {
      if (settled) return;
      if (inflight > 0) return;
      if (!items.every(function (item) { return item.done || item.error; })) return;
      settled = true;
      report();
      resolve(items);
    }

    function pump() {
      if (active.cancelled) {
        items.forEach(function (item) {
          if (!item.done && !item.error) {
            item.error = "cancelled";
            item.done = true;
          }
        });
        finish();
        return;
      }
      while (inflight < lanes) {
        const job = takeJob(items);
        if (!job) break;
        inflight += 1;
        putSlice(job.item, job.start, job.end, session, function (loaded) {
          const sent = rangeBytes(job.item.ranges) + loaded;
          if (sent > job.item.sent) job.item.sent = Math.min(job.item.size, sent);
          report();
        }).then(function () {
          job.item.ranges = (job.item.ranges || []).concat([[job.start, job.end]]);
          job.item.sent = Math.max(job.item.sent, rangeBytes(job.item.ranges));
          if (!job.item.slices.length) job.item.done = true;
          inflight -= 1;
          pump();
          finish();
        }).catch(function (err) {
          const msg = String(err && err.message ? err.message : err);
          if (msg === "cancelled" || active.cancelled) {
            job.item.error = "cancelled";
          } else {
            job.item.error = msg;
          }
          job.item.done = true;
          inflight -= 1;
          pump();
          finish();
        });
      }
      report();
      finish();
    }

    report();
    pump();
  });
}
