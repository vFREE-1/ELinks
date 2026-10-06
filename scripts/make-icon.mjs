import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { PNG } = createRequire(import.meta.url)("pngjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "icon.png");
const SIZE = 256;
const BLUE = [31, 111, 235];

function sdBox(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r);
  const dy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function cover(dist) {
  return Math.max(0, Math.min(1, 0.5 - dist));
}

if (path.basename(ROOT) !== "links") throw new Error("unexpected repo");
if (!OUT.toLowerCase().startsWith(ROOT.toLowerCase())) throw new Error("refusing path outside repo");

const png = new PNG({ width: SIZE, height: SIZE });
const view = 32;
const pad = 52;
const scale = (SIZE - pad * 2) / view;
const stroke = 2.15 * scale;
const sqCx = pad + 11.7 * scale;
const sqH = 8.1 * scale;
const sqR = 4.2 * scale;
const cirCx = pad + 21.15 * scale;
const cirR = 7.25 * scale;
const tileR = 56;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const px = x + 0.5;
    const py = y + 0.5;
    const tile = cover(sdBox(px, py, 128, 128, 112, 112, tileR));
    const square = cover(Math.abs(sdBox(px, py, sqCx, sqCx, sqH, sqH, sqR)) - stroke / 2);
    const circle = cover(Math.abs(sdCircle(px, py, cirCx, cirCx, cirR)) - stroke / 2);
    const mark = Math.max(square, circle);
    const i = (SIZE * y + x) << 2;
    png.data[i] = Math.round(BLUE[0] + (255 - BLUE[0]) * mark);
    png.data[i + 1] = Math.round(BLUE[1] + (255 - BLUE[1]) * mark);
    png.data[i + 2] = Math.round(BLUE[2] + (255 - BLUE[2]) * mark);
    png.data[i + 3] = Math.round(255 * tile);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, PNG.sync.write(png));
console.log("ICON_OK", OUT);
