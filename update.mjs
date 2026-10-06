import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
export const APP_VERSION = String(pkg.version || "0.1.0");

export const UPDATE_SOURCES = [
  { id: "github", kind: "github", url: "https://api.github.com/repos/vFREE-1/ELinks/releases/latest" },
  { id: "gitee", kind: "gitee", url: "https://gitee.com/api/v5/repos/WHOAME/ELinks/releases/latest" }
];

export function parts(version) {
  return String(version || "")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map(function (bit) {
      const n = parseInt(bit, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

export function cmpVersion(a, b) {
  const left = parts(a);
  const right = parts(b);
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const d = (left[i] || 0) - (right[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function normalizeRelease(kind, raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.draft || raw.prerelease) return null;
  const version = String(raw.tag_name || raw.tag || raw.version || "").replace(/^v/i, "").trim();
  if (!version) return null;
  const page = String(raw.html_url || raw.url || raw.page || "").trim();
  return {
    version,
    title: String(raw.name || raw.title || version),
    notes: String(raw.body || raw.notes || "").trim(),
    page,
    source: kind
  };
}

async function fetchJson(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(function () { ac.abort(); }, timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Elinks/" + APP_VERSION
      }
    });
    if (!res.ok) throw new Error("status " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function checkUpdate(opts = {}) {
  const current = APP_VERSION;
  const timeoutMs = opts.timeoutMs || 2500;
  const sources = opts.sources || UPDATE_SOURCES;
  if (opts.local) {
    return { ok: true, current, newer: false, version: current, source: "local" };
  }
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    try {
      const raw = await fetchJson(src.url, timeoutMs);
      const latest = normalizeRelease(src.kind || src.id, raw);
      if (!latest) continue;
      return {
        ok: true,
        current,
        newer: cmpVersion(latest.version, current) > 0,
        version: latest.version,
        title: latest.title,
        notes: latest.notes,
        page: latest.page,
        source: src.id
      };
    } catch {
      continue;
    }
  }
  return { ok: true, current, newer: false, version: current, source: null };
}
