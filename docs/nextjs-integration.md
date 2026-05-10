# Next.js Integration Contract (beauticslab ↔ beauticslab-mcp)

Version: v1.0 (2026-05-09)
Status: Codex 1차 리뷰(2026-05-09) 반영 완료. 본 문서 합의 후 양쪽 코드 작성([B] 단계) 진입.

선행 문서:
- `docs/DESIGN.md` v0.2 — 전체 아키텍처
- `docs/tools-spec.md` v1.0 — 두 tool 입출력 contract

대상 레포:
- **beauticslab** (Next.js, cafe24, `<internal-path>`) — 본 문서가 주로 다루는 측
- **beauticslab-mcp** (Cloudflare Worker, `<internal-path>-mcp`) — Worker 측 호출 규약 일부 포함

---

## 0. 이 문서의 범위

DESIGN §5에 골격만 적힌 Next.js 측 통합을, 코드 작성 직전 단계의 **함수 시그니처·라우트 모양·헤더 포맷·환경변수 키 이름**까지 못 박는 문서.

다루는 것:
1. `/oauth/mcp-bridge` 라우트 contract (페이지 동작, redirect 규약, CSRF/state 바인딩)
2. `mcp-assertion.ts` 헬퍼 (HS256 JWT 발급·검증)
3. HMAC 미들웨어 contract (헤더 포맷, 서명 대상 정확한 정의 — `USER_ID_OR_EMPTY` 라인 포함, ±60초 검증)
4. `middleware.ts` matcher 변경
5. 신규 내부 라우트 2개 (`/api/internal/mcp/search-product`, `/api/internal/mcp/my-routine`)
6. 신규 service 함수 시그니처 (`searchProductsCombined`, `getRoutinesForUser`)
7. sanitize 헬퍼 contract (`sanitizeUserText`, `mapSourceForMcp`)
8. 환경변수 추가 목록 (`.env`, `ecosystem.config.js`)
9. 기존 라우트 리팩토링 범위 (F 결정: 응답 모양 무변경, cleanup 금지)

다루지 않는 것:
- Worker 측 OAuth handler·tool 구현 상세 (DESIGN §6, tools-spec)
- 배포·rollout 절차 (DESIGN §9)

---

## 1. `/oauth/mcp-bridge` 라우트

### 1.1 위치
`src/app/oauth/mcp-bridge/page.tsx` (App Router 서버 컴포넌트 + form action)

App Router로 두는 이유:
- 서버 컴포넌트에서 `getServerSession(authOptions)` 직접 호출 가능
- form action으로 POST 처리 시 별도 라우트 핸들러 불필요
- 필요 시 `route.ts`로 분리해도 무방하지만, 동의 페이지 UI를 같이 렌더하므로 page 파일 1개로 유지

### 1.2 GET (진입)

**입력 query**:
- `worker_state` (required) — Worker가 발급한 opaque 식별자. 동의 form까지 그대로 통과시켜야 함. Worker 측 요구사항: short TTL(≤10분) + single-use + callback 처리 후 즉시 삭제(workers-oauth-provider grant 흐름이 자동 처리하지만 Worker 구현 시 재확인)
- `return_to` (required) — Worker 콜백 URL. **exact URL 일치 검증**: `process.env.MCP_WORKER_CALLBACK_URL`(예: `https://mcp.beauticslab.com/oauth/callback`)과 정확히 동일한 문자열이어야 함. origin only로 풀면 향후 Worker에 다른 엔드포인트 생길 때 공격면 확장. 불일치 시 400

**처리 순서**:
1. `worker_state`, `return_to` 존재 확인. 없거나 origin 불일치면 400 페이지 응답
2. `getServerSession(authOptions)` 호출
3. 세션 없으면 `/auth/signin`으로 redirect
   - `callbackUrl` = `/oauth/mcp-bridge?worker_state=...&return_to=...` (원본 query 그대로)
   - `signIn` 후 자동으로 다시 이 페이지로 돌아옴
4. 세션 있으면 동의 페이지 렌더:
   - 사용자 정보 표시 (`session.user.email`)
   - 권한 설명: "Claude/ChatGPT가 내 루틴을 읽도록 허용"
   - 동의/거부 form
   - hidden field 3개:
     - `worker_state` — 그대로
     - `return_to` — 그대로
     - `csrf` — `generateCsrf(session.user.id)` 결과 (§1.4)

### 1.3 POST (동의 처리)

form action으로 같은 페이지에 POST.

