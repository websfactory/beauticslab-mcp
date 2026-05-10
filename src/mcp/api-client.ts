// Worker → Next.js 내부 라우트 HMAC 서명 fetch 클라이언트.
// Counterpart: beauticslab/src/lib/mcp/hmac.ts (verifyMcpHmac, buildCanonical, signCanonical).
// nextjs-integration.md §3.2~§3.3 — canonical 5라인, USER_ID 포함(N7).
// OAuth 인증 단일 모드 — userId는 타입 레벨에서 required. 단일 모드 invariant를 타입으로 강제해 stale 호출 차단.

const enc = new TextEncoder();

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bufToHex(new Uint8Array(digest));
}

function bufToHex(buf: Uint8Array): string {
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function buildCanonical(args: {
  method: string;
  pathWithQuery: string;
  timestamp: string;
  userId: string; // OAuth userId. 단일 모드 invariant — 정상 흐름에서 항상 채워짐
  bodyBytes: Uint8Array;
}): Promise<string> {
  const bodyHashHex = await sha256Hex(args.bodyBytes);
  return [
    args.method.toUpperCase(),
    args.pathWithQuery,
    args.timestamp,
    args.userId,
    bodyHashHex,
  ].join("\n");
}

export async function signCanonical(canonical: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(canonical));
  return bufToHex(new Uint8Array(sig));
}

export type CallInternalOptions = {
  method?: "POST"; // v1은 POST만
  path: string;    // 예: "/api/internal/mcp/search-product" (query 포함 가능)
  body: unknown;   // JSON-serializable
  userId: string;  // OAuth userId. 단일 모드 invariant — 타입 레벨 required (stale 호출 차단). 빈 문자열도 invariant 위반으로 throw
};

export type CallInternalDeps = {
  baseUrl: string;     // env.NEXTJS_INTERNAL_BASE_URL
  hmacKey: string;     // env.INTERNAL_HMAC_KEY
  fetchImpl?: typeof fetch; // 테스트 주입용
  nowMs?: () => number;     // 테스트 주입용
};

export async function callInternal(
  opts: CallInternalOptions,
  deps: CallInternalDeps,
): Promise<Response> {
  if (!deps.hmacKey || deps.hmacKey.length < 32) {
    throw new Error("INTERNAL_HMAC_KEY missing or too short (need ≥32 chars)");
  }
  // SSRF/signed-request-oracle 차단: path는 absolute("/"로 시작), origin은 baseUrl과 동일해야 함.
  // canonical에 host가 안 들어가므로 path가 다른 origin으로 새면 공격자가 유효 서명 받음.
  if (typeof opts.path !== "string" || !opts.path.startsWith("/")) {
    throw new Error("callInternal: path must be absolute (start with '/')");
  }
  if (opts.body === undefined || opts.body === null || typeof opts.body !== "object") {
    throw new Error("callInternal: body must be a JSON object/array");
  }
  if (typeof opts.userId !== "string" || opts.userId.length === 0) {
    throw new Error("callInternal: userId required (OAuth single-mode invariant)");
  }

  const method = opts.method ?? "POST";
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.nowMs ?? (() => Date.now());

  const baseOrigin = new URL(deps.baseUrl).origin;
  const url = new URL(opts.path, deps.baseUrl);
  if (url.origin !== baseOrigin) {
    throw new Error("callInternal: path must not change origin");
  }
  const pathWithQuery = url.pathname + url.search;
  const bodyBytes = enc.encode(JSON.stringify(opts.body));
  const timestamp = String(now());

  const canonical = await buildCanonical({
    method,
    pathWithQuery,
    timestamp,
    userId: opts.userId,
    bodyBytes,
  });
  const signature = await signCanonical(canonical, deps.hmacKey);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `HMAC ${signature}`,
    "x-mcp-timestamp": timestamp,
    "x-mcp-user-id": opts.userId,
  };

  return await fetchImpl(url.toString(), {
    method,
    headers,
    body: bodyBytes,
  });
}
