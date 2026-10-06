import {
  authType,
  currentLink,
  escapeWifi,
  isLoopbackAddress,
  parseInterface,
  parseProfile,
  wifiPayload,
  wifiQrText
} from "../wifi.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

assert(escapeWifi('a;b,c:d\\e"f') === 'a\\;b\\,c\\:d\\\\e\\"f', "escape");
assert(
  wifiPayload("客厅", "p:a", "WPA") === "WIFI:T:WPA;S:客厅;P:p\\:a;H:false;;",
  "wpa payload"
);
assert(wifiPayload("open", "", "nopass") === "WIFI:T:nopass;S:open;P:;H:false;;", "open payload");
assert(authType("WPA2-Personal") === "WPA", "wpa2");
assert(authType("WPA3 - 个人") === "WPA", "wpa3");
assert(authType("Open") === "nopass", "open");
assert(authType("开放") === "nopass", "open zh");
assert(authType("WEP") === "WEP", "wep");

const english = `
    Name                   : WLAN
    State                  : connected
    SSID                   : Home
    AP BSSID               : 14:4d:67:79:f8:30
    Authentication         : WPA2-Personal
    Profile                : Home
`;
const iface = parseInterface(english);
assert(iface && iface.ssid === "Home" && iface.profile === "Home", "english interface");
assert(parseInterface(english.replace("connected", "disconnected")) === null, "disconnected");

const chinese = `
    名称                   : WLAN
    状态                   : 已连接
    SSID                   : 测试网络
    身份验证               : WPA2-个人
    配置文件               : 测试网络
`;
const zh = parseInterface(chinese);
assert(zh && zh.ssid === "测试网络" && zh.profile === "测试网络", "chinese interface");

assert(parseProfile("    Key Content            : secret\n").key === "secret", "key en");
assert(parseProfile("    关键内容            : secret\n    安全密钥               : 存在\n").secured === true, "key zh");
assert(parseProfile("    Security key           : Absent\n").secured === false, "absent");
assert(parseProfile("    安全密钥               : 不存在\n").secured === false, "absent zh");

assert(isLoopbackAddress("127.0.0.1"), "v4");
assert(isLoopbackAddress("::1"), "v6");
assert(isLoopbackAddress("::ffff:127.0.0.1"), "mapped");
assert(!isLoopbackAddress("192.168.1.8"), "lan");
assert(!isLoopbackAddress("127.0.0.10"), "not loopback");

const link = await currentLink();
assert(typeof link.ssid === "string", "ssid type");
assert(typeof link.wifiJoin === "boolean", "wifiJoin type");
if (link.wifiJoin) {
  const text = wifiQrText();
  assert(/^WIFI:T:(WPA|WEP|nopass);S:/.test(text), "live payload shape");
  assert(!/[\r\n]/.test(text), "live payload broken");
  assert(text.includes(link.ssid) || text.includes(escapeWifi(link.ssid)), "live payload names the network");
}

console.log("WIFI_OK join=" + link.wifiJoin);