**입력 form data**:
- `worker_state`, `return_to`, `csrf`
- `decision` — `"approve"` | `"deny"`

**처리 순서**:
1. `getServerSession(authOptions)` 재확인 (세션 만료 방어)
2. `csrf` 검증: `verifyCsrf(csrf, session.user.id)` — 실패 시 403
3. `return_to` exact URL 재검증 — 실패 시 400
4. `decision === "deny"`: `${return_to}?error=access_denied&state=${worker_state}` 로 302
5. `decision === "approve"`:
   - `signAssertion({ userId: session.user.id, email: session.user.email!, state: worker_state })` 호출
   - `${return_to}?assertion=${jwt}&state=${worker_state}` 로 302

**redirect는 항상 302 (외부 도메인이므로 NextResponse.redirect 사용)**.

### 1.3.1 응답 보안 헤더 (필수)

GET·POST 양쪽 응답에 다음 헤더 강제:
- `Content-Security-Policy: frame-ancestors 'none'`
- `X-Frame-Options: DENY` (구형 브라우저 호환)
- `Cache-Control: no-store, no-cache, must-revalidate`
- `Pragma: no-cache`
- `Referrer-Policy: no-referrer`

이유:
- clickjacking 방어 (동의 form이 iframe에 embedded되어 사용자가 모르고 동의 누르는 공격 차단)
- `assertion` JWT가 query string에 실리는 redirect 응답이 캐시되거나 referrer로 외부에 새는 것 차단
- 헤더는 page.tsx 응답 직전에 `response.headers.set` 또는 Next.js `headers()` config로 적용

### 1.4 CSRF 토큰

K 결정에 따라 동의 form에 CSRF/state 바인딩 필수.

```ts
// src/lib/mcp-assertion.ts (CSRF 헬퍼도 같은 파일에)
function generateCsrf(userId: string): string;
function verifyCsrf(token: string, userId: string): boolean;
```

**v1 구현 방식 (절충안)**:
- HMAC-SHA256(`process.env.MCP_ASSERTION_SECRET`, `csrf:${userId}:${windowEpoch}`)
- `windowEpoch` = `Math.floor(Date.now() / (5 * 60 * 1000))` (5분 윈도우)
- 검증 시 현재 window와 직전 window 둘 다 허용 (경계 시점 race)
- 토큰은 base64url 인코딩

**Trade-off 명시**: 이건 보안 최선안이 아니라 **구현 절충안**. 본 토큰은 `userId + 5분 윈도우`로 결정적이라 같은 사용자가 5분 내에 여러 번 사용 가능하고 one-time 성질이 없음. 더 강한 안은 Cloudflare 가이드의 random cookie + hidden field double-submit이지만, App Router 서버 컴포넌트가 GET 렌더 중 쿠키를 set하기 어려워 §1.1 page.tsx 1파일 설계가 깨짐. v1은 단순성 우선, v1.x에서 `route.ts`로 분리 시 cookie double-submit 재검토.

next-auth 자체 CSRF 토큰을 재활용해도 되지만, NextAuth CSRF 토큰은 공식 문서상 `/api/auth/*` 엔드포인트용이라 의미적으로 어긋남. 본 안이 더 일관됨.

### 1.5 에러 모드

| 상황 | 응답 |
|---|---|
| `worker_state` 없음 | 400 페이지 (한국어 메시지) |
| `return_to` 없음 또는 origin 불일치 | 400 페이지 |
| 세션 없음 | `/auth/signin` redirect (callbackUrl 포함) |
| CSRF 실패 | 403 페이지 |
| `decision === "deny"` | Worker 콜백으로 `error=access_denied` redirect (정상 흐름) |
| assertion 서명 실패 (서버 오류) | 500 페이지 |

---

## 2. `src/lib/mcp-assertion.ts`

### 2.1 시그니처

```ts
export type AssertionPayload = {
  sub: string;           // beauticslab user.id (cuid)
  email: string;
  aud: "mcp.beauticslab.com";
  exp: number;           // epoch seconds
  state: string;         // worker_state
};

export function signAssertion(input: {
  userId: string;
  email: string;
  state: string;
}): string;

export function verifyAssertion(jwt: string): AssertionPayload;  // throws on failure
// 주의: verifyAssertion은 Worker 측에서 사용. Next.js 측 코드에는 sign만 import.
//       단, 같은 파일에 두는 이유는 알고리즘·시크릿·payload 모양 단일 출처 보장.
//       Worker는 이 파일을 직접 import하지 않고 같은 contract를 자체 구현 (`src/auth/assertion-verify.ts`).
```

