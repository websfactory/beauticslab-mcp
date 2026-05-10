// Step 3b 단위 검증: Worker api-client 의 canonical/signature가
// beauticslab/src/lib/mcp/hmac.ts (Node createHash/createHmac)와 byte-동등인지.
// 5라인 canonical (METHOD\nPATH\nTS\nUSER_ID\nsha256_hex(body))이 양쪽에서 동일해야 verifyMcpHmac 통과.

import { createHash, createHmac, webcrypto } from "node:crypto";

const KEY = "slyNiBEzW+Rwx9E0D0y7P3+zNOZfKi6ddDsKCo3MxdE=";
const enc = new TextEncoder();
const subtle = webcrypto.subtle;

// ---- Worker-side (Web Crypto) ----
async function workerCanonical({ method, pathWithQuery, timestamp, userId, bodyBytes }) {
  const digest = await subtle.digest("SHA-256", bodyBytes);
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return [method.toUpperCase(), pathWithQuery, timestamp, userId, hex].join("\n");
}
async function workerSign(canonical, key) {
  const k = await subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await subtle.sign("HMAC", k, enc.encode(canonical));
  let hex = "";
  for (const b of new Uint8Array(sig)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// ---- Next.js-side (node:crypto, mirrors hmac.ts) ----
function nodeCanonical({ method, pathWithQuery, timestamp, userId, bodyBytes }) {
  const bodyHashHex = createHash("sha256").update(bodyBytes).digest("hex");
  return [method.toUpperCase(), pathWithQuery, timestamp, userId, bodyHashHex].join("\n");
}
function nodeSign(canonical, key) {
  return createHmac("sha256", key).update(canonical).digest("hex");
}

// ---- cases ----
const cases = [
  { name: "authed-with-user", body: { includeIngredients: true }, userId: "csomeuserid000000000000001", path: "/api/internal/mcp/my-routine" },
  { name: "empty-body", body: {}, userId: "ctest00000000000000000001" },
  { name: "korean-body", body: { query: "한글 쿼리 테스트", note: "이모지😀" }, userId: "ctest00000000000000000002" },
];

let allPass = true;
for (const c of cases) {
  const path = c.path ?? "/api/internal/mcp/search-product";
  const ts = "1715347200000";
  const bodyBytes = enc.encode(JSON.stringify(c.body));
  const args = { method: "POST", pathWithQuery: path, timestamp: ts, userId: c.userId, bodyBytes };

  const cw = await workerCanonical(args);
  const cn = nodeCanonical(args);
  const canonOk = cw === cn;

  const sw = await workerSign(cw, KEY);
  const sn = nodeSign(cn, KEY);
  const sigOk = sw === sn;

  const tag = (canonOk && sigOk) ? "✅" : "❌";
  console.log(`${tag} ${c.name.padEnd(20)} canonOk=${canonOk} sigOk=${sigOk}`);
  if (!canonOk) {
    console.log("   worker canon:", JSON.stringify(cw));
    console.log("   node   canon:", JSON.stringify(cn));
  }
  if (!sigOk) {
    console.log("   worker sig:", sw);
    console.log("   node   sig:", sn);
  }
  if (!(canonOk && sigOk)) allPass = false;
}

// 6. (보너스) verifyMcpHmac 흉내 — Worker 서명이 timestamp skew 통과하면 verify 성공해야
{
  const now = Date.now();
  const ts = String(now);
  const body = { query: "verify check" };
  const bodyBytes = enc.encode(JSON.stringify(body));
  const path = "/api/internal/mcp/search-product";
  const userId = "ctest00000000000000000003";
  const canon = await workerCanonical({ method: "POST", pathWithQuery: path, timestamp: ts, userId, bodyBytes });
  const sig = await workerSign(canon, KEY);
  // verify side
  const skew = Math.abs(Date.now() - Number(ts));
  const expected = nodeSign(nodeCanonical({ method: "POST", pathWithQuery: path, timestamp: ts, userId, bodyBytes }), KEY);
  const pass = skew <= 60_000 && sig === expected;
  console.log(`${pass ? "✅" : "❌"} ${"verify-roundtrip".padEnd(20)} skew_ms=${skew} sig_match=${sig === expected}`);
  if (!pass) allPass = false;
}

process.exit(allPass ? 0 : 1);
