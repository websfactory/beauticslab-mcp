// PRM/audience 계약 회귀 테스트 (DESIGN §8.4 H결정 갱신, 2026-05-10).
//
// 검증 범위:
//   (a) sub-path PRM resource = origin + /mcp (라이브러리 default + path-suffix 매핑)
//   (b) root PRM resource = origin-only (호환 fallback, 현재 apiRoute=/mcp 단일이라 보안 경계 동일)
//   (c) /mcp 401 응답의 WWW-Authenticate.resource_metadata가 sub-path PRM을 가리킴
//   (d) audienceMatches: path-specific audience(/mcp)는 /mcp만 통과
//   (e) audienceMatches: /mcp-v2, /admin, /api 등 다른 path는 거부 (path-boundary `/` 검사)
//
// (a)~(c)는 wrangler dev (port 8791) 기동 필수. 미기동 시 skip.
// (d)~(e)는 라이브러리 audienceMatches 동작 미러 — workers-oauth-provider 0.5.0
//   `dist/oauth-provider.js` L1364–1374 동일 로직.

const WORKER_URL = process.env.MCP_WORKER_URL || "http://localhost:8791";

let pass = 0, fail = 0, skip = 0;
const check = (n, c, d = "") => { console.log(`${c?"✅":"❌"} ${n}${d?" — "+d:""}`); c?pass++:fail++; };
const skipped = (n, why) => { console.log(`⏭️  ${n} — ${why}`); skip++; };

// 라이브러리 audienceMatches 동작 미러 (oauth-provider.js L1364–1374).
// 변경 시 라이브러리 코드와 함께 갱신. v0.5.0 기준.
function audienceMatches(resourceServerUrl, audienceValue) {
  try {
    const resource = new URL(resourceServerUrl);
    const audience = new URL(audienceValue);
    if (resource.origin !== audience.origin) return false;
    if (audience.pathname === "/" || audience.pathname === "") return true;
    return resource.pathname === audience.pathname || resource.pathname.startsWith(audience.pathname + "/");
  } catch {
    return false;
  }
}

// ---- (a) sub-path PRM ----
async function testSubPathPrm() {
  let res;
  try {
    res = await fetch(`${WORKER_URL}/.well-known/oauth-protected-resource/mcp`);
  } catch (e) {
    skipped("(a) sub-path PRM", `worker @ ${WORKER_URL} 미응답 — wrangler dev 기동 필요`);
    return false;
  }
  check("(a) sub-path PRM 200", res.status === 200);
  const body = await res.json();
  // resource는 origin + /mcp 형태. host는 wrangler dev에서 mcp.beauticslab.com으로 rewrite됨 (routes 설정).
  const u = new URL(body.resource);
  check("(a) sub-path PRM resource pathname = /mcp", u.pathname === "/mcp", `actual: ${body.resource}`);
  // dev에서는 wrangler.jsonc dev.host="localhost:8791" 강제로 PRM이 localhost로 응답.
  // production은 routes 설정으로 mcp.beauticslab.com. 둘 다 valid (dev/prod 검증 자동 분기).
  const expectedHost = WORKER_URL.includes("localhost") ? "localhost:8791" : "mcp.beauticslab.com";
  check(`(a) sub-path PRM resource host = ${expectedHost}`, u.host === expectedHost, `actual: ${u.host}`);
  // B결정 근거: scope는 WWW-Authenticate에 강제 안 함, PRM scopes_supported로 게시 (DESIGN §8.4 I결정 약화)
  check(
    "(a) sub-path PRM scopes_supported = [mcp:read]",
    Array.isArray(body.scopes_supported) && body.scopes_supported.length === 1 && body.scopes_supported[0] === "mcp:read",
    `actual: ${JSON.stringify(body.scopes_supported)}`,
  );
  return true;
}

// ---- (b) root PRM ----
async function testRootPrm() {
  let res;
  try {
    res = await fetch(`${WORKER_URL}/.well-known/oauth-protected-resource`);
  } catch {
    skipped("(b) root PRM", "worker 미응답");
    return;
  }
  check("(b) root PRM 200", res.status === 200);
  const body = await res.json();
  const u = new URL(body.resource);
  check("(b) root PRM resource = origin-only (no path)", u.pathname === "/" || u.pathname === "", `actual: ${body.resource}`);
}

