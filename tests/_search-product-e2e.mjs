// 실제 Next.js dev (http://localhost:3000) 대상 e2e.
// Worker api-client.ts와 동일 방식으로 HMAC 서명해 /api/internal/mcp/search-product 호출.

import { webcrypto } from "node:crypto";

const HMAC_KEY = "2575QbqHG0RbpVfu8lPCORDAohOlz4hTZkQ3a2pFGCg=";
const BASE = "http://localhost:3000";
const enc = new TextEncoder();
const subtle = webcrypto.subtle;

async function sha256Hex(bytes) {
  const d = await subtle.digest("SHA-256", bytes);
  let h = ""; for (const b of new Uint8Array(d)) h += b.toString(16).padStart(2, "0");
  return h;
}
async function hmacHex(canon, key) {
  const k = await subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await subtle.sign("HMAC", k, enc.encode(canon));
  let h = ""; for (const b of new Uint8Array(s)) h += b.toString(16).padStart(2, "0");
  return h;
}
// Worker→Next.js HMAC fetch mirror — Next.js verifier 동작 검증용.
// 의도적으로 userId 누락을 허용함(Case 7 "missing userId → 401" 검증). 실제 Worker(api-client.ts)는
// userId required로 강제됨(2026-05-10) — 그 invariant는 _search-product-mock.mjs에서 검증.
async function callInternal({ path, body, userId, key = HMAC_KEY, ts = String(Date.now()) }) {
  const url = new URL(path, BASE);
  const bodyBytes = enc.encode(JSON.stringify(body));
  const bodyHash = await sha256Hex(bodyBytes);
  const uid = userId ?? "";
  const canon = ["POST", url.pathname + url.search, ts, uid, bodyHash].join("\n");
  const sig = await hmacHex(canon, key);
  const headers = { "content-type": "application/json", authorization: `HMAC ${sig}`, "x-mcp-timestamp": ts };
  if (userId) headers["x-mcp-user-id"] = userId;
  return await fetch(url.toString(), { method: "POST", headers, body: bodyBytes });
}

let pass = 0, fail = 0;
const check = (n, c, d = "") => { console.log(`${c?"✅":"❌"} ${n}${d?" — "+d:""}`); c?pass++:fail++; };

// 1. happy: query="선크림"
{
  const res = await callInternal({ path: "/api/internal/mcp/search-product", body: { query: "선크림", limit: 5 }, userId: "cmisnvh080cyxmxlh86oy35a8" });
  const data = await res.json().catch(() => ({}));
  check("happy 선크림", res.status === 200 && Array.isArray(data.items),
    `status=${res.status} totalCount=${data.totalCount} items=${data.items?.length}`);
  if (data.items?.[0]) {
    const it = data.items[0];
    check("source enum 외부 매핑", ["oliveyoung","enuri","daiso","custom"].includes(it.source),
      `source=${it.source} goodsNo=${it.goodsNo}`);
    check("필드 모양 (goodsNo, name, reviewCount, routineCount)",
      typeof it.goodsNo === "string" && typeof it.name === "string" &&
      typeof it.reviewCount === "number" && typeof it.routineCount === "number",
      JSON.stringify({ goodsNo: it.goodsNo, name: it.name?.slice(0,20), reviewCount: it.reviewCount, routineCount: it.routineCount }));
  }
}

// 2. invalid_input: query 1자
{
  const res = await callInternal({ path: "/api/internal/mcp/search-product", body: { query: "x" }, userId: "cmisnvh080cyxmxlh86oy35a8" });
  const data = await res.json().catch(() => ({}));
  check("query<2 → 400 invalid_input", res.status === 400, `status=${res.status} body=${JSON.stringify(data)}`);
}

// 3. bad signature: 다른 키
{
  const res = await callInternal({ path: "/api/internal/mcp/search-product", body: { query: "test123" }, userId: "cmisnvh080cyxmxlh86oy35a8", key: "wrongkeywrongkeywrongkeywrongkey00" });
  check("wrong key → 401", res.status === 401, `status=${res.status}`);
}

// 4. stale timestamp
{
  const res = await callInternal({ path: "/api/internal/mcp/search-product", body: { query: "test123" }, userId: "cmisnvh080cyxmxlh86oy35a8", ts: String(Date.now() - 120_000) });
  check("stale ts → 401", res.status === 401, `status=${res.status}`);
}

// 5. sources 필터: oliveyoung만 → 모든 결과 source=oliveyoung
{
  const res = await callInternal({ path: "/api/internal/mcp/search-product", body: { query: "토너", limit: 5, sources: ["oliveyoung"] }, userId: "cmisnvh080cyxmxlh86oy35a8" });
  const data = await res.json().catch(() => ({}));
  const allOY = data.items?.every(i => i.source === "oliveyoung") ?? false;
  check("sources=[oliveyoung] 필터", res.status === 200 && allOY,
    `status=${res.status} count=${data.items?.length} sources=${[...new Set(data.items?.map(i=>i.source))].join(",")}`);
}

// 6. category 필터
{
  const res = await callInternal({ path: "/api/internal/mcp/search-product", body: { query: "선크림", limit: 3, category: "suncare" }, userId: "cmisnvh080cyxmxlh86oy35a8" });
  check("category=suncare 통과", res.status === 200, `status=${res.status}`);
}

// 7. missing userId → 401 missing_user
{
  const res = await callInternal({ path: "/api/internal/mcp/search-product", body: { query: "선크림" } });
  const data = await res.json().catch(() => ({}));
  check("missing userId → 401 missing_user", res.status === 401, `status=${res.status}`);
}

// 8. invalid cuid → 400 invalid_user_id
{
  const res = await callInternal({ path: "/api/internal/mcp/search-product", body: { query: "선크림" }, userId: "not-a-cuid" });
  const data = await res.json().catch(() => ({}));
  check("invalid cuid → 400 invalid_user_id", res.status === 400, `status=${res.status}`);
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
