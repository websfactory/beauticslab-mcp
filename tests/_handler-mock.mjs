// auth/handler.ts 단위 검증 (mock KV + mock OAuthHelpers + mock signAssertion)
// /authorize → bridge redirect (KV에 worker_state 저장)
// /oauth/callback?assertion=...&state=... → KV pop → assertion verify → completeAuthorization → redirect

import { SignJWT, jwtVerify } from "jose";

const ASSERTION_KEY = "oyogO02H99jxHWApOCDCXyJWreogPputl+LS2xsj87s=";
const AUD = "https://mcp.beauticslab.com";
const enc = new TextEncoder();
// Node 22+ already has globalThis.crypto (webcrypto)

// ---- mock KV ----
function makeKV() {
  const store = new Map();
  return {
    store,
    async put(k, v, _opts) { store.set(k, v); },
    async get(k) { return store.get(k) ?? null; },
    async delete(k) { store.delete(k); },
  };
}

// ---- mock OAuthHelpers ----
function makeOAuthHelpers() {
  const completeArgs = [];
  return {
    completeArgs,
    async parseAuthRequest(req) {
      const url = new URL(req.url);
      return {
        responseType: url.searchParams.get("response_type") ?? "code",
        clientId: url.searchParams.get("client_id") ?? "client-x",
        redirectUri: url.searchParams.get("redirect_uri") ?? "https://client.example/cb",
        scope: ["mcp:read"],
        state: url.searchParams.get("state") ?? "client-state",
        codeChallenge: url.searchParams.get("code_challenge") ?? undefined,
        codeChallengeMethod: url.searchParams.get("code_challenge_method") ?? undefined,
      };
    },
    async completeAuthorization(opts) {
      completeArgs.push(opts);
      const u = new URL(opts.request.redirectUri);
      u.searchParams.set("code", "auth-code-xyz");
      if (opts.request.state) u.searchParams.set("state", opts.request.state);
      return { redirectTo: u.toString() };
    },
  };
}

// ---- handler logic mirror (auth/handler.ts) ----
const STATE_PREFIX = "mcp_state:";
const STATE_TTL_SEC = 600;

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
function bridgeUrl(env) { return env.BRIDGE_URL; }
function clientErrorRedirect(authReq, code, desc) {
  const u = new URL(authReq.redirectUri);
  u.searchParams.set("error", code);
  u.searchParams.set("error_description", desc);
  if (authReq.state) u.searchParams.set("state", authReq.state);
  return Response.redirect(u.toString(), 302);
}
async function verifyAssertion({ jwt, expectedState, verifyKey }) {
  const k = enc.encode(verifyKey);
  let payload;
  try {
    const v = await jwtVerify(jwt, k, { algorithms: ["HS256"], audience: AUD });
    payload = v.payload;
  } catch (err) {
    if (err?.code === "ERR_JWT_EXPIRED") return { ok: false, error: "expired_assertion" };
    if (err?.code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && err.claim === "aud") return { ok: false, error: "invalid_audience" };
    return { ok: false, error: "invalid_assertion" };
  }
  const { sub, email, aud, exp, state } = payload;
  if (typeof sub !== "string" || typeof email !== "string" || typeof aud !== "string" ||
      typeof exp !== "number" || typeof state !== "string") return { ok: false, error: "missing_claims" };
  if (state !== expectedState) return { ok: false, error: "state_mismatch" };
  return { ok: true, payload: { sub, email, aud, exp, state } };
}

