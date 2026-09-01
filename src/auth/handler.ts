// OAuth defaultHandler.
// 비-API 요청(즉 OAuth bridge 흐름) 처리: /authorize → beauticslab.com/oauth/mcp-bridge로 redirect,
// /oauth/callback?assertion=... → assertion 검증 → workers-oauth-provider completeAuthorization → 클라이언트 redirect.
// DESIGN.md §3.1 Step 5~7.
//
// [2026-09-02] 동의 화면 클라이언트 신원 표시.
// 종전에는 어떤 클라이언트가 인가를 요청했는지 bridge가 알 수 없어, 화면이 고정 문구만 띄웠다.
// 열린 DCR 특성상 누구나 클라이언트를 등록할 수 있으므로 사용자가 정상 클라이언트와
// 공격자 클라이언트를 구별할 방법이 없었다. 이제 Worker가 클라이언트 신원을 조회해
// INTERNAL_HMAC_KEY로 서명한 client_ctx JWT로 bridge에 넘긴다.
// 쿼리 평문으로 넘기면 공격자가 자기 worker_state에 남의 이름을 붙여 재조립할 수 있어 서명이 필수다.

import type { ExportedHandler } from "@cloudflare/workers-types";
import type { OAuthHelpers, AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";
import { AuthorizationError } from "@cloudflare/workers-oauth-provider";
import { SignJWT } from "jose";
import type { Env, Props } from "../index.js";
import { verifyAssertion } from "./assertion-verify.js";
import { serveServerCard } from "../well-known.js";
import { handleGrantsList, handleGrantsRevoke } from "./grants-api.js";

const STATE_TTL_SEC = 600; // 10분 — bridge 흐름 단일 사용
const STATE_PREFIX = "mcp_state:";
const SCOPE = ["mcp:read"];

// client_ctx JWT. state와 같은 수명(10분)을 쓰고 audience로 용도를 고정한다.
const CLIENT_CTX_TTL_SEC = STATE_TTL_SEC;
const CLIENT_CTX_AUDIENCE = "beauticslab-mcp-bridge";

type StateRecord = {
  authRequest: AuthRequest;
  createdAt: number;
};

// bridge 동의 화면이 표시할 클라이언트 신원.
// kind: cimd = client_id가 클라이언트 소유 https 문서 URL이라 도메인으로 신원이 드러남(2026-07-28 규격 권장).
//       dcr  = 익명 등록. 신원이 자기신고값이라 신뢰할 수 없다.
//       unknown = 조회 실패(CIMD fetch 실패 등).
type ClientCtxKind = "cimd" | "dcr" | "unknown";

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function htmlError(status: number, title: string, detail: string): Response {
  const body = `<!doctype html><meta charset=utf-8><title>${title}</title>
<h1>${title}</h1><p>${detail}</p>`;
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

// 클라이언트 redirect_uri로 OAuth 에러 redirect (인가 실패 통상 흐름).
function clientErrorRedirect(authRequest: AuthRequest, errorCode: string, description: string): Response {
  const url = new URL(authRequest.redirectUri);
  url.searchParams.set("error", errorCode);
  url.searchParams.set("error_description", description);
  if (authRequest.state) url.searchParams.set("state", authRequest.state);
  return Response.redirect(url.toString(), 302);
}

// CIMD client_id는 https URL이다(draft-ietf-oauth-client-id-metadata-document-00 §4).
// DCR이 발급하는 client_id는 랜덤 문자열이라 절대 URL이 되지 않는다.
function isCimdClientId(clientId: string): boolean {
  return clientId.startsWith("https://");
}

// 표시용으로만 쓰는 값이므로 길이를 잘라 화면 붕괴·과도한 JWT 크기를 막는다.
function clip(v: string | undefined, max: number): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) + "…" : s;
}

