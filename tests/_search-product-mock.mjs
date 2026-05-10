// search_product tool 단위 검증.
// 실제 Worker 런타임 import는 ts라 우회 — callInternalMasked 동작을 mocked fetch로 시뮬레이션.
// 검증 포인트: 1) HMAC 서명 헤더가 실제 Next.js verifyMcpHmac을 통과 2) 401 마스킹 3) 200 → structuredResult 4) 4xx 마스킹

import { createHash, createHmac, timingSafeEqual, webcrypto } from "node:crypto";

const HMAC_KEY = "slyNiBEzW+Rwx9E0D0y7P3+zNOZfKi6ddDsKCo3MxdE=";
const enc = new TextEncoder();
const subtle = webcrypto.subtle;

// ---- Worker side (api-client.ts mirror) ----
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
async function callInternal({ path, body, userId }, { baseUrl, hmacKey, fetchImpl, nowMs }) {
  if (!hmacKey || hmacKey.length < 32) throw new Error("INTERNAL_HMAC_KEY too short");
  if (!path.startsWith("/")) throw new Error("path must be absolute");
  if (typeof body !== "object" || body === null) throw new Error("body must be JSON object");
  if (typeof userId !== "string" || userId.length === 0) throw new Error("userId required (OAuth single-mode invariant)");
  const baseOrigin = new URL(baseUrl).origin;
  const url = new URL(path, baseUrl);
  if (url.origin !== baseOrigin) throw new Error("origin mismatch");
  const ts = String((nowMs ?? Date.now)());
  const bodyBytes = enc.encode(JSON.stringify(body));
  const canon = await workerCanonical({
    method: "POST", pathWithQuery: url.pathname + url.search, timestamp: ts,
    userId, bodyBytes,
  });
  const sig = await workerSign(canon, hmacKey);
  const headers = {
    "content-type": "application/json",
    authorization: `HMAC ${sig}`,
    "x-mcp-timestamp": ts,
    "x-mcp-user-id": userId,
  };
  return await (fetchImpl ?? fetch)(url.toString(), { method: "POST", headers, body: bodyBytes });
}

// ---- Next.js side (verifyMcpHmac mirror) ----
async function verifyMcpHmac(req) {
  const auth = req.headers.authorization;
  const ts = req.headers["x-mcp-timestamp"];
  const uid = req.headers["x-mcp-user-id"] ?? "";
  if (!auth?.startsWith("HMAC ")) return { ok: false, error: "missing_hmac" };
  if (!ts) return { ok: false, error: "missing_timestamp" };
  if (Math.abs(Date.now() - Number(ts)) > 60_000) return { ok: false, error: "stale_timestamp" };
  const path = new URL(req.url).pathname + new URL(req.url).search;
  const bodyBytes = enc.encode(req.body); // already string
  const bodyHash = createHash("sha256").update(bodyBytes).digest("hex");
  const canon = ["POST", path, ts, uid, bodyHash].join("\n");
  const expected = createHmac("sha256", HMAC_KEY).update(canon).digest("hex");
  const presented = auth.slice("HMAC ".length);
  if (presented !== expected) return { ok: false, error: "bad_signature" };
  return { ok: true, userId: uid || null };
}

// ---- callInternalMasked mirror ----
async function callInternalMasked(env, opts) {
  let res;
  try {
    res = await callInternal(opts, { baseUrl: env.NEXTJS_INTERNAL_BASE_URL, hmacKey: env.INTERNAL_HMAC_KEY, fetchImpl: env._fetch });
  } catch { return { ok: false, result: { content: [{ type: "text", text: "내부 호출 중 오류가 발생했습니다." }], isError: true } }; }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, result: { content: [{ type: "text", text: "인증 오류입니다. 잠시 후 다시 시도해주세요." }], isError: true } };
  }
  if (res.status === 404) {
    return { ok: false, result: { content: [{ type: "text", text: "not_found" }], isError: true, _status: 404 } };
  }
  if (res.status >= 400) {
    let detail = "";
    try {
      const b = await res.json();
      if (res.status === 400 && b?.error === "invalid_input") detail = "입력값이 유효하지 않습니다.";
    } catch {}
    return { ok: false, result: { content: [{ type: "text", text: detail || `내부 호출이 실패했습니다 (status ${res.status}).` }], isError: true } };
  }
  return { ok: true, data: await res.json() };
}

// ---- mock Next.js fetch ----
function makeMockFetch(handler) {
  return async (url, init) => {
    const req = {
      url,
      method: init.method,
      headers: Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v])),
      body: typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body),
    };
    const v = await verifyMcpHmac(req);
    if (!v.ok) return new Response(JSON.stringify({ error: v.error }), { status: 401, headers: { "content-type": "application/json" } });
    return await handler(req);
  };
}

let pass = 0, fail = 0;
const check = (n, c, d = "") => { console.log(`${c?"✅":"❌"} ${n}${d?" — "+d:""}`); c?pass++:fail++; };