### 2.2 알고리즘

- **HS256** (대칭키, 양쪽 동일 시크릿)
- 시크릿: `process.env.MCP_ASSERTION_SECRET` (32 bytes 이상 권장, base64 또는 hex)
- 만료: `exp = now + 300` (5분, DESIGN §4.1)
- audience: 항상 origin 형식 문자열 `"https://mcp.beauticslab.com"` — DESIGN §8.4 canonical resource URI와 동일 문자열
  - **2026-05-09 변경**: 초안의 호스트명("mcp.beauticslab.com") 형식을 origin 형식으로 통일. 이유: token audience와 assertion audience가 다른 문자열 체계를 갖는 이점보다 운영 실수 위험이 큼. 단일 canonical resource URI로 일치
  - DESIGN §3.1 Step 6.d 본문도 v0.3 패치 시 정정 예정

### 2.3 라이브러리 선택

`jose` 사용 (Edge runtime 호환, beauticslab의 next-auth가 이미 의존). 별도 의존성 추가 불필요.

```ts
import { SignJWT } from "jose";

const secret = new TextEncoder().encode(process.env.MCP_ASSERTION_SECRET!);

export async function signAssertion({ userId, email, state }) {
  return await new SignJWT({ email, state })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience("https://mcp.beauticslab.com")
    .setExpirationTime("5m")
    .sign(secret);
}
```

### 2.3.1 PII 최소화 trade-off

assertion에 `email` 포함 여부는 PII 최소 원칙(DESIGN §8.5)과 충돌 가능. 본 contract는 **포함 유지**:
- 근거: Worker 측 디버깅 시 `props.email`로 grant·token 추적이 빠름. workers-oauth-provider에 props로 흘러가 KV에 암호화 저장됨(평문 노출 없음)
- 위협: 5분 만료 + 1회용 query string + 보안 헤더 4종(§1.3.1)으로 외부 누출 차단
- 대안: `email` 제외 시 Worker는 `userId`만 저장. 디버깅 시 Next.js DB 조회 1회 추가. v1.x에서 운영 부담 보고 재검토

### 2.4 검증 실패 모드 (Worker 측 참고)

Worker `assertion-verify.ts`가 검증 실패 처리하지만, 양쪽 contract 일치를 위해 명시:

| 케이스 | Worker 응답 |
|---|---|
| 서명 불일치 | 400 invalid_assertion |
| `exp` 경과 | 400 expired_assertion |
| `aud` 불일치 | 400 invalid_audience |
| `state` 불일치 (Worker가 발급한 값과 다름) | 400 state_mismatch |

---

## 3. HMAC 미들웨어

### 3.1 위치

`src/lib/mcp/hmac.ts` — 헬퍼 함수만 export. middleware.ts에서 import해서 path 분기 처리.

별도 미들웨어 파일이 아니라 헬퍼인 이유: Next.js는 `src/middleware.ts` 1개만 인식. 기존 미들웨어에 `/api/internal/mcp/*` 분기를 추가하는 형태가 표준.

### 3.2 헤더 포맷 (Worker → Next.js 호출 시)

```
Content-Type: application/json
Authorization: HMAC <hex-signature>
X-MCP-Timestamp: <epoch_ms>
X-MCP-User-Id: <userId>          # 모든 요청에 필수 (OAuth 인증 단일 모드)
```

(tools-spec §0.2와 동일. 본 문서가 정식 정의.)

### 3.3 서명 대상 (정확한 정의)

```
canonical = METHOD + "\n" + PATH_WITH_QUERY + "\n" + TIMESTAMP + "\n" + USER_ID_OR_EMPTY + "\n" + sha256_hex(body)
signature = hmac_sha256_hex(MCP_INTERNAL_HMAC_KEY, canonical)
```

세부 규약:
- `METHOD` — 대문자 (`POST`)
- `PATH_WITH_QUERY` — pathname + search 그대로. host·scheme 제외 (예: `/api/internal/mcp/search-product` 또는 `/api/internal/mcp/search-product?foo=bar`)
- `TIMESTAMP` — `X-MCP-Timestamp` 헤더 값과 동일한 문자열 (epoch ms, 정수 문자열)
- `USER_ID_OR_EMPTY` — `X-MCP-User-Id` 헤더 값(OAuth userId). Worker 측은 단일 모드 invariant로 항상 비어있지 않은 userId를 전달함(2026-05-10, `api-client.ts` userId required 격상). Next.js verifier는 헤더 누락/빈값 입력에 대해 빈 문자열로 canonical 빌드 후 라우트 단에서 `missing_user_id`/`invalid_user_id` 응답으로 거부.
- `body` — 요청 body raw bytes. body 없으면 빈 문자열의 sha256
- `sha256_hex` — 소문자 hex
- `hmac_sha256_hex` — 소문자 hex
- 줄바꿈은 `\n` (LF) 1바이트

