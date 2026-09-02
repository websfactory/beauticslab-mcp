// Next.js → Worker 내부 API. 사용자가 자기 연결(grant)을 보고 끊게 하기 위한 것.
//
// 배경: 동의 화면은 "연결 해제는 설정에서 가능합니다"라고 약속했지만 그 화면이 없었다.
// 인가서버가 발급한 refresh token 은 Next.js 세션과 무관하므로 비밀번호를 바꿔도 끊기지 않는다.
// grant 목록·철회는 OAuthHelpers 가 이미 제공하므로 Worker 쪽에 얇은 창구만 낸다.
//
// 인증: Worker→Next.js 와 같은 HMAC canonical 5라인을 방향만 바꿔 재사용한다.
// (counterpart: beauticslab/src/lib/mcp/worker-client.ts)
// 여기서 userId 는 헤더로 오는 자기신고값이 아니라 서명 대상에 포함된 값이다.
// 즉 서명이 맞다는 것은 "Next.js 가 이 userId 로 요청했다"를 뜻하고,
// Next.js 는 그 값을 next-auth 세션에서만 채운다.

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../index.js";
import { buildCanonical, signCanonical } from "../mcp/api-client.js";

const TIMESTAMP_SKEW_MS = 60_000;
const MAX_GRANTS = 100;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// 길이가 같을 때만 의미 있는 상수시간 비교. hex 문자열 전제.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type VerifiedRequest = { ok: true; userId: string; body: unknown } | { ok: false; res: Response };

async function verifyInternalRequest(req: Request, env: Env): Promise<VerifiedRequest> {
  if (req.method !== "POST") {
    return { ok: false, res: json(405, { error: "method_not_allowed" }) };
  }

  const auth = req.headers.get("authorization");
  const ts = req.headers.get("x-mcp-timestamp");
  const userId = req.headers.get("x-mcp-user-id");

  if (!auth || !auth.startsWith("HMAC ")) return { ok: false, res: json(401, { error: "unauthorized" }) };
  if (!ts) return { ok: false, res: json(401, { error: "unauthorized" }) };
  if (!userId) return { ok: false, res: json(401, { error: "unauthorized" }) };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > TIMESTAMP_SKEW_MS) {
    return { ok: false, res: json(401, { error: "unauthorized" }) };
  }

  const presented = auth.slice("HMAC ".length).trim();
  if (!/^[0-9a-f]+$/.test(presented)) return { ok: false, res: json(401, { error: "unauthorized" }) };

  const bodyBytes = new Uint8Array(await req.arrayBuffer());
  const url = new URL(req.url);
  const canonical = await buildCanonical({
    method: req.method,
    pathWithQuery: url.pathname + url.search,
    timestamp: ts,
    userId,
    bodyBytes,
  });
  const expected = await signCanonical(canonical, env.INTERNAL_HMAC_KEY);
  if (!timingSafeEqualHex(presented, expected)) {
    return { ok: false, res: json(401, { error: "unauthorized" }) };
  }

  let body: unknown = {};
  if (bodyBytes.length > 0) {
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return { ok: false, res: json(400, { error: "invalid_json" }) };
    }
  }
  return { ok: true, userId, body };
}

export async function handleGrantsList(
  req: Request,
  env: Env & { OAUTH_PROVIDER: OAuthHelpers },
): Promise<Response> {
  const v = await verifyInternalRequest(req, env);
  if (!v.ok) return v.res;

  const result = await env.OAUTH_PROVIDER.listUserGrants(v.userId, { limit: MAX_GRANTS });

  // 화면에 띄울 이름은 grant 가 아니라 클라이언트 레코드에 있다. 같은 클라이언트는 한 번만 조회.
  const nameCache = new Map<string, string | undefined>();
  const items = [];
  for (const g of result.items) {
    if (!nameCache.has(g.clientId)) {
      let clientName: string | undefined;
      try {
        const c = await env.OAUTH_PROVIDER.lookupClient(g.clientId);
        clientName = c?.clientName;
      } catch {
        // CIMD 문서 fetch 실패 등. 이름 없이 보여준다.
        clientName = undefined;
      }
      nameCache.set(g.clientId, clientName);
    }
    items.push({
      id: g.id,
      clientId: g.clientId,
      clientName: nameCache.get(g.clientId) ?? null,
      // client_id 가 https URL 이면 CIMD 클라이언트다(신원이 도메인으로 드러난다).
      verified: g.clientId.startsWith("https://"),
      scope: g.scope,
      createdAt: g.createdAt,
      expiresAt: g.expiresAt ?? null,
      redirectUri: g.redirectUri ?? null,
    });
  }

  return json(200, { items, truncated: Boolean(result.cursor) });
}

export async function handleGrantsRevoke(
  req: Request,
  env: Env & { OAUTH_PROVIDER: OAuthHelpers },
): Promise<Response> {
  const v = await verifyInternalRequest(req, env);
  if (!v.ok) return v.res;

  const grantId = (v.body as { grantId?: unknown } | null)?.grantId;
  if (typeof grantId !== "string" || grantId.length === 0) {
    return json(400, { error: "invalid_request" });
  }

  // revokeGrant 는 userId 로 소유권을 확인한다. 남의 grant 는 지워지지 않는다.
  await env.OAUTH_PROVIDER.revokeGrant(grantId, v.userId);
  return json(200, { ok: true });
}