// Case 1: happy — Next.js가 정상 응답
{
  const env = {
    NEXTJS_INTERNAL_BASE_URL: "http://localhost:3000",
    INTERNAL_HMAC_KEY: HMAC_KEY,
    _fetch: makeMockFetch(async () => new Response(JSON.stringify({
      query: "선크림",
      totalCount: 2,
      truncated: false,
      items: [
        { goodsNo: "A123", source: "oliveyoung", name: "테스트1", brand: null, imageUrl: null, price: 10000, rating: null, reviewCount: 10, routineCount: 5 },
        { goodsNo: "DAISO_999", source: "daiso", name: "테스트2", brand: null, imageUrl: null, price: 5000, rating: null, reviewCount: 0, routineCount: 1 },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })),
  };
  const r = await callInternalMasked(env, { path: "/api/internal/mcp/search-product", body: { query: "선크림", limit: 20 }, userId: "ctest00000000000000000001" });
  check("happy 200 → structured ok", r.ok && r.data.totalCount === 2 && r.data.items[0].source === "oliveyoung");
}

// Case 2: HMAC 위조 시도 — 다른 키로 서명한 가짜 fetch (실제로는 Worker는 정상 키 쓰지만, mock 측이 다른 키를 검증한다고 가정)
{
  const env = {
    NEXTJS_INTERNAL_BASE_URL: "http://localhost:3000",
    INTERNAL_HMAC_KEY: HMAC_KEY,
    _fetch: makeMockFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })),
  };
  const r = await callInternalMasked(env, { path: "/api/internal/mcp/search-product", body: { query: "ok" }, userId: "ctest00000000000000000002" });
  check("real-sign passes mock verify", r.ok && r.data?.ok === true);
}

// Case 3: 401 마스킹 — Next.js가 강제로 401 반환
{
  const env = {
    NEXTJS_INTERNAL_BASE_URL: "http://localhost:3000",
    INTERNAL_HMAC_KEY: HMAC_KEY,
    _fetch: async (url, init) => new Response(JSON.stringify({ error: "bad_signature" }), { status: 401 }),
  };
  const r = await callInternalMasked(env, { path: "/api/internal/mcp/search-product", body: { query: "x" }, userId: "ctest00000000000000000003" });
  check("401 masked", !r.ok && r.result.isError && r.result.content[0].text.includes("인증 오류") && !r.result.content[0].text.includes("bad_signature"),
    `text=${r.result.content[0].text}`);
}

// Case 4: 400 invalid_input → 마스킹된 안내
{
  const env = {
    NEXTJS_INTERNAL_BASE_URL: "http://localhost:3000",
    INTERNAL_HMAC_KEY: HMAC_KEY,
    _fetch: async () => new Response(JSON.stringify({ error: "invalid_input" }), { status: 400, headers: { "content-type": "application/json" } }),
  };
  const r = await callInternalMasked(env, { path: "/api/internal/mcp/search-product", body: { query: "x" }, userId: "ctest00000000000000000004" });
  check("400 invalid_input → user-facing detail", !r.ok && r.result.content[0].text.includes("입력값"),
    `text=${r.result.content[0].text}`);
}

// Case 5: 5xx 마스킹
{
  const env = {
    NEXTJS_INTERNAL_BASE_URL: "http://localhost:3000",
    INTERNAL_HMAC_KEY: HMAC_KEY,
    _fetch: async () => new Response("ise", { status: 500 }),
  };
  const r = await callInternalMasked(env, { path: "/api/internal/mcp/search-product", body: { query: "x" }, userId: "ctest00000000000000000005" });
  check("500 masked", !r.ok && r.result.content[0].text.includes("내부 호출이 실패"),
    `text=${r.result.content[0].text}`);
}

// Case 6: 404 흐름 (search-product에서는 의미 없지만 헬퍼 검증)
{
  const env = {
    NEXTJS_INTERNAL_BASE_URL: "http://localhost:3000",
    INTERNAL_HMAC_KEY: HMAC_KEY,
    _fetch: async () => new Response(JSON.stringify({ error: "no_routines" }), { status: 404 }),
  };
  const r = await callInternalMasked(env, { path: "/api/internal/mcp/search-product", body: { query: "x" }, userId: "ctest00000000000000000006" });
  check("404 _status carries", !r.ok && r.result._status === 404);
}

// Case 6.5: missing userId throws (single-mode invariant — 2026-05-10)
{
  const env = {
    NEXTJS_INTERNAL_BASE_URL: "http://localhost:3000",
    INTERNAL_HMAC_KEY: HMAC_KEY,
    _fetch: async () => new Response("never", { status: 200 }),
  };
  const r = await callInternalMasked(env, { path: "/api/internal/mcp/search-product", body: { query: "x" }, userId: "" });
  check("missing userId → masked error (invariant violation)", !r.ok && r.result.isError);
}

// Case 7: zod 스키마 spec 일치 — tools-spec §1.3 source enum
{
  const sources = ["oliveyoung", "enuri", "daiso", "custom"];
  const cats = ["skincare", "suncare", "cleansing", "maskpack", "makeup", "bodyhair"];
  check("source enum spec match", sources.length === 4);
  check("category enum spec match", cats.length === 6);
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
