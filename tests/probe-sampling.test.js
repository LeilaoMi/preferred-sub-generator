import test from "node:test";
import assert from "node:assert/strict";
// 导入即证明 main() 有守卫（否则会因缺 --site 直接抛错退出）
import { decideSample, median, sampleStddev, sampleTcpRtt } from "../scripts/probe-ips.js";

test("median 取中位数（奇/偶）", () => {
  assert.equal(median([300, 100, 200]), 200);
  assert.equal(median([300, 100]), 200);
  assert.equal(median([]), null);
});

test("sampleStddev 为 0 表示完全稳定", () => {
  assert.equal(sampleStddev([150, 150, 150]), 0);
  assert.ok(sampleStddev([100, 200, 300]) > 80);
});

test("decideSample：3 次全成功算可用，延迟取中位数", () => {
  const result = decideSample([300, 100, 200], 3);
  assert.equal(result.ok, true);
  assert.equal(result.rtt, 200);
});

test("decideSample：3 次成功 2 次算可用（容忍一次毛刺）", () => {
  const result = decideSample([120, 130], 3);
  assert.equal(result.ok, true);
  assert.equal(result.rtt, 125);
});

test("decideSample：3 次只成功 1 次判死", () => {
  const result = decideSample([120], 3);
  assert.equal(result.ok, false);
  assert.equal(result.rtt, null);
});

test("decideSample：全部失败判死", () => {
  const result = decideSample([], 3);
  assert.equal(result.ok, false);
  assert.equal(result.rtt, null);
});

test("decideSample：samples=1 时兼容旧行为（成功即算可用）", () => {
  assert.equal(decideSample([180], 1).ok, true);
  assert.equal(decideSample([], 1).ok, false);
});

test("sampleTcpRtt 按次数调用注入的 tcpRtt 并汇总", async () => {
  const calls = [];
  const scripted = [120, null, 130];
  const fake = async (address, port, timeoutMs) => {
    calls.push([address, port, timeoutMs]);
    return scripted[calls.length - 1];
  };
  const { rtts, failures } = await sampleTcpRtt("1.1.1.1", 443, {
    samples: 3,
    timeoutMs: 5000,
    delayMs: 0,
    tcpRttImpl: fake,
  });
  assert.deepEqual(rtts, [120, 130]);
  assert.equal(failures, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ["1.1.1.1", 443, 5000]);
});

test("sampleTcpRtt 全失败时返回空列表", async () => {
  const { rtts, failures } = await sampleTcpRtt("10.0.0.1", 443, {
    samples: 3,
    delayMs: 0,
    tcpRttImpl: async () => null,
  });
  assert.deepEqual(rtts, []);
  assert.equal(failures, 3);
});
