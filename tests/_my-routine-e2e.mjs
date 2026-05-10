// 실제 Next.js dev 대상 my-routine e2e.
// userId: <redacted-userid> (실측 40 routines, cap 20 적용 확인용)

import { webcrypto } from "node:crypto";

const HMAC_KEY = "slyNiBEzW+Rwx9E0D0y7P3+zNOZfKi6ddDsKCo3MxdE=";
const BASE = "http://localhost:3000";
const PATH = "/api/internal/mcp/my-routine";
const REAL_USER = "cmisnvh080cyxmxlh86oy35a8"; // PERSONAL 23 routines, cap 20 트리거
const enc = new TextEncoder();
const subtle = webcrypto.subtle;

async function sha256Hex(b) { const d = await subtle.digest("SHA-256", b); let h=""; for (const x of new Uint8Array(d)) h+=x.toString(16).padStart(2,"0"); return h; }
async function hmacHex(c, k) { const ck = await subtle.importKey("raw", enc.encode(k), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]); const s = await subtle.sign("HMAC", ck, enc.encode(c)); let h=""; for (const x of new Uint8Array(s)) h+=x.toString(16).padStart(2,"0"); return h; }

// Worker→Next.js HMAC fetch mirror. 실제 Worker(api-client.ts)는 userId required로 강제됨(2026-05-10).
// 본 mirror는 Next.js verifier 분기 검증용이라 userId 누락 폴백을 유지(현재 케이스 모두 userId 전달).
async function call({ body, userId, ts = String(Date.now()) }) {
  const url = new URL(PATH, BASE);
  const bb = enc.encode(JSON.stringify(body));
  const canon = ["POST", url.pathname + url.search, ts, userId ?? "", await sha256Hex(bb)].join("\n");
  const sig = await hmacHex(canon, HMAC_KEY);
  const headers = { "content-type": "application/json", authorization: `HMAC ${sig}`, "x-mcp-timestamp": ts };
  if (userId) headers["x-mcp-user-id"] = userId;
  return await fetch(url.toString(), { method: "POST", headers, body: bb });
}

let pass=0, fail=0;
const check = (n,c,d="") => { console.log(`${c?"✅":"❌"} ${n}${d?" — "+d:""}`); c?pass++:fail++; };

// 1. invalid cuid format → 400
{
  const res = await call({ body: { includeIngredients: false }, userId: "not-a-cuid" });
  check("invalid cuid → 400", res.status === 400, `status=${res.status}`);
}

// 2. valid cuid but no routines → 404
{
  // cuid v1 형식 but 존재 안 하는 사용자
  const res = await call({ body: { includeIngredients: false }, userId: "czzzzzzzzzzzzzzzzzzzzzzzz" });
  check("nonexistent user → 404", res.status === 404, `status=${res.status}`);
}

// 3. happy: 실제 사용자, includeIngredients=false
{
  const res = await call({ body: { includeIngredients: false }, userId: REAL_USER });
  const data = await res.json().catch(() => ({}));
  check("happy 200", res.status === 200, `status=${res.status}`);
  check("totalRoutines 숫자", typeof data.totalRoutines === "number", `totalRoutines=${data.totalRoutines}`);
  check("routines 길이 ≤ 20 (D 결정 cap)", Array.isArray(data.routines) && data.routines.length <= 20, `len=${data.routines?.length}`);
  check("truncated 객체 존재 (모양 검증)", typeof data.truncated?.routines === "boolean" && typeof data.truncated?.ingredients === "boolean",
    `truncated=${JSON.stringify(data.truncated)}`);
  if (data.routines?.[0]) {
    const r0 = data.routines[0];
    check("routine.id 는 string", typeof r0.id === "string", `id=${r0.id}`);
    check("products[].source 는 외부 enum", r0.products.every(p => ["oliveyoung","enuri","daiso","custom"].includes(p.source)),
      `sources=${[...new Set(r0.products.map(p=>p.source))].join(",")}`);
    check("ingredients=false → 빈 배열", r0.products.every(p => Array.isArray(p.ingredients) && p.ingredients.length === 0),
      `lens=${r0.products.map(p=>p.ingredients?.length).join(",")}`);
  }
}

// 4. happy: includeIngredients=true → ingredients 채워짐
{
  const res = await call({ body: { includeIngredients: true }, userId: REAL_USER });
  const data = await res.json().catch(() => ({}));
  check("happy 200 (with ingredients)", res.status === 200, `status=${res.status}`);
  // 어떤 routine의 어떤 product에는 ingredients가 들어있어야
  const anyHas = data.routines?.some(r => r.products.some(p => p.ingredients && p.ingredients.length > 0));
  check("ingredients 채워진 product 존재", anyHas);
  // 30 cap 정상 (max 30)
  const allUnder30 = data.routines?.every(r => r.products.every(p => (p.ingredients?.length ?? 0) <= 30));
  check("ingredients ≤ 30 cap", allUnder30);
}

// 5. userPurpose sanitize 확인 (control char 제거, 길이 cap)
{
  const res = await call({ body: { includeIngredients: false }, userId: REAL_USER });
  const data = await res.json().catch(() => ({}));
  const allPurposes = data.routines?.flatMap(r => r.products.map(p => p.userPurpose)).filter(x => typeof x === "string");
  const hasCtrl = allPurposes?.some(s => /[\x00-\x08\x0b-\x1f\x7f]/.test(s));
  const overLimit = allPurposes?.some(s => s.length > 501); // 500 + ellipsis
  check("userPurpose에 control char 없음", !hasCtrl, `samples=${allPurposes?.length ?? 0}`);
  check("userPurpose 길이 ≤ 501", !overLimit);
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
