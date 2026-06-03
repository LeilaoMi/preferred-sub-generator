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
});
