import {
  APP_VERSION,
  UPDATE_SOURCES,
  cmpVersion,
  normalizeRelease,
  checkUpdate
} from "../update.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

assert(typeof APP_VERSION === "string" && APP_VERSION.length > 0, "app version");
assert(UPDATE_SOURCES.length === 2, "github then gitee only");
assert(UPDATE_SOURCES[0].id === "github" && UPDATE_SOURCES[0].url.includes("vFREE-1/ELinks"), "github repo");
assert(UPDATE_SOURCES[1].id === "gitee" && UPDATE_SOURCES[1].url.includes("WHOAME/ELinks"), "gitee repo");
assert(!UPDATE_SOURCES.some(function (src) { return src.id === "gitcode" || /gitcode/i.test(src.url); }), "no gitcode");

assert(cmpVersion("0.2.0", "0.1.0") > 0, "newer minor");
assert(cmpVersion("v1.0.0", "0.9.9") > 0, "v prefix");
assert(cmpVersion("0.1.0", "0.1.0") === 0, "same");
assert(cmpVersion("0.1.0", "0.2.0") < 0, "older");

const github = normalizeRelease("github", {
  tag_name: "v0.2.0",
  name: "sky",
  body: "rings",
  html_url: "https://github.com/vFREE-1/ELinks/releases/tag/v0.2.0",
  draft: false,
  prerelease: false
});
assert(github && github.version === "0.2.0", "github tag");
assert(github.page.includes("vFREE-1/ELinks"), "github page");
assert(!normalizeRelease("github", { tag_name: "v9.0.0", draft: true }), "skip draft");

const gitee = normalizeRelease("gitee", {
  tag_name: "0.3.0",
  name: "gitee",
  body: "cn",
  html_url: "https://gitee.com/WHOAME/ELinks/releases/0.3.0"
});
assert(gitee && gitee.version === "0.3.0", "gitee tag");
assert(gitee.page.includes("WHOAME/ELinks"), "gitee page");

const local = await checkUpdate({ local: true });
assert(local.ok && local.current === APP_VERSION && local.source === "local", "local probe");
assert(local.newer === false, "local is current");

console.log("UPDATE_OK current=" + APP_VERSION);
