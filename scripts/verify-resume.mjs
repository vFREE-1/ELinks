import { covered, mergeRanges, missingSlices, rangeBytes } from "../resume.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

assert(JSON.stringify(mergeRanges([[0, 4], [4, 8], [10, 12]])) === JSON.stringify([[0, 8], [10, 12]]), "merge adjacent");
assert(rangeBytes([[0, 4], [4, 8]]) === 8, "bytes after merge");
assert(covered([[0, 8]], 0, 4) === true, "covered prefix");
assert(covered([[0, 4]], 0, 8) === false, "partial is not covered");
assert(JSON.stringify(missingSlices(12, [[0, 4]], 4)) === JSON.stringify([[4, 8], [8, 12]]), "resume skips done slices");
assert(missingSlices(8, [[0, 8]], 4).length === 0, "complete file has no missing slices");

console.log("RESUME_OK");
