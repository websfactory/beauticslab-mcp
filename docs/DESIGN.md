# beauticslab MCP Server: Design

Version: v0.3 (2026-05-09)
Status: nextjs-integration v1.0의 N3·N5·N6 정정 반영. 코드 작성 단계 진입.

---

## 1. 목적과 범위

### 무엇을 만드나
ChatGPT, Claude, Cursor 사용자가 자기 AI 클라이언트 안에서 beauticslab.com 기능을 직접 사용할 수 있게 하는 원격 MCP(Model Context Protocol) 서버.

### 왜 만드나
beauticslab.com 사용자는 이미 자기 스킨케어 루틴, 회피 성분, 관심 제품을 사이트에 저장해두고 있다. 그 데이터를 AI 클라이언트와 연결하면 "지금 고민 중인 신제품이 내 루틴이랑 충돌하나?" 같은 강력한 use case가 가능해진다. 단순 검색 래퍼가 아니라 개인 컨텍스트 기반 분석이 핵심 가치.

### v1 범위
- OAuth 2.1 인증 단일 모드
- 인증 = OAuth 2.1 (PAT, 복붕 방식 안 씀)
- 노출 tool: `search_product`, `get_my_routine` (둘 다 OAuth 인증 필수)
- 쓰기 tool 없음 (v1은 read-only)
- 프리미엄 등급 분기 없음 (운영 종료)
- Flask, FastAPI 직접 호출 안 함, 전부 Next.js 경유

### v1에서 빼는 것 (v2 이후)
- 추가 tool들 (analyze_ingredients_text, analyze_against_my_routine, chat 등)
- 이미지 OCR
- 쓰기 tool (루틴 추가, 블랙리스트 업데이트 등)
- 디렉토리 등록(Smithery, mcp.so)

---

## 2. 시스템 아키텍처

### 토폴로지
```
Claude Desktop / ChatGPT / Cursor
            │
            │ MCP over Streamable HTTP (TLS)
            ▼
┌──────────────────────────────────────────┐
│  mcp.beauticslab.com (Cloudflare Worker) │
│   • OAuth 2.1 Authorization Server       │
│   • MCP Resource Server                  │
│   • workers-oauth-provider + McpAgent    │
│   • Workers KV: OAUTH_KV (토큰, grant)   │
│   • Durable Object: MCP_OBJECT (세션)    │
└──────────────────────────────────────────┘
            │
            │ (1) login bridge 흐름은 사용자 브라우저 redirect 경유
            │ (2) tool 호출은 server-to-server (HMAC 서명)
            ▼
┌──────────────────────────────────────────┐
│  beauticslab.com (Next.js, cafe24 PM2)   │
│   • next-auth(Google + Kakao) 그대로     │
│   • 신규: /oauth/mcp-bridge 라우트       │
│   • 신규: HMAC 검증 미들웨어             │
│   • 신규: /api/internal/mcp/* 라우트군   │
│   • 기존 /api/*, next-auth 흐름 무수정   │
└──────────────────────────────────────────┘
```

### 주요 결정 사항 요약
| 결정 | 선택 | 근거 |
|---|---|---|
| MCP 전송 | Streamable HTTP | 2025-11-25 spec 권장. SSE 단독은 deprecated |
| OAuth AS 위치 | Worker 자체 | Notion/Sentry/Linear/Atlassian/Stripe 전부 동일 패턴. next-auth는 OAuth issuer 아님 |
| 인증 모드 | OAuth 2.1 단일 | workers-oauth-provider apiRoute 동작상 익명 모드 구현 불가(라이브러리가 모든 apiRoute 경로를 토큰 게이트로 처리). 2026-05-10 dual-mode 폐기 |
| MCP 토큰 → Next.js 전달 | 금지 | 2025-11-25 spec MUST NOT 조항. Worker가 user_id 추출 후 HMAC 서명 별도 요청 |
| Cloudflare 배포 | Worker + KV + DO 무료 티어 | 일 10만 req, DO 5GB SQLite 모두 충분 |

---

## 3. OAuth 흐름

### 3.1 등록(연결) 흐름
사용자가 Claude/ChatGPT에서 mcp.beauticslab.com 연결을 클릭한 시점부터.

