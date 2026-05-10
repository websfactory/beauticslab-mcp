// Tool 등록. OAuth 인증 단일 모드 (DESIGN §7).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env, Props } from "../index.js";
import { registerSearchProduct } from "./search-product.js";
import { registerGetMyRoutine } from "./authed/get-my-routine.js";

/**
 * server에 v1 tool들을 등록한다 (search_product + get_my_routine).
 * McpAgent.init() 안에서 1회 호출. 호출 시점의 props가 closure로 캡처되며,
 * agent 인스턴스 = grant 단위라 서로 다른 사용자가 같은 closure를 공유하지 않는다(Codex 검토).
 */
export function registerTools(server: McpServer, env: Env, props: Props): void {
  registerSearchProduct(server, env, props);
  registerGetMyRoutine(server, env, props);
}
