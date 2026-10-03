import test from "node:test";
import assert from "node:assert/strict";
import { formatColo, formatEdgeNodeName } from "../src/utils/colo.js";

test("format COLO as Chinese location with flag", () => {
  assert.equal(formatColo("LAX"), "🇺🇸 美国洛杉矶 LAX");
  assert.equal(formatColo("hkg"), "🇭🇰 香港 HKG");
  assert.equal(formatColo("XXX"), "🌐 XXX");
});

test("format edge node name uses Chinese COLO label", () => {
  assert.equal(formatEdgeNodeName({ colo: "SJC", latency: 34 }, 1), "🇺🇸 美国圣何塞 SJC 34ms #2");
  assert.equal(formatEdgeNodeName({ name: "已有名称", colo: "SJC", latency: 34 }, 1), "已有名称");
  assert.equal(formatEdgeNodeName({ name: "CF Edge SJC 34ms #2", colo: "SJC", latency: 34 }, 1), "🇺🇸 美国圣何塞 SJC 34ms #2");
});

test("format edge node name prefers locally measured colo and rtt", () => {
  assert.equal(
    formatEdgeNodeName({ name: "优选-3", colo: "LAX", latency: 40, userColo: "HKG", userRtt: 21.4 }, 0),
    "🇭🇰 香港 HKG 21ms 实测 #1",
  );
  assert.equal(
    formatEdgeNodeName({ colo: "LAX", latency: 40, userRtt: 0 }, 2),
    "🇺🇸 美国洛杉矶 LAX 0ms 实测 #3",
  );
  assert.equal(
    formatEdgeNodeName({ name: "优选-4", colo: "LAX", latency: null, userRtt: null }, 3),
    "优选-4",
  );
});