```
Step 1. 클라이언트가 mcp.beauticslab.com/mcp 호출
Step 2. Worker가 401 + 다음 헤더 응답 (라이브러리 default):
        WWW-Authenticate: Bearer realm="OAuth", resource_metadata="https://mcp.beauticslab.com/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="..."
        (scope 파라미터는 PRM `scopes_supported`로 게시 — I 결정 2026-05-10 약화, §8.4)

Step 3. 클라이언트가 메타데이터 fetch (sub-path 우선):
        GET /.well-known/oauth-protected-resource/mcp
        → { "resource": "https://mcp.beauticslab.com/mcp", "authorization_servers": ["https://mcp.beauticslab.com"], "scopes_supported": ["mcp:read"] }

        GET /.well-known/oauth-authorization-server
        → { "authorization_endpoint": "...", "token_endpoint": "...", ... }

Step 4. 클라이언트가 사용자 브라우저로 /authorize 띄움
        ?client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256
        &resource=https://mcp.beauticslab.com/mcp&state=...
        (resource는 sub-path PRM이 광고한 path-specific 값 — H결정 §8.4)

Step 5. Worker가 사용자 브라우저를 beauticslab.com으로 redirect:
        GET https://beauticslab.com/oauth/mcp-bridge
            ?worker_state=<opaque>&return_to=https://mcp.beauticslab.com/oauth/callback

Step 6. Next.js가 /oauth/mcp-bridge 처리:
        a. getServerSession(authOptions) 호출
        b. 미로그인이면 next-auth /api/auth/signin으로 redirect
           (callbackUrl로 다시 /oauth/mcp-bridge 지정)
        c. 로그인 확인 후 동의 화면 (1페이지: "Claude/ChatGPT가 내 루틴을
           읽도록 허용하시겠습니까?" + 동의/거부)
           CSRF/state 바인딩 (K 결정):
             - 동의 form에 CSRF 토큰 (next-auth 세션 hash 기반) hidden field
             - worker_state는 GET → POST 전이에 그대로 유지하여 동의 액션과 묶음
             - POST 처리 시 토큰 검증 후에만 assertion 발급
             - 근거: Cloudflare "Securing MCP Servers" 가이드
        d. 동의 시 5분 만료 JWT assertion 서명:
           {
             sub: session.user.id,
             email: session.user.email,
             aud: "https://mcp.beauticslab.com",
             exp: now + 300,
             state: worker_state
           }
        e. Worker 콜백으로 302 redirect:
           https://mcp.beauticslab.com/oauth/callback?assertion=<jwt>&state=<worker_state>

Step 7. Worker가 /oauth/callback 처리:
        a. JWT 서명 검증 (ASSERTION_VERIFY_KEY)
        b. exp, aud, state 검증
        c. workers-oauth-provider의 completeAuthorization 호출:
           - userId = sub
           - props = { userId, email }
        d. 라이브러리가 authorization code를 KV에 저장 후
           원래 클라이언트 redirect_uri로 코드 발급

Step 8. 클라이언트가 /token 호출 (PKCE verifier 포함)
        Worker가 access_token, refresh_token 발급:
        {
          "access_token": "<opaque>",
          "token_type": "Bearer",
          "expires_in": 3600,
          "refresh_token": "<opaque>",
          "scope": "mcp:read"
        }

Step 9. 이후 클라이언트는 모든 /mcp 호출에 Bearer access_token 첨부
        Worker가 KV에서 props 조회 → userId 확보 → tool 핸들러로 전달
```

### 3.2 갱신 흐름
- access_token 만료 시 클라이언트가 refresh_token으로 /token 호출
- workers-oauth-provider가 자동 처리, refresh_token rotation 적용

---

## 4. 토큰 모델

### 4.1 발급되는 토큰 종류
| 종류 | 발급자 | 보관 위치 | 만료 | 용도 |
|---|---|---|---|---|
| Next.js → Worker assertion | Next.js | URL query string (1회용) | 5분 | OAuth bridge 단계 신원 전달 |
| MCP access_token | Worker (workers-oauth-provider) | 클라이언트 + Worker KV | 1시간 | 클라이언트 → Worker 호출 |
| MCP refresh_token | Worker | 클라이언트 + Worker KV | 30일 (rotation) | access_token 갱신 |
| Worker → Next.js HMAC | Worker (요청마다 서명) | 헤더에만, 저장 안 함 | 요청 시각 ±60초 | server-to-server 호출 |

### 4.2 KV 저장 구조 (workers-oauth-provider 위임)
- `client:<client_id>` 클라이언트 메타데이터
- `grant:<grant_id>` authorization code, props
- `token:<token_hash>` access_token + props 캐시
- `refresh:<refresh_hash>` refresh_token rotation 추적

전부 라이브러리가 알아서 관리. 우리는 직접 안 건드림.

### 4.3 props에 담는 정보
```ts
type Props = {
  userId: string;   // beauticslab user.id (cuid)
  email: string;    // 디버깅용
};
```

기존 next-auth JWE 토큰은 절대 저장 안 함. 사용자별 데이터는 매번 Next.js에 user_id 보내서 서버에서 조회.

---

## 5. Next.js 측 통합 contract

기존 코드 수정 0건. 신규 파일 3종.

