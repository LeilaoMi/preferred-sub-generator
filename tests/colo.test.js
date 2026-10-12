import test from "node:test";
import assert from "node:assert/strict";
import { formatColo, formatEdgeNodeName } from "../src/utils/colo.js";

test("format COLO as Chinese location with flag", () => {
  assert.equal(formatColo("LAX"), "🇺🇸 美国洛杉矶 LAX");
  assert.equal(formatColo("hkg"), "🇭🇰 香港 HKG");
  assert.equal(formatColo("XXX"), "🌐 XXX");
});

test("format edge node name never prints upstream scanner latency (honesty)", () => {
  // 美国扫描机的延迟是 demo 数据，永远不印在名字里——没实测就只显示落点
  assert.equal(formatEdgeNodeName({ colo: "SJC", latency: 34 }, 1), "🇺🇸 美国圣何塞 SJC #2");
  assert.equal(
    formatEdgeNodeName({ name: "🇺🇸 美国洛杉矶 LAX 12ms #3", colo: "LAX", latency: 12 }, 0),
    "🇺🇸 美国洛杉矶 LAX #1",
  );
  // 存量老名字也不再沿用，一律现生成
  assert.equal(formatEdgeNodeName({ name: "优选-4", colo: "LAX", latency: null, userRtt: null }, 3), "🇺🇸 美国洛杉矶 LAX #4");
});

test("format edge node name shows only locally measured rtt", () => {
  assert.equal(
    formatEdgeNodeName({ name: "旧名", colo: "LAX", latency: 12, userRtt: 33 }, 1),
    "🇺🇸 美国洛杉矶 LAX 33ms 实测 #2",
  );
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
});
