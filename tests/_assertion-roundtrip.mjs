// Step 3b 단위 검증: Next.js signAssertion ↔ Worker verifyAssertion 라운드트립.
// 5케이스: happy / expired / wrong-aud / wrong-state / tampered
//
// 실행:
//   cd <internal-path>-mcp
//   node --experimental-strip-types tests/_assertion-roundtrip.mjs
// 또는 사전 빌드 없이 .mjs로 작성했으니:
//   node tests/_assertion-roundtrip.mjs

import { SignJWT, jwtVerify } from "jose";

const SECRET_RAW = "8DJRpPRGXOLtnmYB8rE5ALd6uZjDyFeUyEVlGveMrLk=";
const AUD = "https://mcp.beauticslab.com";
const enc = new TextEncoder();
const secret = enc.encode(SECRET_RAW);

// ---- inline copies of the two sides (값으로 검증, ts-import 우회) ----
async function signAssertion({ userId, email, state, expSec = 300, audience = AUD }) {
  return await new SignJWT({ email, state })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience(audience)
    .setExpirationTime(`${expSec}s`)
    .sign(secret);
}

// Worker side — assertion-verify.ts 동작과 동일 로직 (테스트용 inline)
async function verifyAssertion({ jwt, expectedState, verifyKey }) {
  const k = enc.encode(verifyKey);
  let payload;
  try {
    const v = await jwtVerify(jwt, k, { algorithms: ["HS256"], audience: AUD });
    payload = v.payload;
  } catch (err) {
    const code = err?.code ?? "";
    if (code === "ERR_JWT_EXPIRED") return { ok: false, error: "expired_assertion" };
    if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") return { ok: false, error: "invalid_audience" };
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

// ---- cases ----
const cases = [];

// 1. happy
cases.push(async () => {
  const jwt = await signAssertion({ userId: "csomeuserid000000000000001", email: "u@example.com", state: "WS-1" });
  const r = await verifyAssertion({ jwt, expectedState: "WS-1", verifyKey: SECRET_RAW });
  return { name: "happy", expect: "ok=true", got: r, pass: r.ok && r.payload.sub === "csomeuserid000000000000001" && r.payload.state === "WS-1" };
});

// 2. expired (negative exp = 1초 전)
cases.push(async () => {
  const jwt = await signAssertion({ userId: "u2", email: "u@e.com", state: "WS-2", expSec: -1 });
  const r = await verifyAssertion({ jwt, expectedState: "WS-2", verifyKey: SECRET_RAW });
  return { name: "expired", expect: "expired_assertion", got: r, pass: !r.ok && r.error === "expired_assertion" };
});

// 3. wrong audience (sign aud=evil, verify aud=mcp.beauticslab)
cases.push(async () => {
  const jwt = await signAssertion({ userId: "u3", email: "u@e.com", state: "WS-3", audience: "https://evil.example.com" });
  const r = await verifyAssertion({ jwt, expectedState: "WS-3", verifyKey: SECRET_RAW });
  return { name: "wrong-aud", expect: "invalid_audience", got: r, pass: !r.ok && r.error === "invalid_audience" };
});

// 4. state mismatch
cases.push(async () => {
  const jwt = await signAssertion({ userId: "u4", email: "u@e.com", state: "WS-A" });
  const r = await verifyAssertion({ jwt, expectedState: "WS-B", verifyKey: SECRET_RAW });
  return { name: "state-mismatch", expect: "state_mismatch", got: r, pass: !r.ok && r.error === "state_mismatch" };
});

// 5. tampered (서명 일부 변조)
cases.push(async () => {
  const jwt = await signAssertion({ userId: "u5", email: "u@e.com", state: "WS-5" });
  const parts = jwt.split(".");
  const tampered = parts[0] + "." + parts[1] + "." + parts[2].replace(/.$/, c => c === "A" ? "B" : "A");
  const r = await verifyAssertion({ jwt: tampered, expectedState: "WS-5", verifyKey: SECRET_RAW });
  return { name: "tampered", expect: "invalid_assertion", got: r, pass: !r.ok && r.error === "invalid_assertion" };
});

// 6. (보너스) wrong key
cases.push(async () => {
  const jwt = await signAssertion({ userId: "u6", email: "u@e.com", state: "WS-6" });
  const r = await verifyAssertion({ jwt, expectedState: "WS-6", verifyKey: "wrongwrongwrongwrongwrongwrong==" });
  return { name: "wrong-key", expect: "invalid_assertion", got: r, pass: !r.ok && r.error === "invalid_assertion" };
});

let allPass = true;
for (const fn of cases) {
  const r = await fn();
  const tag = r.pass ? "✅" : "❌";
  console.log(`${tag} ${r.name.padEnd(16)} expect=${r.expect.padEnd(20)} got=${JSON.stringify(r.got)}`);
  if (!r.pass) allPass = false;
}
process.exit(allPass ? 0 : 1);