### 5.1 신규: `src/app/oauth/mcp-bridge/page.tsx` (또는 route)
- next-auth 세션 확인
- 미로그인이면 signin redirect
- 로그인 확인 후 동의 화면 렌더 (서버 컴포넌트로 1페이지)
- POST 동의 처리 → assertion 서명 → Worker 콜백으로 302

### 5.2 신규: `src/lib/mcp-assertion.ts`
- assertion 발급용 헬퍼
- `signAssertion({ userId, email, state }): string`
- HS256 + 환경변수 `MCP_ASSERTION_SECRET`
- 5분 만료

### 5.3 신규: `src/middleware/mcp-hmac.ts` (또는 미들웨어 헬퍼)
- Worker → Next.js 호출 검증
- 요청 헤더:
  - `Authorization: HMAC <signature>`
  - `X-MCP-User-Id: <user.id>`
  - `X-MCP-Timestamp: <epoch_ms>`
- 서명 대상: `<method>\n<path>\n<timestamp>\n<body_sha256>`
- 환경변수 `MCP_INTERNAL_HMAC_KEY`로 검증
- 시각 차이 ±60초 초과 시 거부 (replay 방지)

### 5.4 신규 라우트 그룹: `src/app/api/internal/mcp/*`
- v1: `src/app/api/internal/mcp/my-routine/route.ts` 1개
- HMAC 미들웨어 통과한 요청만 처리
- `X-MCP-User-Id` 헤더에서 user_id 추출 후 Prisma 조회
- 기존 `src/lib/<domain>/*.service.ts`의 함수 그대로 재사용

### 5.5 middleware.ts matcher 추가
기존 matcher에 다음 1줄만 추가:
```ts
"/api/internal/mcp/:path*", // HMAC 게이트 (next-auth 우회)
```
HMAC 게이트는 next-auth와 별개 검증 흐름. 미들웨어에서 path prefix로 분기.

`/oauth/mcp-bridge`는 matcher에 추가하지 않는다 — page.tsx 안에서 `getServerSession` 직접 호출(N5, `nextjs-integration.md` §3.7).

### 5.6 환경변수 추가 (.env)
```
MCP_ASSERTION_SECRET=<32+ bytes>
MCP_INTERNAL_HMAC_KEY=<32+ bytes>
MCP_WORKER_CALLBACK_URL=https://mcp.beauticslab.com/oauth/callback
```

ecosystem.config.js의 env 블록에도 동일하게 추가.

---

## 6. Worker 측 구조

### 6.1 의존성
- `@cloudflare/workers-oauth-provider` (v0.5.0, 2026-05-05)
  - 자동 처리: KV 토큰 저장·해시화, props 암호화, refresh token rotation(2-valid 방식, 30일 TTL), `/.well-known/oauth-protected-resource` 게시
  - 우리가 직접 짜야 함: 동의 페이지 UI, 사용자 인증 흐름, audience 검증(Resource Indicator는 metadata만 게시함, 토큰 audience 검증은 자동 안 됨)
- `@modelcontextprotocol/sdk`
- `agents` (Cloudflare 공식 MCP SDK, McpAgent 포함)
- `zod` (tool input 스키마)

### 6.2 wrangler.jsonc 핵심
```jsonc
{
  "name": "beauticslab-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2025-11-25",
  "routes": [{ "pattern": "mcp.beauticslab.com/*", "zone_name": "beauticslab.com" }],
  "kv_namespaces": [{ "binding": "OAUTH_KV", "id": "..." }],
  "durable_objects": {
    "bindings": [{ "name": "MCP_OBJECT", "class_name": "BeauticsLabMCP" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BeauticsLabMCP"] }]
}
```

### 6.3 시크릿 (wrangler secret put)
- `ASSERTION_VERIFY_KEY` Next.js와 동일한 HMAC 키
- `INTERNAL_HMAC_KEY` Worker → Next.js HMAC 키
- `NEXTJS_INTERNAL_BASE_URL` `https://beauticslab.com` (production), staging 분리 가능

### 6.4 폴더 구조
```
beauticslab-mcp/
├── docs/
│   ├── DESIGN.md                ← 이 문서
│   ├── oauth-flow.md            ← 향후: 시퀀스 다이어그램, 에러 케이스
│   ├── tools-spec.md            ← 향후: tool 별 상세 스펙
│   ├── nextjs-integration.md    ← 향후: Next.js 측 PR contract 상세
│   └── deployment.md            ← 향후: 배포·rollout 절차
├── src/
│   ├── index.ts                 ← OAuthProvider entrypoint
│   ├── mcp/
│   │   ├── agent.ts             ← class BeauticsLabMCP extends McpAgent
│   │   └── api-client.ts        ← Worker → Next.js HMAC 서명 fetch
│   ├── tools/
│   │   ├── search-product.ts
│   │   ├── authed/
│   │   │   └── get-my-routine.ts
│   │   └── index.ts             ← OAuth 단일 모드, 두 tool 무조건 등록
│   ├── auth/
│   │   ├── handler.ts           ← OAuth handler (bridge redirect, callback 처리)
│   │   ├── assertion-verify.ts  ← Next.js assertion JWT 검증
│   │   └── consent-page.ts      ← 필요 시 Worker 자체 동의 화면
│   └── types.ts                 ← Props, Env
├── tests/
│   └── interop/                 ← Claude/Cursor/ChatGPT 스모크 (수동 절차 문서)
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── .dev.vars                    ← 로컬 시크릿 (gitignored)
├── .gitignore
└── README.md
```

