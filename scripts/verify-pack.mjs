import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ROOT, appHome, scriptFile, unpackPath } from "../runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function insideRepo(target) {
  const full = path.resolve(target).toLowerCase();
  const prefix = ROOT.toLowerCase() + path.sep;
  return full === ROOT.toLowerCase() || full.startsWith(prefix);
}

if (path.basename(ROOT) !== "links") throw new Error("unexpected repo folder");
if (path.resolve(APP_ROOT) !== ROOT) throw new Error("app root must stay the repo in dev");
if (path.resolve(appHome()) !== ROOT) throw new Error("dev app home must stay the repo so verify keeps using received/");

for (const name of ["make-tls.ps1", "allow-lan.ps1", "allow-lan.cmd"]) {
  const file = scriptFile(name);
  if (!fs.existsSync(file)) throw new Error("missing runtime script " + name);
  if (!insideRepo(file)) throw new Error("runtime script left the repo: " + file);
}

const sample = ["C:", "Program Files", "Elinks", "resources", "app.asar", "scripts", "make-tls.ps1"].join(path.sep);
const unpacked = unpackPath(sample);
if (!unpacked.includes("app.asar.unpacked")) throw new Error("asar scripts must unpack beside the archive");
if (unpacked.includes(path.sep + "app.asar" + path.sep)) throw new Error("unpacked path still points into the archive");
if (unpackPath(path.join(ROOT, "scripts", "make-tls.ps1")) !== path.join(ROOT, "scripts", "make-tls.ps1")) {
  throw new Error("dev script paths must stay untouched");
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const win = pkg.build && pkg.build.win;
if (!win || !Array.isArray(win.target) || !win.target.includes("nsis")) throw new Error("package must build an NSIS installer");
if (pkg.build.productName !== "轻传File") throw new Error("installer product name must be 轻传File");
const unpack = JSON.stringify(pkg.build.asarUnpack || []);
if (!unpack.includes("make-tls.ps1") || !unpack.includes("allow-lan.cmd")) {
  throw new Error("firewall and tls scripts must be unpacked for PowerShell");
}
const files = JSON.stringify(pkg.build.files || []);
if (!files.includes("!received/**") || !files.includes("!data/**")) {
  throw new Error("installer must not ship received files or local config");
}

const pack = fs.readFileSync(path.join(ROOT, "scripts", "pack.ps1"), "utf8");
if (!pack.includes("ELECTRON_BUILDER_CACHE")) throw new Error("pack cache must stay in the repo");
if (!pack.includes("Refusing path outside repo")) throw new Error("pack must refuse paths outside the repo");
if (!pack.includes("轻传File-Setup-")) throw new Error("pack must look for the setup exe");
if (!pack.includes('{"type":"commonjs"}')) throw new Error("pack cache must stay CommonJS so the icon tool can run");

const tls = fs.readFileSync(path.join(ROOT, "scripts", "make-tls.ps1"), "utf8");
if (!tls.includes('GetFolderPath("MyDocuments")')) throw new Error("tls script must allow Documents\\Elinks");
if (!tls.includes("LOCALAPPDATA")) throw new Error("tls script must allow LocalAppData\\Elinks");

console.log("PACK_CONFIG_OK");