**2026-05-09 변경**: 초안에서 `X-MCP-User-Id`를 서명 대상에서 빼는 안이었으나, 그러면 HMAC가 "Worker가 보냈음"만 보장하고 "어느 userId의 데이터를 요청하는지"는 무결성 보호 없음(authorization subject 무결성 갭). canonical에 `USER_ID_OR_EMPTY` 라인 추가로 해결.

**2026-05-10 변경**: 익명 모드 폐기 + Worker `api-client.ts` userId required 격상으로 정상 흐름에서 빈 문자열이 canonical에 들어오는 경우는 발생하지 않음. `_OR_EMPTY` 라인은 Next.js 측 디펜시브 + 부정 케이스(`missing_user_id` 응답 회귀 검증)용으로 유지.

### 3.4 검증 함수 시그니처

```ts
// src/lib/mcp/hmac.ts
export type McpHmacResult =
  | { ok: true; userId: string | null }
  | { ok: false; status: number; error: string };

export async function verifyMcpHmac(req: Request): Promise<McpHmacResult>;
```

검증 순서:
1. 헤더 3개 존재 확인 (`Authorization`, `X-MCP-Timestamp`. `X-MCP-User-Id`는 선택)
2. `Authorization` 형식 = `HMAC <hex>` 파싱. 아니면 401
3. `X-MCP-Timestamp` 정수 변환. `|now_ms - ts| > 60_000`이면 401 (시계 ±60초)
4. body raw bytes 읽어 sha256
5. canonical 생성 → HMAC 서명 → constant-time 비교 (`crypto.timingSafeEqual`)
6. 불일치 시 401, 일치 시 `{ ok: true, userId: header || null }` 반환

### 3.5 보강 검증 (route 측)

라우트 핸들러에서 다음 추가 검증:
- `get_my_routine` 라우트: `userId === null`이면 401 (인증 tool인데 props 없이 호출됨)
- `userId` cuid 형식 정규식 검증 (raw 헤더 신뢰 금지)

### 3.6 middleware.ts 통합 방식 (하이브리드)

기존 `src/middleware.ts`는 `getToken({ req, secret })`로 next-auth JWT 검증을 함. `/api/internal/mcp/*`는 next-auth 우회 + HMAC 게이트가 필요.

**하이브리드 패턴** — 미들웨어는 cheap check만, body hash·user_id 의미 검증은 라우트 핸들러:

```ts
// middleware.ts 함수 본문 진입부 — 봇 검사 직후, 보호 경로 검사 직전에 분기 추가
if (request.nextUrl.pathname.startsWith("/api/internal/mcp/")) {
  // cheap check: 헤더 존재 + 형식 + timestamp ±60초
  const auth = request.headers.get("authorization");
  const ts = request.headers.get("x-mcp-timestamp");
  if (!auth?.startsWith("HMAC ") || !ts) {
    return NextResponse.json({ error: "missing_hmac" }, { status: 401 });
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > 60_000) {
    return NextResponse.json({ error: "stale_timestamp" }, { status: 401 });
  }
  // body hash + signature 비교는 라우트에서 verifyMcpHmac()으로 수행
  return NextResponse.next();
}
```

이유:
- Next.js 미들웨어는 Edge runtime이고 `req.body`를 소비하면 라우트 핸들러에서 다시 못 읽음. `req.clone()`은 가능하나 이득 작고 복잡도 증가
- cheap check를 미들웨어에서 처리하면 body parse 전 빠른 거부 가능 (cafe24 부하 보호)
- body hash·서명 비교는 라우트 핸들러의 `verifyMcpHmac()`이 수행 — body raw 1회 읽고 검증

### 3.7 matcher 변경 (`src/middleware.ts` config)

기존 matcher 그대로 두고 다음 1줄만 추가:

```ts
"/api/internal/mcp/:path*",
```

DESIGN §5.5는 `/oauth/mcp-bridge`도 matcher 추가를 언급하지만, **추가하지 않는다**. 이유:
- mcp-bridge는 `getServerSession`을 페이지 안에서 호출하므로 미들웨어 게이트 불필요
- 미들웨어가 `/oauth/*`까지 잡으면 다른 oauth 페이지(있는 경우)에 영향. 현재 matcher 패턴과 일관성을 위해 페이지 자체에서 처리

