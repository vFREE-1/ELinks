import {
  APP_VERSION,
  cmpVersion,
  normalizeRelease,
  checkUpdate
} from "../update.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

assert(typeof APP_VERSION === "string" && APP_VERSION.length > 0, "app version");
assert(cmpVersion("0.2.0", "0.1.0") > 0, "newer minor");
assert(cmpVersion("v1.0.0", "0.9.9") > 0, "v prefix");
assert(cmpVersion("0.1.0", "0.1.0") === 0, "same");
assert(cmpVersion("0.1.0", "0.2.0") < 0, "older");

const github = normalizeRelease("github", {
  tag_name: "v0.2.0",
  name: "sky",
  body: "rings",
  html_url: "https://github.com/EndLessGo/elinks/releases/tag/v0.2.0",
  draft: false,
  prerelease: false
});
assert(github && github.version === "0.2.0", "github tag");
assert(github.page.includes("github.com"), "github page");
assert(!normalizeRelease("github", { tag_name: "v9.0.0", draft: true }), "skip draft");

const gitee = normalizeRelease("gitee", {
  tag_name: "0.3.0",
  name: "gitee",
  body: "cn",
  html_url: "https://gitee.com/EndLessGo/elinks/releases/0.3.0"
});
assert(gitee && gitee.version === "0.3.0", "gitee tag");

const generic = normalizeRelease("generic", {
  version: "0.4.0",
  notes: "gitcode",
  url: "https://gitcode.com/EndLessGo/elinks"
});
assert(generic && generic.source === "generic" && generic.page.includes("gitcode.com"), "generic");

const local = await checkUpdate({ local: true });
assert(local.ok && local.current === APP_VERSION && local.source === "local", "local probe");
assert(local.newer === false, "local is current");

console.log("UPDATE_OK current=" + APP_VERSION);
