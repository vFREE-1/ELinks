import { isIosUa, isVideoFile, sliceBytes } from "./slice.mjs";

function putSlice(item, start, end, session, onProgress) {
  return new Promise(function (resolve, reject) {
    const blob = item.file.slice(start, end);
    const query = new URLSearchParams({
      session: session,
      name: item.name,
      size: String(item.size),
      offset: String(start)
    });
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", "/api/upload?" + query.toString());
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = function (ev) {
      if (ev.lengthComputable && onProgress) onProgress(ev.loaded);
    };
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error("upload " + xhr.status));
    };
    xhr.onerror = function () { reject(new Error("network")); };
    xhr.send(blob);
  });
}

function takeJob(items) {
  const activeVideo = items.find(function (item) {
    return isVideoFile(item.name, item.file.type) && item.next > 0 && item.next < item.size;
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
    if (item.next >= item.size) continue;
    const start = item.next;
    const end = Math.min(item.size, start + item.chunk);
    item.next = end;
    return { item: item, start: start, end: end };
  }
  return null;
}

export function sendFiles(files, opts) {
  const session = opts.session;
  const lanes = Math.max(1, Number(opts.lanes) || 4);
  const ios = isIosUa(typeof navigator !== "undefined" ? navigator.userAgent : "", typeof document !== "undefined" && "ontouchend" in document);
  const items = Array.prototype.map.call(files, function (file, index) {
    const name = file.name || ("file-" + (index + 1));
    return {
      file: file,
      name: name,
      size: Number(file.size) || 0,
      chunk: sliceBytes(file.size, ios),
      sent: 0,
      next: 0,
      done: false,
      error: ""
    };
  });

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
      while (inflight < lanes) {
        const job = takeJob(items);
        if (!job) break;
        inflight += 1;
        putSlice(job.item, job.start, job.end, session, function (loaded) {
          const sent = job.start + loaded;
          if (sent > job.item.sent) job.item.sent = Math.min(job.item.size, sent);
          report();
        }).then(function () {
          job.item.sent = Math.max(job.item.sent, job.end);
          if (job.item.next >= job.item.size) job.item.done = true;
          inflight -= 1;
          pump();
          finish();
        }).catch(function (err) {
          job.item.error = String(err && err.message ? err.message : err);
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
