import OAuthProvider from "@cloudflare/workers-oauth-provider";
import type { ClientRegistrationCallbackOptions, ClientRegistrationCallbackResult } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { registerTools } from "./tools/index.js";
import { defaultHandler } from "./auth/handler.js";

// Props injected by OAuth flow. See DESIGN.md §4.3.
// OAuth 인증 단일 모드 — apiHandler 진입 시 props 항상 존재.
export type Props = {
  userId: string;
  email: string;
};

// Worker bindings. See wrangler.jsonc.
export type Env = {
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
  // /register 요청량 제한 (wrangler.jsonc 의 ratelimits 바인딩).
  REGISTER_LIMITER: RateLimit;
  ASSERTION_VERIFY_KEY: string;
  INTERNAL_HMAC_KEY: string;
  NEXTJS_INTERNAL_BASE_URL: string;
  // OAuth bridge 흐름 (handler.ts).
  // BRIDGE_URL: Next.js의 동의 페이지 절대 URL (예: https://beauticslab.com/oauth/mcp-bridge, dev: http://localhost:3000/oauth/mcp-bridge)
  BRIDGE_URL: string;
  // CALLBACK_BASE: Worker의 공개 origin (예: https://mcp.beauticslab.com, dev: http://localhost:8791).
  // /oauth/callback이 이 origin 하위로 호스팅되며 Next.js MCP_WORKER_CALLBACK_URL과 exact-match 일치해야 함.
  CALLBACK_BASE: string;
};

export class BeauticsLabMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "beauticslab",
    version: "0.0.1",
  });

  async init() {
    // OAuth 인증 단일 모드 — apiRoute 게이트 통과 후에만 init() 호출되므로 props 항상 존재 (DESIGN §7).
    // McpAgent 베이스 타입은 Props|undefined이나 우리는 OAuth 전제라 좁힘.
    registerTools(this.server, this.env, this.props as Props);
  }
}

// loopback은 네이티브 MCP 클라이언트(데스크톱 앱·CLI)의 표준 redirect라 http를 허용해야 한다.
// RFC 8252 §7.3.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

// 등록 정책 훅 (v0.8.0~).
// DCR 자체는 열어 둔다. 닫으면 Claude·ChatGPT 등 사전관계 없는 클라이언트가 붙지 못해
// 원격 MCP 서버의 존재 이유가 사라진다(MCP 2026-07-28 client-registration 참조).
// 대신 등록 단계에서 명백히 위험하거나 비정상인 메타데이터만 걷어낸다.
function clientRegistrationCallback(
  options: ClientRegistrationCallbackOptions,
): ClientRegistrationCallbackResult | void {
  const md = options.clientMetadata;

  const name = md.client_name;
  if (typeof name === "string" && name.length > 200) {
    return { description: "client_name이 너무 깁니다 (최대 200자)." };
  }

  const uris = md.redirect_uris;
  if (!Array.isArray(uris)) return; // 라이브러리가 필수 검증을 이미 수행한다.
  if (uris.length > 10) {
    return { description: "redirect_uris는 최대 10개까지 등록할 수 있습니다." };
  }

  for (const raw of uris) {
    if (typeof raw !== "string") continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return { description: `redirect_uri를 해석할 수 없습니다: ${raw}` };
    }
    // 평문 http로 인가코드를 돌려주면 경로상에서 코드가 노출된다. loopback만 예외.
    if (u.protocol === "http:" && !LOOPBACK_HOSTS.has(u.hostname)) {
      return {
        description: "redirect_uri에 평문 http는 loopback(127.0.0.1, ::1, localhost)에만 허용됩니다.",
      };
    }
    // 브라우저에서 스크립트로 실행되거나 인라인 문서로 열리는 스킴은 인가코드 전달에 쓸 수 없다.
    if (u.protocol === "javascript:" || u.protocol === "data:" || u.protocol === "vbscript:") {
      return { description: `허용되지 않는 redirect_uri 스킴입니다: ${u.protocol}` };
    }
  }
}

// OAuth + MCP entrypoint. Pattern: cloudflare/ai/demos/remote-mcp-github-oauth/src/index.ts.
// See DESIGN.md 부록 C for reference log.
const provider = new OAuthProvider({
  apiHandler: BeauticsLabMCP.serve("/mcp") as any,
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  // DCR은 CIMD 미지원 클라이언트를 위한 하위호환으로 남긴다 (MCP 2026-07-28에서 deprecated).
  clientRegistrationEndpoint: "/register",
  // CIMD: client_id가 클라이언트 소유 https 문서 URL이 되어 동의 화면에 검증된 도메인을 띄울 수 있다.
  // 'global_fetch_strictly_public' 컴패트 플래그 필수 (wrangler.jsonc). 없으면 생성자가 throw한다.
  clientIdMetadataDocumentEnabled: true,
  // PKCE plain은 code_challenge를 그대로 노출해 보호 효과가 없다. S256만 허용.
  allowPlainPKCE: false,
  clientRegistrationCallback,
  defaultHandler: defaultHandler as any,
  scopesSupported: ["mcp:read"],
});

// 등록 요청량 제한을 provider 앞단에서 건다.
// clientRegistrationCallback 에는 env 가 주입되지 않아 바인딩을 쓸 수 없다.
// provider.fetch 는 공개 메서드이므로 한 겹 감싸는 쪽이 유일하고 단순한 방법이다.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === "/register") {
      // Cloudflare 가 채우는 헤더라 클라이언트가 위조할 수 없다.
      // 없을 때(로컬 dev 등)는 제한을 걸지 않는다 — 모든 요청이 한 키로 뭉쳐
      // 서로를 막는 것이 남용을 막는 것보다 해롭다.
      //
      // ★이 API 는 정확한 차단기가 아니다. 운영 실측(2026-09-02):
      //   동시 50 x 200건 -> 153건 중 101건 차단 / 초당 1건 90초 -> 90건 중 62건 차단
      //   그러나 최초 수십 건은 그대로 통과한다(카운터가 머신 로컬 캐시라 초기 undercount).
      //   Cloudflare 문서도 "permissive, eventually consistent, 정확한 계수용 아님"이라 명시한다.
      //   목적은 하드 캡이 아니라 지속적 남용의 감쇄다 — KV 하루 쓰기 한도를 지키는 것이 목표다.
      const ip = request.headers.get("cf-connecting-ip");
      if (ip) {
        const { success } = await env.REGISTER_LIMITER.limit({ key: ip });
        if (!success) {
          return new Response(
            JSON.stringify({
              error: "temporarily_unavailable",
              error_description: "등록 요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.",
            }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "cache-control": "no-store",
                "retry-after": "60",
              },
            },
          );
        }
      }
    }
    return provider.fetch(request, env, ctx);
  },
};
