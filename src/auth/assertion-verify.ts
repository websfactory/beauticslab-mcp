// Next.js → Worker assertion JWT 검증.
// Counterpart: beauticslab/src/lib/mcp-assertion.ts (signAssertion).
// DESIGN.md §3.1 Step 7, §8.4 / nextjs-integration.md §2.

import { jwtVerify } from "jose";

export const ASSERTION_AUDIENCE = "https://mcp.beauticslab.com";

export type AssertionPayload = {
  sub: string;
  email: string;
  aud: string;
  exp: number;
  state: string;
};

export type VerifyAssertionResult =
  | { ok: true; payload: AssertionPayload }
  | { ok: false; error: AssertionErrorCode };

export type AssertionErrorCode =
  | "invalid_assertion"
  | "expired_assertion"
  | "invalid_audience"
  | "state_mismatch"
  | "missing_claims";

export type VerifyAssertionInput = {
  jwt: string;
  expectedState: string;
  verifyKey: string;
};

export async function verifyAssertion(
  input: VerifyAssertionInput,
): Promise<VerifyAssertionResult> {
  if (typeof input.verifyKey !== "string" || input.verifyKey.length < 32) {
    throw new Error("ASSERTION_VERIFY_KEY missing or too short (need ≥32 chars)");
  }
  const secret = new TextEncoder().encode(input.verifyKey);

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(input.jwt, secret, {
      algorithms: ["HS256"],
      audience: ASSERTION_AUDIENCE,
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (err) {
    const e = err as { code?: string; claim?: string } | undefined;
    if (e?.code === "ERR_JWT_EXPIRED") return { ok: false, error: "expired_assertion" };
    if (e?.code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && e.claim === "aud") {
      return { ok: false, error: "invalid_audience" };
    }
    return { ok: false, error: "invalid_assertion" };
  }

  const sub = payload.sub;
  const email = payload.email;
  const aud = payload.aud;
  const exp = payload.exp;
  const state = payload.state;

  if (
    typeof sub !== "string" ||
    typeof email !== "string" ||
    typeof aud !== "string" ||
    typeof exp !== "number" ||
    typeof state !== "string"
  ) {
    return { ok: false, error: "missing_claims" };
  }

  if (state !== input.expectedState) {
    return { ok: false, error: "state_mismatch" };
  }

  return {
    ok: true,
    payload: { sub, email, aud, exp, state },
  };
}