DESIGN §5.5 갱신은 본 문서 합의 후 v0.3 패치로 정정.

---

## 4. 신규 내부 라우트

### 4.1 `POST /api/internal/mcp/search-product`

**파일**: `src/app/api/internal/mcp/search-product/route.ts`

**요청 body** (JSON):
```ts
{
  query: string;
  limit?: number;          // 1~50, 기본 20
  sources?: ("oliveyoung"|"enuri"|"daiso"|"custom")[];
  category?: "skincare"|"suncare"|"cleansing"|"maskpack"|"makeup"|"bodyhair";
}
```

**처리**:
1. `verifyMcpHmac(req)` → 실패 시 그대로 반환
2. body zod 검증 — 실패 시 400 `{ error: "invalid_input", detail: ... }`
3. `searchProductsCombined(input)` 호출 (§5.1)
4. 응답 직전 `mapSourceForMcp` 적용 (§6.2)
5. 200 + tools-spec §1.6 모양

**인증**: HMAC + `X-MCP-User-Id` 필수. user_activity_logs에 `mcp_product_search` 로깅.

### 4.2 `POST /api/internal/mcp/my-routine`

**파일**: `src/app/api/internal/mcp/my-routine/route.ts`

**요청 body** (JSON):
```ts
{
  includeIngredients?: boolean;  // 기본 false
}
```

**처리**:
1. `verifyMcpHmac(req)` → `userId === null`이면 401 `{ error: "missing_user" }`
2. body zod 검증
3. `getRoutinesForUser({ userId, includeIngredients })` 호출 (§5.2)
4. 결과 0개면 404 `{ error: "no_routines" }` (tools-spec §2.6)
5. 응답 직전 sanitize 및 source 매핑 적용 (§6)
6. 200 + tools-spec §2.4 모양

**인증**: HMAC + `X-MCP-User-Id` 필수. user_activity_logs에 `mcp_routine_view` 로깅.

### 4.3 응답 cap 적용 위치

D 결정의 cap(routines 20 / ingredients 30 / 1MB)은 **service 함수가 적용**하고 라우트는 그대로 통과. 이유:
- service 함수가 단일 출처 → 다른 호출자(향후 v2 tool 추가)도 자동 동일 정책
- 라우트는 transport 책임만

`truncated` 플래그는 service가 채워서 반환.

---

## 5. 신규 service 함수

### 5.1 `searchProductsCombined`

**위치**: `src/lib/dashboard/services/search.service.ts` (신규 파일 또는 기존 파일에 추가)

```ts
export type SearchProductsCombinedInput = {
  query: string;
  limit: number;          // 라우트에서 default 적용 후 전달
  sources?: ("oliveyoung"|"enuri"|"daiso"|"custom")[];
  category?: "skincare"|"suncare"|"cleansing"|"maskpack"|"makeup"|"bodyhair";
};

export type SearchProductsCombinedItem = {
  goodsNo: string;
  source: "official"|"enuri"|"daiso"|"custom";  // 내부 표기 그대로 (G 결정 매핑은 라우트에서)
  name: string;
  brand: string|null;
  imageUrl: string|null;
  price: number|null;
  rating: string|null;
  reviewCount: number;
  routineCount: number;
};

export type SearchProductsCombinedResult = {
  query: string;
  totalCount: number;
  truncated: boolean;
  items: SearchProductsCombinedItem[];
};

export async function searchProductsCombined(
  input: SearchProductsCombinedInput,
): Promise<SearchProductsCombinedResult>;
```

**구현 방향**:
- 기존 `src/app/api/products/search/route.ts`(270줄)의 검색·정렬·병합 로직을 그대로 추출
- `sources` 미지정 → 4소스 전체 (DESIGN §10.2)
- `sources` 지정 → 해당 소스만 쿼리. 외부 enum `oliveyoung` → 내부 `official`로 입구에서 매핑
- `truncated` = 내부 검색 결과 수가 `limit`보다 많아 잘렸는지

**기존 라우트 영향**: `/api/products/search/route.ts`는 새 함수를 호출하도록 리팩토링하되 **응답 모양·필드·정렬 동일** (F 결정). 같은 PR에 다른 cleanup 섞지 않음.

### 5.2 `getRoutinesForUser`

**위치**: `src/lib/my-skincare/services/routines.service.ts` (없으면 신설)

