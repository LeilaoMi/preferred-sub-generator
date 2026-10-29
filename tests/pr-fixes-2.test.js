import test from "node:test";
import assert from "node:assert/strict";
import { parseVlessUri } from "../src/parser/vless.js";
import { maskHost } from "../src/api/status.js";
import { isIPv6 } from "../scripts/lib/candidates.js";
import { normalizeNodes } from "../src/api/sub.js";

test("VLESS path is decoded only once: %252F stays %2F, %2Fws stays /ws", () => {
  const doubleEncoded = parseVlessUri(
    "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&type=ws&path=%252Ffoo#n",
  );
  assert.equal(doubleEncoded.path, "%2Ffoo");
  const normal = parseVlessUri(
    "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&security=tls&type=ws&path=%2Fws#n",
  );
  assert.equal(normal.path, "/ws");
});

test("maskHost hides a two-label domain instead of leaking it in the tail", () => {
  assert.equal(maskHost("secret.com"), "s***.com");
  assert.equal(maskHost("1.leilaomi.ccwu.cc"), "1***.ccwu.cc");
  assert.equal(maskHost("localhost"), "***");
});

test("isIPv6 rejects :::: while accepting compressed IPv6", () => {
  assert.equal(isIPv6("::::"), false);
  assert.equal(isIPv6("2606:4700::6810:85e5"), true);
  assert.equal(isIPv6("::1"), true);
  assert.equal(isIPv6("1.1.1.1"), false);
});

test("normalizeNodes clamps invalid ports to 443 and keeps valid ports", () => {
  const nodes = normalizeNodes([
    { address: "1.1.1.1", port: 99999 },
    { address: "2.2.2.2", port: 8443 },
    { address: "3.3.3.3", port: "abc" },
    { address: "4.4.4.4", port: 0 },
  ]);
  assert.deepEqual(
    nodes.map((node) => node.port),
    [443, 8443, 443, 443],
  );
});
