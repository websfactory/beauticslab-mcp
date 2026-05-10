// OAuth defaultHandler.
// 비-API 요청(즉 OAuth bridge 흐름) 처리: /authorize → beauticslab.com/oauth/mcp-bridge로 redirect,
// /oauth/callback?assertion=... → assertion 검증 → workers-oauth-provider completeAuthorization → 클라이언트 redirect.
// DESIGN.md §3.1 Step 5~7.

import type { ExportedHandler } from "@cloudflare/workers-types";
import type { OAuthHelpers, AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env, Props } from "../index.js";
import { verifyAssertion } from "./assertion-verify.js";

const STATE_TTL_SEC = 600; // 10분 — bridge 흐름 단일 사용
const STATE_PREFIX = "mcp_state:";
const SCOPE = ["mcp:read"];

type StateRecord = {
  authRequest: AuthRequest;
  createdAt: number;
};

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

async function handleAuthorize(req: Request, env: Env & { OAUTH_PROVIDER: OAuthHelpers }): Promise<Response> {
  let authRequest: AuthRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(req);
  } catch (err) {
    console.error("parseAuthRequest failed", err);
    return htmlError(400, "잘못된 요청", "OAuth 인가 요청을 해석할 수 없습니다.");
  }

  // worker_state 발급 + AuthRequest를 KV에 저장 (단일 사용, 10분 TTL).
  const workerState = randomToken();
  const record: StateRecord = { authRequest, createdAt: Date.now() };
  await env.OAUTH_KV.put(STATE_PREFIX + workerState, JSON.stringify(record), {
    expirationTtl: STATE_TTL_SEC,
  });

  // bridge로 redirect. return_to는 명시 ENV의 callback base 사용 (Next.js exact-match와 일치 필수).
  const returnTo = `${env.CALLBACK_BASE.replace(/\/$/, "")}/oauth/callback`;
  const url = new URL(env.BRIDGE_URL);
  url.searchParams.set("worker_state", workerState);
  url.searchParams.set("return_to", returnTo);
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
    return new Response("Not Found", { status: 404 });
  },
};
