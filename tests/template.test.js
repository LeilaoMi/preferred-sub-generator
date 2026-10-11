import test from "node:test";
import assert from "node:assert/strict";
import { getNodeConfig, validateNodeConfig, nodeConfigToTemplate } from "../src/config/nodes.js";

const goodEnv = {
  VLESS_UUID: "11111111-1111-4111-8111-111111111111",
  VLESS_SNI: "front.example.com",
  VLESS_HOST: "backend.example.net",
  VLESS_PATH: "/ws",
  VLESS_PORT: "443",
  VLESS_TYPE: "ws",
  VLESS_SECURITY: "tls",
};

test("getNodeConfig: 从环境变量读取离散配置", () => {
  const c = getNodeConfig(goodEnv);
  assert.equal(c.uuid, goodEnv.VLESS_UUID);
  assert.equal(c.sni, "front.example.com");
  assert.equal(c.host, "backend.example.net");
  assert.equal(c.path, "/ws");
  assert.equal(c.port, 443);
});

test("getNodeConfig: 缺省值填充", () => {
  const c = getNodeConfig({ VLESS_UUID: goodEnv.VLESS_UUID, VLESS_SNI: "s", VLESS_HOST: "h" });
  assert.equal(c.port, 443);
  assert.equal(c.type, "ws");
  assert.equal(c.security, "tls");
  assert.equal(c.path, "");
});

test("getNodeConfig: 缺 UUID 抛错", () => {
  assert.throws(() => getNodeConfig({}), /VLESS_UUID/);
});

test("validate: 好配置零警告", () => {
  assert.deepEqual(validateNodeConfig(getNodeConfig(goodEnv)), []);
});

test("validate: workers.dev SNI 给 warn", () => {
  const warnings = validateNodeConfig(getNodeConfig({ ...goodEnv, VLESS_SNI: "abc.workers.dev" }));
  const w = warnings.find((x) => x.field === "sni");
  assert.ok(w);
  assert.equal(w.level, "warn");
});

test("validate: pages.dev SNI 给 warn", () => {
  const warnings = validateNodeConfig(getNodeConfig({ ...goodEnv, VLESS_SNI: "abc.pages.dev" }));
  assert.ok(warnings.some((x) => x.field === "sni" && x.level === "warn"));
});

test("validate: 缺 host 给 error", () => {
  const warnings = validateNodeConfig(getNodeConfig({ ...goodEnv, VLESS_HOST: "" }));
  assert.ok(warnings.some((x) => x.field === "host" && x.level === "error"));
});

test("validate: tls 缺 sni 给 error", () => {
  const warnings = validateNodeConfig(getNodeConfig({ ...goodEnv, VLESS_SNI: "" }));
  assert.ok(warnings.some((x) => x.field === "sni" && x.level === "error"));
});

test("nodeConfigToTemplate: 生成器可用形状", () => {
  const t = nodeConfigToTemplate(getNodeConfig(goodEnv));
  assert.equal(t.uuid, goodEnv.VLESS_UUID);
  assert.equal(t.sni, "front.example.com");
  assert.equal(t.host, "backend.example.net");
  for (const k of ["uuid", "host", "sni", "path", "port", "security", "type", "params"]) {
    assert.ok(k in t, `missing ${k}`);
  }
});

test("getNodeConfigFromUrl: 从 URL 参数读取", async () => {
  const { getNodeConfigFromUrl } = await import("../src/config/nodes.js");
  const url = new URL("https://example.com/sub?uuid=22222222-2222-4222-8222-222222222222&sni=s.example&host=h.example&path=/ws");
  const c = getNodeConfigFromUrl(url);
  assert.equal(c.uuid, "22222222-2222-4222-8222-222222222222");
  assert.equal(c.sni, "s.example");
  assert.equal(c.host, "h.example");
  assert.equal(c.path, "/ws");
});

test("getNodeConfigFromUrl: 无 uuid 返回 null 走兜底", async () => {
  const { getNodeConfigFromUrl } = await import("../src/config/nodes.js");
  const url = new URL("https://example.com/sub?type=vless");
  assert.equal(getNodeConfigFromUrl(url), null);
});
