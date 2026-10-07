export function mergeRanges(ranges) {
  const list = (ranges || [])
    .map((pair) => [Number(pair && pair[0]), Number(pair && pair[1])])
    .filter((pair) => Number.isFinite(pair[0]) && Number.isFinite(pair[1]) && pair[1] > pair[0])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i][0];
    const b = list[i][1];
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function rangeBytes(ranges) {
  return mergeRanges(ranges).reduce((sum, pair) => sum + (pair[1] - pair[0]), 0);
}

export function covered(ranges, start, end) {
  const a = Number(start);
  const b = Number(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return true;
  const merged = mergeRanges(ranges);
  for (let i = 0; i < merged.length; i++) {
    if (merged[i][0] <= a && merged[i][1] >= b) return true;
  }
  return false;
}

export function missingSlices(size, ranges, chunk) {
  const n = Number(size) || 0;
  const step = Math.max(1, Number(chunk) || 1024 * 1024);
  const merged = mergeRanges(ranges);
  const slices = [];
  let pos = 0;
  while (pos < n) {
    const end = Math.min(n, pos + step);
    if (!covered(merged, pos, end)) slices.push([pos, end]);
    pos = end;
  }
  return slices;
}
