import test from "node:test";
import assert from "node:assert/strict";
import { parseVlessUri } from "../src/parser/vless.js";
import { generateClashSubscription } from "../src/generator/clash.js";
import { generateShadowrocketSubscription } from "../src/generator/shadowrocket.js";
import { generateSingboxSubscription } from "../src/generator/singbox.js";

const template = parseVlessUri(
  "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#原始节点",
);

const nodes = [
  { address: "1.1.1.1", port: 443, name: "优选-1" },
  { address: "2.2.2.2", port: 8443, name: "优选-2" },
];

test("generate Clash/Mihomo subscription", () => {
  const output = generateClashSubscription(template, nodes);

  assert.match(output, /proxies:/);
  assert.match(output, /type: vless/);
  assert.match(output, /server: "1.1.1.1"/);
  assert.match(output, /port: 443/);
  assert.match(output, /uuid: "11111111-1111-4111-8111-111111111111"/);
  assert.match(output, /network: ws/);
  assert.match(output, /tls: true/);
  assert.match(output, /servername: "example.com"/);
  assert.match(output, /path: "\/ws"/);
  assert.match(output, /Host: "example.com"/);
  assert.match(output, /MATCH,优选自动/);
});

test("generate Sing-box subscription", () => {
  const output = generateSingboxSubscription(template, nodes);
  const parsed = JSON.parse(output);

  assert.equal(parsed.outbounds.length, 2);
  assert.equal(parsed.outbounds[0].type, "vless");
  assert.equal(parsed.outbounds[0].server, "1.1.1.1");
  assert.equal(parsed.outbounds[0].server_port, 443);
  assert.equal(parsed.outbounds[0].uuid, "11111111-1111-4111-8111-111111111111");
  assert.equal(parsed.outbounds[0].transport.type, "ws");
  assert.equal(parsed.outbounds[0].transport.path, "/ws");
  assert.equal(parsed.outbounds[0].transport.headers.Host, "example.com");
  assert.equal(parsed.outbounds[0].tls.enabled, true);
  assert.equal(parsed.outbounds[0].tls.server_name, "example.com");
});

test("generate Shadowrocket subscription", () => {
  const output = generateShadowrocketSubscription(template, nodes);
  const lines = output.split("\n");

  assert.equal(lines.length, 2);
  assert.match(lines[0], /^vless:\/\//);
  assert.match(lines[0], /@1\.1\.1\.1:443/);
  assert.match(lines[0], /type=ws/);
  assert.match(lines[0], /security=tls/);
  assert.match(lines[0], /#%E4%BC%98%E9%80%89-1$/);
});
