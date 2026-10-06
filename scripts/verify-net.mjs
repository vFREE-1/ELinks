import { isUsbAddress, parseBlockRules, parseCategory, pickLanIp } from "../net.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const nics = [
  { name: "Tailscale", address: "100.64.1.8", family: "IPv4", internal: false },
  { name: "WLAN", address: "192.168.1.22", family: "IPv4", internal: false },
  { name: "Loopback", address: "127.0.0.1", family: "IPv4", internal: true }
];
assert(pickLanIp(nics) === "192.168.1.22", "prefer home lan over tailscale");

const usb = nics.concat([{ name: "以太网 12", address: "192.168.42.2", family: "IPv4", internal: false }]);
assert(pickLanIp(usb) === "192.168.42.2", "prefer android usb tethering");
assert(isUsbAddress("172.20.10.2", "iPhone") === true, "iphone usb");
assert(isUsbAddress("192.168.1.22", "WLAN") === false, "home wifi is not usb");
assert(pickLanIp([]) === "127.0.0.1", "empty");
assert(pickLanIp([{ name: "WLAN", address: "192.168.1.8", family: 4, internal: false }]) === "192.168.1.8", "numeric family");

assert(parseCategory("Name WLAN Public").publicNet === true, "public");
assert(parseCategory("Name Tailscale Public").publicNet === false, "ignore tailscale public");
assert(parseBlockRules("DisplayName Node.js JavaScript Runtime\nEnabled True\nAction Block") === true, "node block");
assert(parseBlockRules("DisplayName Edge\nEnabled True\nAction Block") === false, "other app");

console.log("NET_OK");