async function handle(req, env) {
  const url = new URL(req.url);
  if (url.pathname === "/authorize") {
    const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(req);
    const ws = randomToken();
    await env.OAUTH_KV.put(STATE_PREFIX + ws, JSON.stringify({ authRequest, createdAt: Date.now() }), { expirationTtl: STATE_TTL_SEC });
    const u = new URL(bridgeUrl(env));
    u.searchParams.set("worker_state", ws);
    u.searchParams.set("return_to", `${env.CALLBACK_BASE.replace(/\/$/,"")}/oauth/callback`);
    return Response.redirect(u.toString(), 302);
  }
  if (url.pathname === "/oauth/callback") {
    const assertion = url.searchParams.get("assertion");
    const state = url.searchParams.get("state");
    const errParam = url.searchParams.get("error");
    if (!state) return new Response("missing state", { status: 400 });
    const recordRaw = await env.OAUTH_KV.get(STATE_PREFIX + state);
    if (!recordRaw) return new Response("expired", { status: 400 });
    await env.OAUTH_KV.delete(STATE_PREFIX + state);
    const record = JSON.parse(recordRaw);
    if (errParam) {
      if (errParam === "access_denied") return clientErrorRedirect(record.authRequest, "access_denied", "denied");
      return clientErrorRedirect(record.authRequest, "invalid_request", "unexpected error param");
    }
    if (!assertion) return clientErrorRedirect(record.authRequest, "invalid_request", "no assertion");
    const r = await verifyAssertion({ jwt: assertion, expectedState: state, verifyKey: env.ASSERTION_VERIFY_KEY });
    if (!r.ok) return clientErrorRedirect(record.authRequest, "access_denied", "verify failed");
    const props = { userId: r.payload.sub, email: r.payload.email };
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: record.authRequest,
      userId: props.userId,
      scope: ["mcp:read"],
      metadata: { email: props.email },
      props,
    });
    return Response.redirect(redirectTo, 302);
  }
  return new Response("Not Found", { status: 404 });
}

// ---- helpers ----
async function signAss({ userId, email, state, expSec = 300, audience = AUD }) {
  return await new SignJWT({ email, state })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId).setAudience(audience).setExpirationTime(`${expSec}s`)
    .sign(enc.encode(ASSERTION_KEY));
}
function makeEnv() {
  return {
    NEXTJS_INTERNAL_BASE_URL: "http://localhost:3000",
    BRIDGE_URL: "http://localhost:3000/oauth/mcp-bridge",
    CALLBACK_BASE: "http://localhost:8788",
    ASSERTION_VERIFY_KEY: ASSERTION_KEY,
    OAUTH_KV: makeKV(),
    OAUTH_PROVIDER: makeOAuthHelpers(),
  };
}

let pass = 0, fail = 0;
const check = (n, c, d = "") => { console.log(`${c?"✅":"❌"} ${n}${d?" — "+d:""}`); c?pass++:fail++; };

// ---- 1. /authorize → bridge redirect, KV에 state 저장 ----
{
  const env = makeEnv();
  const req = new Request("http://localhost:8788/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&state=client-st&code_challenge=cc&code_challenge_method=S256");
  const res = await handle(req, env);
  check("authorize → 302", res.status === 302);
  const loc = res.headers.get("location");
  const u = new URL(loc);
  check("location → bridge URL", u.origin === "http://localhost:3000" && u.pathname === "/oauth/mcp-bridge");
  const ws = u.searchParams.get("worker_state");
  const rt = u.searchParams.get("return_to");
  check("worker_state 발급", typeof ws === "string" && ws.length > 20, `len=${ws?.length}`);
  check("return_to = origin/oauth/callback", rt === "http://localhost:8788/oauth/callback", `rt=${rt}`);
  check("KV에 state 저장됨", env.OAUTH_KV.store.has("mcp_state:" + ws));
  // store the ws for next test
  globalThis._lastWs = ws;
  globalThis._lastEnv = env;
}

// ---- 2. /oauth/callback happy ----
{
  const env = makeEnv();
  // 먼저 authorize로 state 발급
  const r0 = await handle(new Request("http://localhost:8788/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&state=client-st"), env);
  const ws = new URL(r0.headers.get("location")).searchParams.get("worker_state");
  const jwt = await signAss({ userId: "user-abc", email: "u@e.com", state: ws });
  const cb = new Request(`http://localhost:8788/oauth/callback?assertion=${encodeURIComponent(jwt)}&state=${ws}`);
  const res = await handle(cb, env);
  check("callback happy → 302", res.status === 302);
  const loc = new URL(res.headers.get("location"));
  check("redirect는 클라이언트 redirect_uri", loc.origin === "https://client.example" && loc.pathname === "/cb",
    `loc=${loc.toString()}`);
  check("redirect에 code 포함", loc.searchParams.get("code") === "auth-code-xyz");
  check("completeAuthorization 호출됨", env.OAUTH_PROVIDER.completeArgs.length === 1);
  const args = env.OAUTH_PROVIDER.completeArgs[0];
  check("props.userId 정확히 전달", args?.props?.userId === "user-abc");
  check("props.email 정확히 전달", args?.props?.email === "u@e.com");
  check("scope = mcp:read", JSON.stringify(args?.scope) === JSON.stringify(["mcp:read"]));
  check("KV state 단일 사용 (삭제됨)", !env.OAUTH_KV.store.has("mcp_state:" + ws));
}