```ts
export type GetRoutinesForUserInput = {
  userId: string;
  includeIngredients: boolean;
};

export type RoutineProduct = {
  goodsNo: string;
  source: "official"|"enuri"|"daiso"|"custom";  // 내부 표기 (G 매핑은 라우트에서)
  name: string|null;
  brand: string|null;
  imageUrl: string|null;
  productUrl: string|null;
  userPurpose: string|null;  // sanitize 적용된 상태
  ingredients: { name: string; category: string|null; concerns: string[] }[];  // includeIngredients=false면 빈 배열, 30개 cap
};

export type Routine = {
  id: number;
  name: string;
  description: string|null;
  displayOrder: number;
  totalProducts: number;
  products: RoutineProduct[];
};

export type GetRoutinesForUserResult = {
  totalRoutines: number;       // cap 적용 전 전체 개수
  truncated: { routines: boolean; ingredients: boolean };
  routines: Routine[];          // 최대 20
};

export async function getRoutinesForUser(
  input: GetRoutinesForUserInput,
): Promise<GetRoutinesForUserResult>;
```

**구현 방향**:
- 기존 `src/app/api/my-skincare/routines/route.ts`(727줄)의 GET 핸들러 로직 추출
- 기존 라우트는 next-auth 세션 + share token 분기가 섞여있음. service는 **userId 직접 받음**으로 단순화
- `userPurpose`는 service 안에서 `sanitizeUserText()` 적용 (C 결정)
- routines 정렬: `displayOrder ASC`
- `totalRoutines` = cap 적용 전 count
- routines 21번째부터는 잘림. `truncated.routines = true`
- `includeIngredients=true`인 경우만 ingredients 채움. 제품당 31번째 ingredient부터는 잘림. `truncated.ingredients = true` (한 routine이라도 잘리면 true)
- `includeIngredients=false`면 `ingredients: []` 그대로 (필드 자체는 항상 존재)

**기존 라우트 영향**: `/api/my-skincare/routines/route.ts`의 GET이 새 함수를 호출. 응답 모양 무변경. POST/DELETE 등 다른 메서드는 손대지 않음.

---

## 6. sanitize 헬퍼

### 6.1 위치

`src/lib/mcp/sanitize.ts`

### 6.2 시그니처

```ts
// 사용자 텍스트 sanitize (C 결정 §2.4)
export function sanitizeUserText(s: string|null|undefined): string|null;

// 내부 source → MCP 외부 source 매핑 (G 결정)
export function mapSourceForMcp(
  s: "official"|"enuri"|"daiso"|"custom",
): "oliveyoung"|"enuri"|"daiso"|"custom";

// 역매핑 (외부 → 내부, search-product 입력에서 사용)
export function mapSourceFromMcp(
  s: "oliveyoung"|"enuri"|"daiso"|"custom",
): "official"|"enuri"|"daiso"|"custom";
```

### 6.3 `sanitizeUserText` 동작

tools-spec §2.4 규칙 그대로:
1. null/undefined → null
2. ASCII control char(`\x00-\x08\x0b-\x1f\x7f`) 전부 제거 (단 `\t`(0x09), `\n`(0x0a)는 유지)
3. 양끝 trim
4. 빈 문자열 → null
5. 길이 > 500이면 500자에서 자르고 끝에 `…` 1자 추가 (총 501자 가능 — 표시 용도 명시)

**호출 위치**: `getRoutinesForUser` 안에서 `userPurpose` 채울 때. 라우트에서 추가 호출 불필요.

### 6.4 `mapSourceForMcp` 동작

| 내부 | 외부 |
|---|---|
| `official` | `oliveyoung` |
| `enuri` | `enuri` |
| `daiso` | `daiso` |
| `custom` | `custom` |

**호출 위치**: 라우트가 service 결과를 응답으로 직렬화하기 직전. `searchProductsCombined`, `getRoutinesForUser` 두 라우트 모두.

service 안에서 매핑하지 않는 이유: service는 내부 다른 호출자(웹 프론트)도 쓰므로 `official` 표기 유지가 안전. MCP 노출 시점에만 변환.

---

## 7. 환경변수

### 7.1 `.env` 추가 (cafe24)

```
# beauticslab-mcp 연동
MCP_ASSERTION_SECRET=<32+ bytes, base64 또는 hex>
MCP_INTERNAL_HMAC_KEY=<32+ bytes, base64 또는 hex>
MCP_WORKER_CALLBACK_URL=https://mcp.beauticslab.com/oauth/callback
```

