export function isIosUa(ua, touch) {
  const text = String(ua || "");
  if (/iP(hone|od|ad)/i.test(text)) return true;
  if (/Macintosh/i.test(text) && (touch === true || /Mobile/i.test(text))) return true;
  return false;
}

export function sliceBytes(size, ios) {
  const n = Number(size);
  const cap = ios ? 512 * 1024 : 1024 * 1024;
  if (!Number.isFinite(n) || n <= 0) return cap;
  return Math.min(cap, Math.max(1, Math.floor(n)));
}

export function isVideoFile(name, type) {
  if (/^video\//i.test(String(type || ""))) return true;
  return /\.(mov|mp4|m4v|webm|mkv)$/i.test(String(name || ""));
}
