// Tool 응답 헬퍼 + 공통 에러 마스킹.
// tools-spec §0.1: outputSchema 명시 시 structuredContent + content[0]에 동일 JSON stringify.
// Codex Q5: Next.js 401 detail(missing_hmac/stale_timestamp/bad_signature 등)은 MCP 에러로 누설 금지 → generic 마스킹.

import type { Env } from "../index.js";
import { callInternal } from "../mcp/api-client.js";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function structuredResult(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    isError: false,
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/**
 * Worker→Next.js 호출 결과를 호출자가 분기하기 좋은 union으로 반환.
 * 401/403/5xx는 generic 메시지로 마스킹된 ToolResult를 동봉, 404는 호출자가 의미 결정.
 * Next.js의 내부 에러코드(missing_hmac, bad_signature 등)는 LLM/사용자에게 노출하지 않는다.
 */
export type CallInternalResult =
  | { ok: true; data: unknown }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "masked"; status: number; result: ToolResult };

export async function callInternalMasked(
  env: Env,
  opts: { path: string; body: unknown; userId: string },
): Promise<CallInternalResult> {
  let res: Response;
  try {
    res = await callInternal(opts, {
      baseUrl: env.NEXTJS_INTERNAL_BASE_URL,
      hmacKey: env.INTERNAL_HMAC_KEY,
    });
  } catch (err) {
    console.error("callInternal threw", err);
    return { ok: false, kind: "masked", status: 0, result: errorResult("내부 호출 중 오류가 발생했습니다.") };
  }

  if (res.status === 401 || res.status === 403) {
    console.error("internal auth failure", { status: res.status, path: opts.path });
    return {
      ok: false,
      kind: "masked",
      status: res.status,
      result: errorResult("인증 오류입니다. 잠시 후 다시 시도해주세요."),
    };
  }
  if (res.status === 404) {
    return { ok: false, kind: "not_found" };
  }
  if (res.status >= 400) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      if (res.status === 400 && body?.error === "invalid_input") {
        detail = "입력값이 유효하지 않습니다.";
      }
    } catch {
      /* body 비-JSON: 기본 메시지 */
    }
    console.error("internal call failed", { status: res.status, path: opts.path });
    return {
      ok: false,
      kind: "masked",
      status: res.status,
      result: errorResult(detail || `내부 호출이 실패했습니다 (status ${res.status}).`),
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, kind: "masked", status: res.status, result: errorResult("응답 파싱에 실패했습니다.") };
  }
  return { ok: true, data };
}
