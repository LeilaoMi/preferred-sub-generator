import test from "node:test";
import assert from "node:assert/strict";
import { generateClashSubscription } from "../src/generator/clash.js";
import { generateSingboxSubscription } from "../src/generator/singbox.js";
import { generateVlessUri } from "../src/generator/vless.js";

const template = {
  uuid: "11111111-1111-4111-8111-111111111111",
  address: "origin.example.com",
  port: "443",
  security: "tls",
  type: "ws",
  host: "origin.example.com",
  sni: "origin.example.com",
  path: "/ws",
  name: "原始节点",
  params: new URLSearchParams("encryption=none&security=tls&sni=origin.example.com&type=ws&host=origin.example.com&path=%2Fws"),
};
const nodes = [{ address: "1.1.1.1", port: 443, name: "测试节点" }];

test("Clash output contains proxies and proxy-groups", () => {
  const yaml = generateClashSubscription(template, nodes);
  assert.match(yaml, /^proxies:/m);
  assert.match(yaml, /^proxy-groups:/m);
  assert.match(yaml, /name: "测试节点"/);
});

test("Sing-box output is valid JSON with outbounds", () => {
  const data = JSON.parse(generateSingboxSubscription(template, nodes));
  assert.equal(Array.isArray(data.outbounds), true);
  assert.equal(data.outbounds[0].server, "1.1.1.1");
  assert.equal(data.outbounds[0].tag, "测试节点");
});

test("v2rayNG base64 decodes to valid vless URI", () => {
  const uri = generateVlessUri(template, nodes[0]);
  const encoded = Buffer.from(uri, "utf8").toString("base64");
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const url = new URL(decoded);
  assert.equal(url.protocol, "vless:");
  assert.equal(url.hostname, "1.1.1.1");
});

test("Surge output uses Trojan-WS (Surge has no VLESS)", async () => {
  const { generateSurgeSubscription } = await import("../src/generator/surge.js");
  const conf = generateSurgeSubscription(template, nodes, { autoTest: true });
  assert.match(conf, /^\[Proxy\]/m);
  assert.match(conf, /^测试节点 = trojan, 1\.1\.1\.1, 443, password=11111111-1111-4111-8111-111111111111, sni=origin\.example\.com, ws=true, ws-path=\/ws, ws-headers=Host:origin\.example\.com/m);
  assert.doesNotMatch(conf, /vless/i);
  assert.match(conf, /^自动测速 = url-test, 测试节点, url=/m);
});

test("Loon output follows the documented VLESS syntax", async () => {
  const { generateLoonSubscription } = await import("../src/generator/loon.js");
  const conf = generateLoonSubscription(template, nodes, { autoTest: true });
  assert.match(conf, /^\[Proxy\]/m);
  assert.match(conf, /^测试节点 = VLESS,1\.1\.1\.1,443,"11111111-1111-4111-8111-111111111111",transport=ws,path=\/ws,host=origin\.example\.com,over-tls=true,sni=origin\.example\.com/m);
  assert.match(conf, /^自动测速 = url-test,测试节点,url=/m);
  assert.doesNotMatch(conf, /Remote Proxy/);
});

test("Stash output uses sni (not servername)", async () => {
  const { generateStashSubscription } = await import("../src/generator/stash.js");
  const yaml = generateStashSubscription(template, nodes);
  assert.match(yaml, /^proxies:/m);
  assert.match(yaml, /^\s+sni: "origin\.example\.com"/m);
  assert.doesNotMatch(yaml, /servername/);
});

test("UA inference: Stash before Clash", async () => {
  const { inferTypeFromUa } = await import("../src/api/sub.js");
  assert.equal(inferTypeFromUa("Stash/2.4.6 Clash/1.9.0"), "stash");
  assert.equal(inferTypeFromUa("clash.meta"), "clash");
});
