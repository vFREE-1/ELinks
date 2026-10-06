import { lanesForLink } from "../lanes.mjs";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

assert(lanesForLink(0) === 4, "unknown link stays at a modest default");
assert(lanesForLink(-1) === 4, "bad link stays at a modest default");
assert(lanesForLink(8) === 2, "slow wifi uses two lanes");
assert(lanesForLink(20) === 4, "100–200 Mbps uses four");
assert(lanesForLink(38) === 6, "300 Mbps wifi uses six");
assert(lanesForLink(125) === 8, "gigabit uses eight");
assert(lanesForLink(250) === 10, "2.5G uses ten");
assert(lanesForLink(400) === 12, "faster links cap at twelve");
assert(lanesForLink("38") === 6, "numeric strings count");

console.log("LANES_OK");
