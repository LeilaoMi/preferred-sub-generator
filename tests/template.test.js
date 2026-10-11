import test from "node:test";
import assert from "node:assert/strict";
import { validateTemplateFields, normalizeFields, fieldsToCanonical, uriToFields } from "../src/api/template.js";

const good = {
  uuid: "11111111-1111-4111-8111-111111111111",
  sni: "front.example.com",
  host: "backend.example.net",
  path: "/ws",
  port: 443,
  security: "tls",
  type: "ws",
};

test("validate: 好模板零警告", () => {
  assert.deepEqual(validateTemplateFields(good), []);
});

test("validate: workers.dev SNI 给 warn", () => {
  const warnings = validateTemplateFields({ ...good, sni: "abc.workers.dev" });
  const w = warnings.find((x) => x.field === "sni");
  assert.ok(w);
  assert.equal(w.level, "warn");
  assert.match(w.message, /SNI/);
});

test("validate: pages.dev SNI 给 warn", () => {
  const warnings = validateTemplateFields({ ...good, sni: "abc.pages.dev" });
  assert.ok(warnings.some((x) => x.field === "sni" && x.level === "warn"));
});

test("validate: 缺 uuid 给 error", () => {
  const warnings = validateTemplateFields({ ...good, uuid: "not-a-uuid" });
  const e = warnings.find((x) => x.field === "uuid");
  assert.ok(e);
  assert.equal(e.level, "error");
});

test("validate: 缺 host 给 error", () => {
  const warnings = validateTemplateFields({ ...good, host: "" });
  assert.ok(warnings.some((x) => x.field === "host" && x.level === "error"));
});

test("validate: tls 缺 sni 给 error", () => {
  const warnings = validateTemplateFields({ ...good, sni: "" });
  assert.ok(warnings.some((x) => x.field === "sni" && x.level === "error"));
});

test("validate: none 模式缺 sni 不报错", () => {
  const warnings = validateTemplateFields({ ...good, sni: "", security: "none" });
  assert.ok(!warnings.some((x) => x.field === "sni" && x.level === "error"));
});

test("normalizeFields: 缺省值填充", () => {
  const f = normalizeFields({ uuid: "x", host: "h", sni: "s" });
  assert.equal(f.port, 443);
  assert.equal(f.security, "tls");
  assert.equal(f.type, "ws");
  assert.equal(f.path, "");
});

test("uriToFields: 从链接解析分字段", () => {
  const f = uriToFields("vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?security=tls&sni=front.example.com&type=ws&host=backend.example.net&path=%2Fws#n");
  assert.equal(f.uuid, "11111111-1111-4111-8111-111111111111");
  assert.equal(f.sni, "front.example.com");
  assert.equal(f.host, "backend.example.net");
  assert.equal(f.path, "/ws");
  assert.equal(validateTemplateFields(f).length, 0);
});

test("fieldsToCanonical: 形状与解析器一致", () => {
  const c = fieldsToCanonical(good);
  assert.equal(c.protocol, "vless");
  assert.equal(c.uuid, good.uuid);
  assert.equal(c.sni, good.sni);
  // 生成器依赖的字段都在
  for (const k of ["uuid", "host", "sni", "path", "port", "security", "type", "params"]) {
    assert.ok(k in c, `missing ${k}`);
  }
});
