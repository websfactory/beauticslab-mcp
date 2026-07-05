// Codex 리뷰 반영 후 추가 검증.
// 1. assertion: short key fail-fast / claim 매핑 좁힘 (nbf 등 다른 claim → invalid_assertion)
// 2. api-client: short key fail-fast / non-absolute path / origin 변경 / non-object body reject

import { SignJWT, jwtVerify } from "jose";

const SECRET = "8DJRpPRGXOLtnmYB8rE5ALd6uZjDyFeUyEVlGveMrLk=";
const HMAC_KEY = "2575QbqHG0RbpVfu8lPCORDAohOlz4hTZkQ3a2pFGCg=";
const AUD = "https://mcp.beauticslab.com";
const enc = new TextEncoder();

// inline mirror — assertion-verify.ts 동작
async function verifyAssertion({ jwt, expectedState, verifyKey }) {
  if (typeof verifyKey !== "string" || verifyKey.length < 32) {
    throw new Error("ASSERTION_VERIFY_KEY missing or too short");
  }
  const secret = enc.encode(verifyKey);
  let payload;
  try {
    const v = await jwtVerify(jwt, secret, { algorithms: ["HS256"], audience: AUD });
    payload = v.payload;
  } catch (err) {
    if (err?.code === "ERR_JWT_EXPIRED") return { ok: false, error: "expired_assertion" };
    if (err?.code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && err.claim === "aud") {
      return { ok: false, error: "invalid_audience" };
    }
    return { ok: false, error: "invalid_assertion" };
  }
  const { sub, email, aud, exp, state } = payload;
  if (typeof sub !== "string" || typeof email !== "string" || typeof aud !== "string" ||
      typeof exp !== "number" || typeof state !== "string") {
    return { ok: false, error: "missing_claims" };
  }
  if (state !== expectedState) return { ok: false, error: "state_mismatch" };
  return { ok: true, payload: { sub, email, aud, exp, state } };
}

// inline mirror — api-client.ts callInternal 가드만
function callInternalGuards({ path, body, hmacKey, baseUrl }) {
  if (!hmacKey || hmacKey.length < 32) throw new Error("INTERNAL_HMAC_KEY missing or too short");
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error("path must be absolute");
  if (body === undefined || body === null || typeof body !== "object") {
    throw new Error("body must be a JSON object/array");
  }
  const baseOrigin = new URL(baseUrl).origin;
  const url = new URL(path, baseUrl);
  if (url.origin !== baseOrigin) throw new Error("path must not change origin");
  return url.pathname + url.search;
}

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  cond ? pass++ : fail++;
};

// ---- assertion 추가 ----
// short key
try {
  await verifyAssertion({ jwt: "x.y.z", expectedState: "s", verifyKey: "short" });
  check("assertion-short-key throws", false);
} catch (e) {
  check("assertion-short-key throws", String(e.message).includes("too short"));
}

// nbf 미래 claim → ERR_JWT_CLAIM_VALIDATION_FAILED but claim !== "aud" → invalid_assertion
{
  const futureNbf = Math.floor(Date.now() / 1000) + 3600;
  const jwt = await new SignJWT({ email: "u@e.com", state: "s" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("u1")
    .setAudience(AUD)
    .setNotBefore(futureNbf)
    .setExpirationTime("5m")
    .sign(enc.encode(SECRET));
  const r = await verifyAssertion({ jwt, expectedState: "s", verifyKey: SECRET });
  check("nbf-future → invalid_assertion (not invalid_audience)",
    !r.ok && r.error === "invalid_assertion",
    `got=${JSON.stringify(r)}`);
}

// happy still works (regression)
{
  const jwt = await new SignJWT({ email: "u@e.com", state: "s" })
    .setProtectedHeader({ alg: "HS256" }).setSubject("u1").setAudience(AUD).setExpirationTime("5m")
    .sign(enc.encode(SECRET));
  const r = await verifyAssertion({ jwt, expectedState: "s", verifyKey: SECRET });
  check("regression-happy", r.ok);
}

// wrong aud still maps to invalid_audience
{
  const jwt = await new SignJWT({ email: "u@e.com", state: "s" })
    .setProtectedHeader({ alg: "HS256" }).setSubject("u1").setAudience("https://evil.example").setExpirationTime("5m")
    .sign(enc.encode(SECRET));
  const r = await verifyAssertion({ jwt, expectedState: "s", verifyKey: SECRET });
  check("regression-wrong-aud → invalid_audience", !r.ok && r.error === "invalid_audience",
    `got=${JSON.stringify(r)}`);
}

// ---- api-client 가드 ----
const ok = { hmacKey: HMAC_KEY, baseUrl: "http://localhost:3000", body: { x: 1 } };

// short key
try { callInternalGuards({ ...ok, path: "/p", hmacKey: "short" }); check("short-hmac-key throws", false); }
catch (e) { check("short-hmac-key throws", String(e.message).includes("too short")); }

// non-absolute path
try { callInternalGuards({ ...ok, path: "api/foo" }); check("relative-path rejected", false); }
catch (e) { check("relative-path rejected", String(e.message).includes("absolute")); }

// protocol-relative path "//evil/..." → URL resolves to different origin → reject
try {
  callInternalGuards({ ...ok, path: "//evil.example.com/api" });
  check("proto-relative-evil rejected", false);
} catch (e) {
  // URL("//evil.example.com/api", "http://localhost:3000") → http://evil.example.com/api
  // path doesn't start with "/" check might catch this? Actually "//x" startsWith "/" is true.
  // So it should pass first check, then origin check should reject.
  check("proto-relative-evil rejected", String(e.message).includes("absolute") || String(e.message).includes("origin"));
}

// absolute http://evil — path startsWith "/" check should fail (doesn't start with "/")
try { callInternalGuards({ ...ok, path: "http://evil.example.com/api" }); check("abs-http-url rejected", false); }
catch (e) { check("abs-http-url rejected", true); }

// undefined body
try { callInternalGuards({ ...ok, path: "/p", body: undefined }); check("undefined-body rejected", false); }
catch (e) { check("undefined-body rejected", String(e.message).includes("JSON object")); }

// string body
try { callInternalGuards({ ...ok, path: "/p", body: "not an object" }); check("string-body rejected", false); }
catch (e) { check("string-body rejected", true); }

// happy guard pass
try {
  const p = callInternalGuards({ ...ok, path: "/api/internal/mcp/search-product?x=1" });
  check("happy-guard returns pathWithQuery", p === "/api/internal/mcp/search-product?x=1", `got=${p}`);
} catch (e) {
  check("happy-guard returns pathWithQuery", false, e.message);
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
