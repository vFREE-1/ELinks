import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export const HTTPS_PORT = 8731;

export function ensureTls(dataDir, hosts) {
  const dir = path.join(dataDir, "tls");
  const pfxFile = path.join(dir, "cert.pfx");
  if (fs.existsSync(pfxFile)) {
    return {
      pfx: fs.readFileSync(pfxFile),
      passphrase: "elinks-tls"
    };
  }
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(ROOT, "scripts", "make-tls.ps1");
  const names = ["localhost", "127.0.0.1"].concat(hosts || []).filter(Boolean);
  const unique = [];
  names.forEach((name) => {
    if (!unique.includes(name)) unique.push(name);
  });
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-OutDir",
    dir,
    "-Dns",
    unique.join(",")
  ], { timeout: 20000, windowsHide: true, encoding: "utf8" });
  if (!fs.existsSync(pfxFile)) {
    throw new Error("tls files missing");
  }
  return {
    pfx: fs.readFileSync(pfxFile),
    passphrase: "elinks-tls"
  };
}