// ---- 3. callback - state 만료/없음 ----
{
  const env = makeEnv();
  const cb = new Request(`http://localhost:8788/oauth/callback?assertion=x&state=nonexistent`);
  const res = await handle(cb, env);
  check("missing state record → 400", res.status === 400);
}

// ---- 4. callback - state 재사용 시도 ----
{
  const env = makeEnv();
  const r0 = await handle(new Request("http://localhost:8788/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&state=cs"), env);
  const ws = new URL(r0.headers.get("location")).searchParams.get("worker_state");
  const jwt = await signAss({ userId: "u", email: "u@e", state: ws });
  await handle(new Request(`http://localhost:8788/oauth/callback?assertion=${encodeURIComponent(jwt)}&state=${ws}`), env);
  // 두 번째 호출
  const res2 = await handle(new Request(`http://localhost:8788/oauth/callback?assertion=${encodeURIComponent(jwt)}&state=${ws}`), env);
  check("state 재사용 → 400", res2.status === 400);
}

// ---- 5. callback - assertion state mismatch ----
{
  const env = makeEnv();
  const r0 = await handle(new Request("http://localhost:8788/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&state=cs"), env);
  const ws = new URL(r0.headers.get("location")).searchParams.get("worker_state");
  const wrongState = randomToken();
  const jwt = await signAss({ userId: "u", email: "u@e", state: wrongState });
  const res = await handle(new Request(`http://localhost:8788/oauth/callback?assertion=${encodeURIComponent(jwt)}&state=${ws}`), env);
  check("state mismatch → client redirect with error", res.status === 302);
  const loc = new URL(res.headers.get("location"));
  check("error=access_denied", loc.searchParams.get("error") === "access_denied");
  check("KV state 단일사용 (검증 실패해도 삭제)", !env.OAUTH_KV.store.has("mcp_state:" + ws));
}

// ---- 6. callback - 사용자 거부 (?error=access_denied 동반) ----
{
  const env = makeEnv();
  const r0 = await handle(new Request("http://localhost:8788/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&state=cs"), env);
  const ws = new URL(r0.headers.get("location")).searchParams.get("worker_state");
  const res = await handle(new Request(`http://localhost:8788/oauth/callback?error=access_denied&state=${ws}`), env);
  check("user denied → 302 with error", res.status === 302);
  const loc = new URL(res.headers.get("location"));
  check("error=access_denied 그대로 클라이언트로", loc.searchParams.get("error") === "access_denied");
  check("client state 그대로", loc.searchParams.get("state") === "cs");
  check("completeAuthorization 호출 안 됨", env.OAUTH_PROVIDER.completeArgs.length === 0);
}

// ---- 7. callback - tampered assertion ----
{
  const env = makeEnv();
  const r0 = await handle(new Request("http://localhost:8788/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&state=cs"), env);
  const ws = new URL(r0.headers.get("location")).searchParams.get("worker_state");
  const jwt = await signAss({ userId: "u", email: "u@e", state: ws });
  const tamper = jwt.slice(0, -1) + (jwt.slice(-1) === "A" ? "B" : "A");
  const res = await handle(new Request(`http://localhost:8788/oauth/callback?assertion=${encodeURIComponent(tamper)}&state=${ws}`), env);
  check("tampered → access_denied redirect", res.status === 302 && new URL(res.headers.get("location")).searchParams.get("error") === "access_denied");
}

// ---- 8. unknown path → 404 ----
{
  const env = makeEnv();
  const res = await handle(new Request("http://localhost:8788/foo"), env);
  check("unknown path → 404", res.status === 404);
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
