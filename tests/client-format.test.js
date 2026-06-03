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
