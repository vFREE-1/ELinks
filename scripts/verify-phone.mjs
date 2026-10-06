import { isIosUa, isVideoFile, sliceBytes } from "../slice.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

assert(isIosUa("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)") === true, "iphone ua");
assert(isIosUa("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)") === true, "ipad ua");
assert(isIosUa("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", true) === true, "ipados desktop ua with touch");
assert(isIosUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64)") === false, "windows is not ios");
assert(sliceBytes(80 * 1024 * 1024, true) === 512 * 1024, "iphone uses half-meg slices so the first bytes leave sooner");
assert(sliceBytes(80 * 1024 * 1024, false) === 1024 * 1024, "other phones use 1 MB slices");
assert(sliceBytes(100, true) === 100, "tiny files stay one shot");
assert(isVideoFile("IMG_0098.MOV", "") === true, "mov is video");
assert(isVideoFile("IMG_0098.HEIC", "image/heic") === false, "heic is not video");

console.log("PHONE_OK");