async function signClientCtx(
  env: Env,
  payload: {
    state: string;
    kind: ClientCtxKind;
    clientId: string;
    clientName?: string;
    clientUri?: string;
    redirectUri: string;
  },
): Promise<string> {
  const key = new TextEncoder().encode(env.INTERNAL_HMAC_KEY);
  return await new SignJWT({
    kind: payload.kind,
    client_id: clip(payload.clientId, 512),
    client_name: clip(payload.clientName, 120),
    client_uri: clip(payload.clientUri, 512),
    redirect_uri: clip(payload.redirectUri, 512),
    state: payload.state,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(CLIENT_CTX_AUDIENCE)
    .setExpirationTime(`${CLIENT_CTX_TTL_SEC}s`)
    .sign(key);
}

async function handleAuthorize(req: Request, env: Env & { OAUTH_PROVIDER: OAuthHelpers }): Promise<Response> {
  let authRequest: AuthRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(req);
  } catch (err) {
    // v0.10.0부터 예상 가능한 인가요청 오류는 AuthorizationError로 던져진다.
    // redirectUri는 클라이언트 등록정보와 exact-match 검증을 통과한 경우에만 채워지므로,
    // 채워져 있을 때만 OAuth 에러 redirect가 안전하다. 그 외는 로컬 렌더.
    if (err instanceof AuthorizationError && err.redirectUri) {
      const url = new URL(err.redirectUri);
      url.searchParams.set("error", err.code);
      url.searchParams.set("error_description", err.description);
      if (err.state) url.searchParams.set("state", err.state);
      if (err.issuer) url.searchParams.set("iss", err.issuer); // RFC 9207
      return Response.redirect(url.toString(), 302);
    }
    console.error("parseAuthRequest failed", err);
    return htmlError(400, "잘못된 요청", "OAuth 인가 요청을 해석할 수 없습니다.");
  }

  // 동의 화면에 띄울 클라이언트 신원 조회.
  // CIMD 문서 fetch 실패는 CimdFetchError로 throw되므로(v0.9.0) 삼켜서 unknown으로 낮춘다.
  // 여기서 인가를 막지는 않는다. 판단은 화면을 보는 사용자가 한다.
  let client: ClientInfo | null = null;
  try {
    client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  } catch (err) {
    console.error("lookupClient failed", { clientId: authRequest.clientId, err });
  }

  const kind: ClientCtxKind = !client
    ? "unknown"
    : isCimdClientId(authRequest.clientId)
      ? "cimd"
      : "dcr";

  // worker_state 발급 + AuthRequest를 KV에 저장 (단일 사용, 10분 TTL).
  const workerState = randomToken();
  const record: StateRecord = { authRequest, createdAt: Date.now() };
  await env.OAUTH_KV.put(STATE_PREFIX + workerState, JSON.stringify(record), {
    expirationTtl: STATE_TTL_SEC,
  });

  const clientCtx = await signClientCtx(env, {
    state: workerState,
    kind,
    clientId: authRequest.clientId,
    clientName: client?.clientName,
    clientUri: client?.clientUri,
    redirectUri: authRequest.redirectUri,
  });

  // bridge로 redirect. return_to는 명시 ENV의 callback base 사용 (Next.js exact-match와 일치 필수).
  const returnTo = `${env.CALLBACK_BASE.replace(/\/$/, "")}/oauth/callback`;
  const url = new URL(env.BRIDGE_URL);
  url.searchParams.set("worker_state", workerState);
  url.searchParams.set("return_to", returnTo);
  url.searchParams.set("client_ctx", clientCtx);
  return Response.redirect(url.toString(), 302);
}

async function handleCallback(req: Request, env: Env & { OAUTH_PROVIDER: OAuthHelpers }): Promise<Response> {
  const url = new URL(req.url);
  const assertion = url.searchParams.get("assertion");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (!state) {
    return htmlError(400, "잘못된 요청", "state 파라미터가 없습니다.");
  }

  // 단일 사용: 어느 케이스든 즉시 KV 레코드 제거.
  const stateKey = STATE_PREFIX + state;
  const recordRaw = await env.OAUTH_KV.get(stateKey);
  if (!recordRaw) {
    return htmlError(400, "세션 만료", "인증 요청이 만료되었거나 이미 사용되었습니다. 다시 시도해주세요.");
  }
  await env.OAUTH_KV.delete(stateKey);

  let record: StateRecord;
  try {
    record = JSON.parse(recordRaw) as StateRecord;
  } catch {
    return htmlError(500, "내부 오류", "저장된 인증 요청을 해석할 수 없습니다.");
  }

  // bridge가 사용자 거부 시에만 ?error=access_denied로 도달. 그 외 error 값은 비정상 흐름이므로 invalid_request로 좁힘.
  if (error) {
    if (error === "access_denied") {
      return clientErrorRedirect(record.authRequest, "access_denied", "사용자가 권한 부여를 거부했습니다.");
    }
    return clientErrorRedirect(record.authRequest, "invalid_request", "예상치 못한 오류 파라미터를 받았습니다.");
  }

  if (!assertion) {
    return clientErrorRedirect(record.authRequest, "invalid_request", "assertion이 없습니다.");
  }

  const r = await verifyAssertion({
    jwt: assertion,
    expectedState: state,
    verifyKey: env.ASSERTION_VERIFY_KEY,
  });
  if (!r.ok) {
    console.error("assertion verify failed", { error: r.error });
    return clientErrorRedirect(
      record.authRequest,
      "access_denied",
      "세션이 만료되었거나 인증에 실패했습니다. 다시 시도해주세요.",
    );
  }

  const props: Props = { userId: r.payload.sub, email: r.payload.email };

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: record.authRequest,
    userId: props.userId,
    scope: SCOPE,
    metadata: { email: props.email },
    props,
  });
  return Response.redirect(redirectTo, 302);
}

export const defaultHandler: ExportedHandler<Env & { OAUTH_PROVIDER: OAuthHelpers }> = {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/authorize") return handleAuthorize(request, env);
    if (url.pathname === "/oauth/callback") return handleCallback(request, env);
    if (url.pathname === "/.well-known/mcp/server-card.json") return serveServerCard();
    // Next.js 설정화면이 호출하는 내부 API (HMAC 인증). grants-api.ts 참조.
    if (url.pathname === "/internal/grants/list") return handleGrantsList(request, env);
    if (url.pathname === "/internal/grants/revoke") return handleGrantsRevoke(request, env);
    return new Response("Not Found", { status: 404 });
  },
};