생성 방법: `openssl rand -base64 32`

**`MCP_WORKER_CALLBACK_URL` 사용처**: `/oauth/mcp-bridge`의 `return_to` exact-match 검증(§1.2). 이전 초안의 `MCP_WORKER_ORIGIN`(origin only)에서 변경 — Codex 리뷰 반영.

### 7.2 `ecosystem.config.js`의 env 블록

`.env`와 동일 키 3개 추가. PM2 재시작 시 주입.

### 7.3 Worker 측 대응

DESIGN §6.3에 정의된 시크릿 이름과의 매핑:

| Next.js 환경변수 | Worker 시크릿 | 동일 값 여부 |
|---|---|---|
| `MCP_ASSERTION_SECRET` | `ASSERTION_VERIFY_KEY` | **동일** (HS256 대칭키) |
| `MCP_INTERNAL_HMAC_KEY` | `INTERNAL_HMAC_KEY` | **동일** |
| `MCP_WORKER_CALLBACK_URL` | (해당 없음, Worker는 자기 callback 경로 알고 있음) | — |
| (해당 없음) | `NEXTJS_INTERNAL_BASE_URL` | Worker 측에만 필요 |

키 이름이 양쪽에서 다른 점은 의도. 서로 다른 환경(.env vs wrangler secret)에서 헷갈리지 않게.

### 7.4 dev 환경

로컬 dev e2e 테스트(Step C)에서:
- beauticslab `.env.local`: 위 3개 추가
- beauticslab-mcp `.dev.vars`: 양쪽 시크릿 동일 값으로 추가
- `MCP_WORKER_CALLBACK_URL` dev 값: `http://localhost:8787/oauth/callback` (wrangler dev 기본 포트)
- `NEXTJS_INTERNAL_BASE_URL` dev 값: `http://localhost:3000`
- assertion `aud` dev 값은 contract상 하드코딩된 `https://mcp.beauticslab.com` 그대로 사용 — local 테스트 시 검증 통과 (절대 문자열 비교라 무관). 필요 시 환경변수로 분리하는 안은 v1.x 검토

---

## 8. 신규 파일 vs 기존 파일 영향 요약

### 8.1 신규 (Next.js 측)
- `src/app/oauth/mcp-bridge/page.tsx`
- `src/app/api/internal/mcp/search-product/route.ts`
- `src/app/api/internal/mcp/my-routine/route.ts`
- `src/lib/mcp-assertion.ts` (assertion sign + CSRF 헬퍼)
- `src/lib/mcp/hmac.ts` (`verifyMcpHmac`)
- `src/lib/mcp/sanitize.ts` (`sanitizeUserText`, `mapSourceForMcp`, `mapSourceFromMcp`)
- `src/lib/dashboard/services/search.service.ts` 또는 기존 파일에 `searchProductsCombined` 추가
- `src/lib/my-skincare/services/routines.service.ts` (신설) — `getRoutinesForUser`

### 8.2 기존 수정 (응답 모양 무변경, F 결정)
- `src/middleware.ts`
  - `/api/internal/mcp/` path prefix 분기 1개 추가 (§3.6)
  - matcher에 `/api/internal/mcp/:path*` 1줄 추가 (§3.7)
- `src/app/api/products/search/route.ts`
  - 기존 검색 로직을 `searchProductsCombined` 호출로 교체. 응답 모양 동일.
- `src/app/api/my-skincare/routines/route.ts`
  - GET 핸들러가 `getRoutinesForUser`를 호출하도록. 응답 모양 동일. POST/DELETE 등 다른 메서드 그대로.

### 8.3 기존 수정 안 함
- next-auth 설정, auth-options, auth.ts 손대지 않음
- 다른 기존 라우트, 컴포넌트, prisma schema 무수정
- DB 마이그레이션 없음

### 8.4 PR 분리 권장
- **PR 1 (beauticslab)**: 신규 파일 + middleware matcher + 두 기존 라우트 service 추출 리팩토링
- **PR 2 (beauticslab-mcp)**: Worker 측 OAuth handler + tools 구현
- 환경변수는 PR 1과 함께 cafe24에 주입 (배포 전)

---

## 9. 합의된 결정 (Codex 1차 리뷰 반영, 2026-05-09)

