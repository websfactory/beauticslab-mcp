import OAuthProvider from "@cloudflare/workers-oauth-provider";
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

// OAuth + MCP entrypoint. Pattern: cloudflare/ai/demos/remote-mcp-github-oauth/src/index.ts.
// See DESIGN.md 부록 C for reference log.
export default new OAuthProvider({
  apiHandler: BeauticsLabMCP.serve("/mcp") as any,
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  // DCR only for v1. CIMD deferred to v1.x. See DESIGN §10.7.
  clientRegistrationEndpoint: "/register",
  defaultHandler: defaultHandler as any,
  scopesSupported: ["mcp:read"],
});