---

## 7. v1 tool 카탈로그

상세 스펙은 `docs/tools-spec.md`에서 1개씩 합의 후 채움. 여기는 골격만.

### 7.1 `search_product`
- 입력: `{ query: string, limit?: number, sources?: ("oliveyoung"|"enuri"|"daiso"|"custom")[] }`
- Worker가 Next.js `/api/internal/mcp/search-product` 호출 (HMAC + X-MCP-User-Id)
- Next.js가 기존 `/api/products/search` 로직 재사용 (service 함수 호출)
- 출력: 제품 리스트 (goods_no, source, name, brand, image_url, price)
- 인증 필수. 호출 시 user_activity_logs에 `mcp_product_search` 활동 로깅

### 7.2 `get_my_routine`
- 입력: `{}` (user_id는 props에서 자동)
- Worker가 Next.js `/api/internal/mcp/my-routine` 호출 (HMAC + X-MCP-User-Id)
- Next.js가 기존 `/api/my-skincare/routines` GET 로직 재사용
- 출력: 사용자 루틴 리스트 + 각 루틴의 제품들
- 인증 필수. 호출 시 user_activity_logs에 `mcp_routine_view` 활동 로깅

---

## 8. 보안 모델

### 8.1 Cloudflare 측 방어
- **Origin 검증** Streamable HTTP /mcp 요청은 spec 권고대로 Origin 검증 (DNS rebinding 방지)
- **Rate limit** Cloudflare Rate Limiting Rules로 IP당, 사용자당 제한
  - 사용자당 분 120회, 시간 2000회
- **WAF** Cloudflare 기본 WAF + bot fight mode
- **Payload cap** body 1MB 제한

### 8.2 토큰 보안
- access_token, refresh_token 모두 opaque (JWT 아님), KV 조회 필요
- KV 키는 토큰 해시 사용
- props는 라이브러리가 자동 암호화 (workers-oauth-provider 표준)
- refresh_token rotation 활성화

### 8.3 server-to-server (Worker → Next.js)
- HMAC SHA-256 서명, body 해시 포함
- 시각 차이 ±60초로 replay 방지
- 비밀키는 Worker, Next.js 양쪽에 동일하게 환경변수 보관
- Cloudflare → cafe24 호출은 TLS, 추가로 Cloudflare IP allowlist 검토(선택)

