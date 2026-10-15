import test from "node:test";
import assert from "node:assert/strict";
import { validateManualSource } from "../scripts/validate-sources.js";

test("接受 cf-termux-pick 的 IP#备注 格式", () => {
  const text = "# 注释\n104.17.156.127#v4-SJC\n104.17.156.55:2053#v4-LAX\n";
  assert.deepEqual(validateManualSource(text), []);
});

test("接受 IPv6（带或不带方括号，带备注）", () => {
  const text = "2606:4700::6810:1#v6-SJC\n[2606:4700::6810:2]:443#v6-LAX\n";
  assert.deepEqual(validateManualSource(text), []);
});

test("仍然拒绝非 CF Edge 源和乱码行", () => {
  assert.equal(validateManualSource("proxyip.example.com\n").length, 1);
  assert.equal(validateManualSource("not a valid line!\n").length, 1);
});
