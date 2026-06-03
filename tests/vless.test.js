import test from "node:test";
import assert from "node:assert/strict";
import { parseVlessUri } from "../src/parser/vless.js";
import { generateVlessUri } from "../src/generator/vless.js";

test("parse VLESS WS TLS URI", () => {
  const uri = "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#示例节点";
  const parsed = parseVlessUri(uri);

  assert.equal(parsed.uuid, "11111111-1111-4111-8111-111111111111");
  assert.equal(parsed.address, "example.com");
  assert.equal(parsed.port, 443);
  assert.equal(parsed.security, "tls");
  assert.equal(parsed.type, "ws");
  assert.equal(parsed.host, "example.com");
  assert.equal(parsed.sni, "example.com");
  assert.equal(parsed.path, "/ws");
  assert.equal(parsed.name, "示例节点");
});

test("replace address and regenerate VLESS URI", () => {
  const uri = "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#示例节点";
  const parsed = parseVlessUri(uri);
  const generated = generateVlessUri(parsed, { address: "1.1.1.1", port: 8443, name: "优选-1" });
  const reparsed = parseVlessUri(generated);

  assert.equal(reparsed.address, "1.1.1.1");
  assert.equal(reparsed.port, 8443);
  assert.equal(reparsed.uuid, parsed.uuid);
  assert.equal(reparsed.security, "tls");
  assert.equal(reparsed.type, "ws");
  assert.equal(reparsed.host, "example.com");
  assert.equal(reparsed.sni, "example.com");
  assert.equal(reparsed.path, "/ws");
  assert.equal(reparsed.name, "优选-1");
});

test("parse non-TLS VLESS WS URI", () => {
  const uri = "vless://22222222-2222-4222-8222-222222222222@test.example:80?encryption=none&security=none&type=ws&host=test.example&path=%2Ffree#非TLS";
  const parsed = parseVlessUri(uri);

  assert.equal(parsed.port, 80);
  assert.equal(parsed.security, "none");
  assert.equal(parsed.type, "ws");
  assert.equal(parsed.host, "test.example");
  assert.equal(parsed.path, "/free");
});


test("generate VLESS URI wraps IPv6 address for v2rayNG parsing", () => {
  const uri = "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#示例节点";
  const parsed = parseVlessUri(uri);
  const generated = generateVlessUri(parsed, { address: "2606:4700::6810:85e5", port: 443, name: "优选-IPv6" });
  const url = new URL(generated);

  assert.match(generated, /@\[2606:4700::6810:85e5\]:443/);
  assert.equal(url.hostname, "[2606:4700::6810:85e5]");
  assert.equal(url.port, "443");
});