### 8.4 spec 준수 사항
- **Canonical resource URI = `https://mcp.beauticslab.com/mcp`** (path-specific, H 결정 2026-05-10 갱신).
  - origin-only(`https://mcp.beauticslab.com`)도 MCP spec상 valid canonical URI이지만, MCP 2025-11-25 spec은 클라이언트가 "the most specific URI that they can"을 SHOULD 권고 ([MCP Auth — Canonical Server URI](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)). RFC 8707 §2.2도 동일 권고("client SHOULD provide the most specific URI"). 한 origin에 여러 protected surface가 들어올 경우(향후 gateway/admin/api 등) path-specific resource가 권한 경계를 좁히는 정상 패턴
  - 이 값을 sub-path PRM(`/.well-known/oauth-protected-resource/mcp`)의 `resource`, `/authorize`/`/token` 호출의 `resource` 파라미터(RFC 8707), 발급 토큰의 `audience` claim 모두에 동일하게 사용
  - **달성 방식**: 별도 코드 없이 라이브러리 default 동작으로 자동 충족
    - workers-oauth-provider 0.5.0이 well-known URL의 path-suffix를 그대로 resource로 매핑 (`oauth-provider.js` `deriveResourceIdentifier`, README "By default, it uses the request origin as the resource identifier" + path-suffix 반영)
    - `/mcp` 401 응답의 `WWW-Authenticate.resource_metadata`가 sub-path PRM(`/.well-known/oauth-protected-resource/mcp`)을 가리킴 → 클라이언트가 path-specific resource를 자동 채택
    - 토큰 endpoint(`/token`)가 `body.resource`를 그대로 audience claim에 박음 (`oauth-provider.js` L559 `parseResourceParameter(body.resource || grantData.resource)`)
  - **토큰 audience 검증은 라이브러리 자동** — `oauth-provider.js` L1017–1020에서 `audienceMatches(resourceServer, aud)` 호출, origin 일치 + path-boundary(`/`) 검사. 따라서 `/mcp` 토큰이 `/mcp-v2`·`/admin`·`/api` 등 다른 path에는 통과 못 함 (audienceMatches L1370 `startsWith(audience.pathname + "/")` 의 `/` boundary). README는 audience/RFC 8707에 대해 명시적 언급이 없으나 코드는 검증함 — 별도 앱코드 불필요
  - **`OAuthProvider({ resourceMetadata: { resource: "..." } })` 옵션 미사용**: 정적 값 박으면 dev/prod scheme 분기 발생(prod=https, wrangler dev=http) → audienceMatches origin mismatch로 dev e2e 깨짐. 라이브러리 default가 request URL의 scheme/host를 그대로 사용해 두 환경 모두 자동 정합
  - **wrangler dev `dev.host` 필수**: wrangler dev가 routes 패턴(`mcp.beauticslab.com/*`)에서 hostname을 자동 추론해 `request.url`을 production host로 rewrite (의도된 동작 — `cloudflare/workers-sdk#3635`). dev에서 PRM/audience/WWW-Authenticate origin 일관성 확보를 위해 `wrangler.jsonc`의 `dev.host="localhost:8791"`를 명시. 미명시 시 audience(`localhost:8791/mcp`) ≠ resourceServer(`mcp.beauticslab.com/mcp`) origin mismatch로 모든 인증 호출 401
  - 근거: [MCP Auth 2025-11-25 — Canonical Server URI / Resource Parameter Implementation](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [RFC 8707 §2.2](https://www.rfc-editor.org/rfc/rfc8707), [workers-oauth-provider 0.5.0 README + 소스](https://github.com/cloudflare/workers-oauth-provider)
- MCP 토큰을 Next.js로 전달 안 함 (spec MUST NOT)
- PKCE S256 강제
- Protected Resource Metadata 게시 (workers-oauth-provider 자동)
- Authorization Server Metadata 게시 (workers-oauth-provider 자동)
- 401 응답의 `WWW-Authenticate` 헤더는 라이브러리 default 형식 그대로 사용 — `Bearer realm="OAuth", resource_metadata="...", error="invalid_token", error_description="..."` (I 결정 2026-05-10 약화). 클라이언트는 PRM의 `scopes_supported`(현재 `["mcp:read"]`)를 통해 필요한 scope를 알 수 있고 MCP spec도 `scope` 파라미터 포함을 SHOULD로만 권고. 라이브러리 응답을 가로채 scope를 주입하는 것은 위험 대비 이익이 낮아 도입 안 함. 이전 결정(401 응답에 `scope="mcp:read"` 강제)은 라이브러리 자동 응답과 충돌해 유지 비용이 높았음
- 클라이언트 등록 메커니즘: spec은 3가지 정의 (Pre-registration, CIMD, DCR). 우선순위는 pre-registered → CIMD → DCR → user-input. DCR은 spec상 "backwards compatibility" 용도
- v1 결정 항목 (§10.7): **DCR만 (의도된 v1 tradeoff, J 결정)**. 주요 클라이언트(Claude Desktop/ChatGPT/Cursor/Claude Code)는 모두 DCR 지원하므로 v1 출시에 충분. CIMD는 v1.x 우선 추가 항목이며, workers-oauth-provider 0.5.0 README "CIMD Support" 절을 따라 활성화 가능. 자세한 근거는 `docs/research-dossier.md` F4·F13

### 8.5 개인정보
- props에 userId, email만. 그 외 사용자 데이터 Worker 메모리/KV에 저장 안 함
- 사용자 데이터는 매 요청 Next.js에서 fetch
- 이메일은 디버깅 로그 외 외부 노출 금지

---

## 9. 배포 모델

### 9.1 Cloudflare 측
- 비용: 무료 티어 (Workers 10만 req/일, KV 1GB, DO 5GB SQLite)
- 도메인: `mcp.beauticslab.com` (beauticslab.com 이미 Cloudflare DNS 사용 중)
- 배포: `wrangler deploy` 수동, 추후 GitHub Actions
- 시크릿: `wrangler secret put` (Next.js와 동일 키 공유)

### 9.2 Next.js 측
- 별도 배포 작업 없이 기존 `full-deploy.sh` 흐름 재사용
- 신규 환경변수 cafe24 .env에 추가
- 기존 라우트 무수정이라 rollback 영향 0

### 9.3 운영 주의사항 (cafe24 Next.js)
- 2026-05-08 기준 cafe24 PM2 restart count 248회 관찰됨 (원인 미진단)
- MCP 트래픽이 cafe24 Next.js 부하를 증폭하지 않게 다음을 권장:
  - Worker 측 Cloudflare Cache 적극 활용 (특히 `search_product` 응답 — 공개 데이터)
  - Cloudflare Rate Limit (DESIGN §8.1)을 보수적으로 시작 (사용자당 분 120회)
  - PoC/스테이징 단계에서 cafe24 PM2 로그 + restart count 모니터링 필수
- 신규 `/api/internal/mcp/*` 라우트는 next-auth를 거치지 않으므로 부하 특성이 다름. 첫 배포 후 N+30분 확인.

### 9.4 Rollout
- Step 1 search_product 활성화 (OAuth 인증 필수)
- Step 2 OAuth 흐름 + get_my_routine 활성화 (제한된 베타 사용자만)
- Step 3 일반 공개

---

## 10. 미해결 / 다음 결정

이 문서를 v1.0으로 확정하기 전에 합의 필요:

### 10.1 동의 화면을 어디에 둘지 → **후보 A로 확정 (2026-05-09)**
- 후보 A: Next.js `/oauth/mcp-bridge` 페이지 안 (next-auth 로그인 직후 같은 흐름)
- ~~후보 B: Worker가 자체 동의 페이지 호스팅 (workers-oauth-provider 표준)~~
  - **정정**: workers-oauth-provider는 동의 페이지를 호스팅하지 않음. README 명시: "This UI is NOT implemented by the OAuthProvider. It is up to the application to implement a UI here." 따라서 후보 B는 "Worker가 HTML 직접 짜기 + 사용자 로그인 시스템 별도 구축"이 되어 사실상 비현실적
- **확정: A**. 근거는 `docs/research-dossier.md` F6 보너스 절 참조

### 10.2 search_product의 4소스 통합 방식 → **옵션 1 확정 (2026-05-09)**
- ~~옵션 2: 기본 oliveyoung만, source 파라미터로 명시 시 다른 곳도~~
- **확정: 옵션 1**. 모두 검색해서 source 표시. `sources` 파라미터로 필터링 가능

### 10.3 Worker → Next.js 인증 강도 → **HMAC만 확정 (2026-05-09)**
- **확정: v1은 HMAC만**. cafe24 mTLS 셋업 비용 큼.
- Cloudflare IP allowlist는 v1.x에서 검토 (별도 결정 항목)
- mTLS는 v2 이후 재검토

### 10.4 사용자 토큰 revoke UX
- 사용자가 beauticslab.com에서 "AI 도구 연결 해제" 누르면?
- v1엔 안 만듦. v2에서 Next.js → Worker로 KV 삭제 호출 API 추가

### 10.5 멀티 클라이언트 (Claude Desktop + ChatGPT 동시 연결)
- 한 사용자가 여러 MCP 클라이언트에서 동시 연결 시?
- workers-oauth-provider가 grant 단위로 분리 관리하므로 자동 지원
- 별도 작업 불필요, 다만 사용자별 동시 grant 수 제한은 검토

### 10.6 로그·관측
- Worker 로그 → Cloudflare Logs
- Next.js의 logAppRouteActivity와 일관되게 `mcp:tool:<name>` scope 기록
- 별도 스킴 정의는 v2

### 10.7 클라이언트 등록 메커니즘 → **옵션 1 (DCR만) 확정 (2026-05-09)**
- **확정: v1 = DCR만 (RFC 7591)**. 4대 주요 클라이언트 모두 지원, 구현 단순.
- `clientRegistrationEndpoint: "/register"`로 활성화 (workers-oauth-provider 0.5.0)
- CIMD는 v1.x에서 추가 검토 (workers-oauth-provider 0.5.0의 CIMD 옵션 활성화 가능)
- 근거 `docs/research-dossier.md` F4·F13

---

## 11. 진행 단계

DESIGN v0.2 + tools-spec v1.0 확정 완료. 이후 단계:

1. ✅ **Step 0c**: 미해결 항목(§10.2/10.3/10.7) 합의 (2026-05-09)
2. ✅ **Step 0d**: `tools-spec.md` v1.0 — A~K 11개 결정 확정 (2026-05-09)
3. ✅ **Step 1**: Worker 폴더 스캐폴딩 (package.json, wrangler.jsonc, src/index.ts) (2026-05-09)
4. **Step 2 (다음)**: `docs/nextjs-integration.md` — Next.js 신규 3파일(`/oauth/mcp-bridge`, `mcp-assertion`, HMAC 미들웨어) + 내부 라우트 코드 수준 contract
5. **Step 3**: 양쪽 코드 작성 (beauticslab-mcp Worker tools/handler + beauticslab Next.js 신규 라우트·미들웨어·service 추출)
6. **Step 4**: 로컬 dev e2e 테스트 (`wrangler dev` + `npm run dev` 동시 기동, OAuth bridge 흐름 → tool call 검증)
7. **Step 5**: 사용자 합의 → PR 분리 (Next.js, Worker) → 배포

각 단계 완료 시점에 사용자 검토 후 다음 단계 승인.

---

## 부록 A. 참고 자료

### 외부 문서
- [MCP Authorization spec, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Tools spec](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP Transports spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Cloudflare Agents Authorization](https://developers.cloudflare.com/agents/model-context-protocol/authorization/)
- [Cloudflare Securing MCP Servers](https://developers.cloudflare.com/agents/guides/securing-mcp-server/)
- [Cloudflare workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)
- [Cloudflare remote-mcp-github-oauth demo](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth)
- [coleam00 remote-mcp-server-with-auth](https://github.com/coleam00/remote-mcp-server-with-auth)
- [Aaron Parecki, Let's fix OAuth in MCP](https://aaronparecki.com/2025/04/03/15/oauth-for-model-context-protocol)
- [Notion hosted MCP server inside look](https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look)
- [RFC 7591 - Dynamic Client Registration](https://www.rfc-editor.org/rfc/rfc7591)
- [RFC 8707 - Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707)
- [RFC 9728 - Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728)

### beauticslab (Next.js) 측 참조 파일
구현 시 직접 봐야 할 파일들:
- `<internal-path>/CLAUDE.md` — 프로젝트 컨벤션, 4데이터 소스 규칙
- `<internal-path>/prisma/schema.prisma` — DB 모델
- `<internal-path>/src/lib/auth-options.ts` — next-auth 설정
- `<internal-path>/src/lib/auth.ts` — 세션 헬퍼
- `<internal-path>/src/middleware.ts` — 미들웨어 게이트, CVE 차단 헤더
- `<internal-path>/scripts/db-query.ts` — SELECT 안전 필터 패턴 (참고용)
- `<internal-path>/src/app/api/dashboard/ingredients/[code]/route.ts` — 기존 Bearer 토큰 듀얼 인증 사례 (HMAC 미들웨어 작성 시 참고)
- `<internal-path>/src/app/api/products/search/route.ts` — `search_product`가 호출할 기존 검색 로직 (service 추출 대상)
- `<internal-path>/src/app/api/my-skincare/routines/route.ts` — `get_my_routine`이 호출할 기존 루틴 조회 로직 (service 추출 대상)

## 부록 B. 용어

- **MCP** Model Context Protocol. AI 클라이언트가 외부 tool/resource를 호출하기 위한 표준 프로토콜
- **AS** Authorization Server. OAuth 토큰 발급 주체
- **RS** Resource Server. 보호된 리소스 제공 주체. 우리 경우 Worker가 AS와 RS 동시
- **PKCE** Proof Key for Code Exchange. OAuth 코드 가로채기 방지 메커니즘
- **CIMD** Client ID Metadata Documents. 2025-11-25 spec 신규, DCR 대체
- **DCR** Dynamic Client Registration (RFC 7591)
- **PRM** Protected Resource Metadata (RFC 9728)
- **DO** Cloudflare Durable Object. 세션별 stateful 실행 환경
- **KV** Cloudflare Workers KV. 글로벌 분산 키-값 스토어

## 부록 C. 구현 근거 로그 (Implementation Reference Log)

이 섹션은 구현 시 참고한 외부 문서·리포지토리·npm 패키지 버전을 기록합니다. **다음 작업자(또는 미래의 자기 자신)가 같은 출처를 신뢰하고 재참조할 수 있도록**, 새 패턴을 도입할 때마다 한 줄씩 누적합니다.

### 기록 규칙
- 형식: `- YYYY-MM-DD <대상 파일/주제>: <출처 요약> (URL 또는 커밋/버전)`
- 출처는 가능한 한 1차 자료 (공식 README, npm 패키지, 공식 GitHub 데모) 우선
- 같은 출처를 다음 작업에서도 그대로 참고해도 안전하다는 의미. stale 의심되면 재검증 후 갱신

### 항목

- **2026-05-09 도구 패턴 1차 reference**: Cloudflare 공식 데모 [`cloudflare/ai/demos/remote-mcp-github-oauth`](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-github-oauth) 사용. 데모는 `@cloudflare/workers-oauth-provider@^0.4.0` + `agents@^0.9.0`이지만 API surface는 v0.5.0 / v0.12.3에서도 동일 (`apiHandler`, `defaultHandler`, `clientRegistrationEndpoint`, `McpAgent.serve(path)`). 향후 작업도 이 데모 구조를 골격으로 따른다.

- **2026-05-09 `package.json` 의존성 버전**: npm latest 직접 확인 (`npm view`).
  - `@cloudflare/workers-oauth-provider@0.5.0` (2026-05-05 published)
  - `agents@0.12.3` (2026-05-02)
  - `@modelcontextprotocol/sdk@1.29.0`
  - `wrangler@^4.79.0`, `typescript@^6.0.2`, `@cloudflare/workers-types@^4`
  - `zod@^4`

- **2026-05-09 `wrangler.jsonc` 골격**: 공식 데모 wrangler.jsonc 그대로 차용 + DESIGN §6.2의 우리 도메인/이름으로 치환. `migrations.new_sqlite_classes`, `durable_objects.bindings`, `kv_namespaces[OAUTH_KV]`, `compatibility_flags: ["nodejs_compat"]` 모두 데모 패턴 유지.

- **2026-05-09 `src/index.ts` 골격**: 데모 `src/index.ts` (커밋 main 시점) 패턴 채택.
  - `class BeauticsLabMCP extends McpAgent<Env, Record<string, never>, Props>`
  - `server = new McpServer({ name, version })`
  - `async init() { this.server.tool(...) }`
  - `export default new OAuthProvider({ apiHandler: BeauticsLabMCP.serve("/mcp"), apiRoute: "/mcp", authorizeEndpoint, tokenEndpoint, clientRegistrationEndpoint, defaultHandler })`
  - `Props` 타입은 우리 정의 (`{ userId, email }`, DESIGN §4.3).

- **2026-05-09 v0.5.0 API surface 검증**: 패키지 d.ts 직접 확인.
  - `OAuthProviderOptions` 필드: `apiHandler`, `apiRoute`, `defaultHandler`, `authorizeEndpoint`, `tokenEndpoint`, `clientRegistrationEndpoint`, `scopesSupported` 등 그대로 유지.
  - `audience` 필드는 `Token` 인터페이스에 존재 (RFC 7519 §4.1.3). **2026-05-10 정정**: 라이브러리 0.5.0은 `oauth-protected-resource` 핸들러(L1017–1020)에서 `audienceMatches`로 audience를 자동 검증함 (origin 일치 + path-boundary `/` prefix). README의 "Standards Compliance" 절은 RFC 8707/audience 검증에 대해 별도 언급이 없으나 코드 동작은 자동 검증. 따라서 별도 앱코드 audience 검증 불필요. (이전 본 항목의 "README는 audience 검증을 직접 구현하라고 명시" 표현은 사실 오기 — README에 그런 문구 없음)
  - CIMD 지원 추가 (README "Client ID Metadata Document (CIMD) Support" 섹션). v1은 비활성, v1.x에서 활성화 가능.
  - **앞으로의 작업에서도 v0.5.0 d.ts/README가 1차 자료**.

- **2026-05-09 `agents@0.12.3` McpAgent 시그니처 검증**: 패키지 d.ts (`dist/agent-tool-types-*.d.ts`) 직접 확인.
  - `abstract class McpAgent<Env, State, Props>` — 데모와 동일한 3-제네릭
  - `abstract server: MaybePromise<McpServer | Server>`, `abstract init(): Promise<void>`
  - `static serve(path, opts?)` (Streamable HTTP, 기본), `static serveSSE(path, opts?)` (legacy)
  - **앞으로 import는 `agents/mcp`에서**.

- **2026-05-09 `docs/tools-spec.md` 응답 형식**: [MCP 2025-11-25 spec - Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) 채택.
  - `outputSchema` 명시 → `structuredContent` 반환 (MUST), 호환을 위해 `content[0]`에도 동일 JSON stringify 동봉 (SHOULD)
  - 비즈니스 에러는 `isError:true`로 (LLM 자가 보정 가능). protocol error(-32602)는 사용 안 함
  - 같은 spec 페이지가 향후 새 tool 추가 시에도 1차 자료. 변경되면 부록 C 갱신.

- **2026-05-09 tools-spec §4 11개 결정 (A~K)**: 의사결정 근거 분리 기록.
  - 일반 권고 (A,B,E,F,G): MCP spec + Codex 2nd opinion 종합. 출처는 tools-spec §4 결정 로그 참조
  - 데이터 기반 (C,D): **운영 DB 직접 측정 (2026-05-09)** — `user_skincare_products` 테이블 14,175행, `user_purpose` 60% 채워짐(평균 108자, AI 생성 분석문 다수), routines/user 분포(평균 2.1, 정상 ≤10, abuser 1명 993), ingredients/product 평균 38.2. 향후 cap/노출 정책 재검토 시 같은 쿼리로 재측정.
  - DESIGN.md 보강 (H,I,J,K): MCP Auth spec + Cloudflare Securing MCP Servers 가이드 기반.
  - **데이터 기반 결정은 분포가 크게 바뀌면 재검토**. 정상/비정상 사용자 비율, ingredients 분포 변동 모니터링.

- **2026-05-09 운영 DB 직접 쿼리 패턴**: `cd beauticslab && node -e "..."` 로 PrismaClient 사용. BigInt 직렬화는 `JSON.stringify(x, (k,v) => typeof v === 'bigint' ? Number(v) : v)`. 이 패턴이 향후 데이터 기반 의사결정에서도 1차 도구.
