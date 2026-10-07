export function shouldSwitchToUsb(currentHost, info) {
  const usbHost = String((info && info.usbHost) || "").split(":")[0].trim();
  if (!usbHost) return false;
  const now = String(currentHost || "")
    .replace(/^\[|\]$/g, "")
    .split("%")[0]
    .split(":")[0]
    .trim();
  if (!now || now === "127.0.0.1" || now === "localhost" || now === "::1") return false;
  return now !== usbHost;
}