| ID | 항목 | 확정 결정 | 근거 |
|----|------|------|------|
| N1 | CSRF 방식 | HMAC 5분 윈도우 (절충안 명시) | App Router 1파일 설계 유지. cookie double-submit는 v1.x. §1.4 |
| N2 | HMAC 검증 위치 | **하이브리드** — 미들웨어 cheap check + 라우트 body·서명 | Edge body 소비 제약 + cheap reject 양립. §3.6 |
| N3 | assertion `aud` | **origin 형식 `https://mcp.beauticslab.com`** | canonical resource URI와 통일, 운영 실수 방지. §2.2 |
| N4 | service 함수 위치 | 도메인 폴더(dashboard, my-skincare) | 응집도. §5.1, §5.2 |
| N5 | DESIGN §5.5 정정 | `/oauth/mcp-bridge` matcher 제거 | page.tsx에서 `getServerSession` 직접. §3.7 |
| N6 | `return_to` 검증 | **exact URL 일치 (`MCP_WORKER_CALLBACK_URL`)** | origin only는 향후 공격면 확장. §1.2 |
| N7 | HMAC canonical | **`USER_ID_OR_EMPTY` 라인 포함** | authorization subject 무결성 보호. §3.3 |
| N8 | 동의 페이지 보안 헤더 | CSP frame-ancestors none + no-store + no-referrer 강제 | clickjacking + assertion 누출 차단. §1.3.1 |

DESIGN v0.3 패치 항목 (별도 작업):
- §3.1 Step 6.d assertion `aud` 표기를 origin 형식으로 정정
- §5.5 matcher 목록에서 `/oauth/mcp-bridge` 제거
- §5.6 환경변수 이름 `MCP_WORKER_ORIGIN` → `MCP_WORKER_CALLBACK_URL`

---

## 10. 위협 모델 체크리스트

코드 작성 시 각 항목이 처리되는지 확인:

| 위협 | 차단 메커니즘 | 위치 |
|---|---|---|
| `return_to` 임의 URL로 assertion 유출 | exact URL 일치 | §1.2 |
| 동의 form clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` | §1.3.1 |
| `assertion` JWT가 브라우저 캐시에 남음 | `Cache-Control: no-store` | §1.3.1 |
| `assertion` JWT가 referrer로 외부 누출 | `Referrer-Policy: no-referrer` | §1.3.1 |
| CSRF (제3자 사이트가 동의 form POST) | HMAC 윈도우 토큰 + form hidden field | §1.4 |
| `worker_state` 재사용 | Worker 측 short TTL + single-use + callback 후 삭제 | §1.2, Worker 측 책임 |
| HMAC replay | timestamp ±60초 윈도우 | §3.4, §3.6 |
| HMAC 위조 | `MCP_INTERNAL_HMAC_KEY` 양쪽 환경변수, constant-time 비교 | §3.4 |
| user_id 위조 (Worker가 다른 사용자 데이터 요청) | canonical에 `USER_ID_OR_EMPTY` 포함 | §3.3 |
| MCP 토큰을 Next.js로 전달 (spec MUST NOT) | Worker는 props에서 user_id 추출, MCP 토큰 미전송 | DESIGN §8.4 |
| token confusion (다른 MCP 서버 토큰을 우리 서버에 사용) | Worker가 token audience 명시 검증 | DESIGN §8.4, Worker 측 책임 |
| assertion 만료 후 재사용 | `exp = now + 300` (5분) | §2.2 |
| assertion 다른 audience로 재사용 | `aud = "https://mcp.beauticslab.com"` 명시 검증 | §2.2 |
| body 변조 (서명 후 body 교체) | sha256(body)가 canonical에 포함 | §3.3 |
| query string 변조 | `PATH_WITH_QUERY`가 canonical에 포함 | §3.3 |
| Worker 외 누군가의 직접 호출 | HMAC 키 비공개 + Worker IP allowlist는 v1.x 검토 | §3.4 |
| `userPurpose` prompt injection | sanitize + tool description 명시 | tools-spec §2.4 |
| 응답 페이로드 폭증 (abuser 사용자) | routines 20 / ingredients 30 / 1MB cap | tools-spec §2.4 |

비고:
- HMAC nonce 기반 강한 replay 방어(LRU 등)는 v1엔 안 함. timestamp 윈도우 + 단일 Worker 신뢰로 충분 판단. 다중 Worker 인스턴스 + 분산 nonce는 v1.x 검토
- Cloudflare → cafe24 IP allowlist는 운영 안정화 후 검토 (DESIGN §8.3)

---

## 11. 변경 이력

- 2026-05-09: v1.0. 초안 + Codex 1차 리뷰(threadId 019e0d06...) 반영. 변경된 결정 8건은 §9 표 참조