// ---- (c) /mcp 401 WWW-Authenticate ----
async function testMcp401() {
  let res;
  try {
    res = await fetch(`${WORKER_URL}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  } catch {
    skipped("(c) /mcp 401 WWW-Authenticate", "worker 미응답");
    return;
  }
  check("(c) /mcp 401 (no token)", res.status === 401);
  const wwwAuth = res.headers.get("www-authenticate") || "";
  check("(c) WWW-Authenticate present", !!wwwAuth);
  const m = wwwAuth.match(/resource_metadata="([^"]+)"/);
  check("(c) resource_metadata param present", !!m, `header: ${wwwAuth}`);
  if (m) {
    const u = new URL(m[1]);
    // sub-path 가리켜야 함 (path-specific resource discovery)
    check(
      "(c) resource_metadata points to sub-path PRM (.../oauth-protected-resource/mcp)",
      u.pathname === "/.well-known/oauth-protected-resource/mcp",
      `actual: ${m[1]}`,
    );
  }
}

// ---- (d) audienceMatches: path-specific audience 통과 ----
{
  // 토큰 audience = https://mcp.beauticslab.com/mcp, 요청 = /mcp → 통과
  check(
    "(d) audience /mcp + request /mcp → 통과",
    audienceMatches("https://mcp.beauticslab.com/mcp", "https://mcp.beauticslab.com/mcp"),
  );
  // 요청 = /mcp/sub-path → 통과 (audience prefix + `/`)
  check(
    "(d) audience /mcp + request /mcp/anything → 통과 (path prefix)",
    audienceMatches("https://mcp.beauticslab.com/mcp/anything", "https://mcp.beauticslab.com/mcp"),
  );
}

// ---- (e) audienceMatches: 다른 path 거부 ----
{
  check(
    "(e) audience /mcp + request /admin → 거부",
    !audienceMatches("https://mcp.beauticslab.com/admin", "https://mcp.beauticslab.com/mcp"),
  );
  check(
    "(e) audience /mcp + request /api → 거부",
    !audienceMatches("https://mcp.beauticslab.com/api", "https://mcp.beauticslab.com/mcp"),
  );
  // 핵심 boundary: /mcp-v2가 /mcp/로 시작하지 않으므로 거부 (sham prefix 방지)
  check(
    "(e) audience /mcp + request /mcp-v2 → 거부 (path-boundary `/` 검사)",
    !audienceMatches("https://mcp.beauticslab.com/mcp-v2", "https://mcp.beauticslab.com/mcp"),
  );
  check(
    "(e) audience /mcp + request /mcparoo → 거부 (sham prefix 방지)",
    !audienceMatches("https://mcp.beauticslab.com/mcparoo", "https://mcp.beauticslab.com/mcp"),
  );
  // origin 다르면 거부 (scheme/host 검사)
  check(
    "(e) origin 다름 (scheme) → 거부",
    !audienceMatches("http://mcp.beauticslab.com/mcp", "https://mcp.beauticslab.com/mcp"),
  );
  check(
    "(e) origin 다름 (host) → 거부",
    !audienceMatches("https://attacker.com/mcp", "https://mcp.beauticslab.com/mcp"),
  );
  // origin-only audience는 모든 path 통과 (현 root PRM 호환 — 의도된 동작 고정)
  check(
    "(e) audience origin-only(/) + request /admin → 통과 (라이브러리 의도 동작 — 향후 path 추가 시 검토 필요)",
    audienceMatches("https://mcp.beauticslab.com/admin", "https://mcp.beauticslab.com"),
  );
}

// ---- live 테스트 실행 ----
await testSubPathPrm();
await testRootPrm();
await testMcp401();

console.log(`\n${pass} pass / ${fail} fail / ${skip} skipped`);
process.exit(fail === 0 ? 0 : 1);
