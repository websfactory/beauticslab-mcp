# 결정 로그 (Decision Log)

본 프로젝트의 모든 결정 통합 인덱스. ID는 원래 문서의 ID 그대로 유지(번호 통합 안 함). 본문 근거는 원래 문서에서 확인.

상태 표기:
- **active**: v1에서 적용 중
- **deferred**: v1.x 또는 v2로 연기
- **superseded**: 다른 결정으로 대체됨

---

## 1. 시스템 아키텍처 (DESIGN.md §10)

| ID | 항목 | 결정 | 상태 | 근거 위치 |
|----|------|------|------|----------|
| 10.1 | 동의 화면 위치 | Next.js `/oauth/mcp-bridge` (옵션 A) | active | DESIGN §10.1 |
| 10.2 | search_product 4소스 통합 | 모두 검색 + `sources` 필터 (옵션 1) | active | DESIGN §10.2 |
| 10.3 | Worker→Next.js 인증 | HMAC만 (mTLS는 v2) | active | DESIGN §10.3 |
| 10.4 | 토큰 revoke UX | v1엔 안 만듦 | superseded by 10.4b | DESIGN §10.4 |
| 10.4b | 토큰 revoke UX | 구현: `/settings/connections` + Worker `/internal/grants/*` | active | 본 문서 §연결 해제·클라이언트 신원 |
| 10.5 | 멀티 클라이언트 | workers-oauth-provider grant 분리로 자동 지원 | active | DESIGN §10.5 |
| 10.6 | 로그·관측 | Cloudflare Logs + `mcp:tool:<name>` scope | active | DESIGN §10.6 |
| 10.7 | 클라이언트 등록 | DCR만 (CIMD는 v1.x 검토) | superseded by 10.7b | DESIGN §10.7 |
| 10.7b | 클라이언트 등록 | CIMD 활성 + DCR은 하위호환 유지 | active | 본 문서 §연결 해제·클라이언트 신원 |
| ANOM | 익명 모드 | OAuth 단일 모드(폐기됨, 2026-05-10) | active | DESIGN §1, §3, §7 / research-dossier F6 회고 |

## 2. Tool 스펙 (tools-spec.md §4 — A~K)

| ID | 항목 | 결정 | 상태 | 근거 위치 |
|----|------|------|------|----------|
| A | 페이지네이션 | `limit`만 + `truncated` 플래그 | active | tools-spec §1.7 |
| B | 다국어 query | 별도 처리 없음, "best in Korean" description | active | tools-spec §1.7 |
| C | `userPurpose` 필드 | 노출 + sanitize (실측 데이터 근거) | active | tools-spec §2.4 |
| D | 응답 cap | routines 20 / ingredients 30 / 1MB hard | active | tools-spec §2.4 |
| E | tool 이름 | snake_case 유지 | active | tools-spec §4 |
| F | service 추출 리팩토링 | 진행, 같은 PR에 cleanup 섞지 않음 | active | tools-spec §3.2 |
| G | `source` enum 통일 | 외부 `oliveyoung`, 내부 `official` 매핑 | active | tools-spec §1.4 |
| H | canonical resource URI | ~~origin-only `https://mcp.beauticslab.com`~~ → **path-specific `https://mcp.beauticslab.com/mcp`** (2026-05-10 갱신) | active | DESIGN §8.4 |
| I | 401 `WWW-Authenticate` | ~~`scope="mcp:read"` 포함 강제~~ → **라이브러리 default 형식 수용**, scope는 PRM `scopes_supported`로 게시 (2026-05-10 약화) | active | DESIGN §8.4 |
| J | DCR-only 의도 표기 | v1 tradeoff로 명시 | active | DESIGN §10.7 |
| K | consent CSRF/state 바인딩 | 명시 | superseded by K2 | DESIGN §3.1 |
| K2 | consent CSRF/state 바인딩 | CSRF를 `worker_state`에 결합 + 클라이언트 신원 표시 | active | 본 문서 §연결 해제·클라이언트 신원 |

## 3. Next.js 통합 (nextjs-integration.md §9 — N1~N8, Codex 1차 리뷰 반영)

| ID | 항목 | 결정 | 상태 | 근거 위치 |
|----|------|------|------|----------|
| N1 | CSRF 방식 | HMAC 5분 윈도우 (절충안 명시) | active | nextjs-integration §1.4 |
| N2 | HMAC 검증 위치 | 하이브리드 (미들웨어 cheap check + 라우트 body·서명) | active | nextjs-integration §3.6 |
| N3 | assertion `aud` | origin 형식 `https://mcp.beauticslab.com` | active | nextjs-integration §2.2 |
| N4 | service 함수 위치 | 도메인 폴더(dashboard, my-skincare) | active | nextjs-integration §5 |
| N5 | DESIGN §5.5 정정 | `/oauth/mcp-bridge` matcher 제거 | active | nextjs-integration §3.7 |
| N6 | `return_to` 검증 | exact URL 일치 (`MCP_WORKER_CALLBACK_URL`) | active | nextjs-integration §1.2 |
| N7 | HMAC canonical | `USER_ID_OR_EMPTY` 라인 포함 | active | nextjs-integration §3.3 |
| N8 | 동의 페이지 보안 헤더 | CSP frame-ancestors none + no-store + no-referrer | active | nextjs-integration §1.3.1 |

---

## DESIGN v0.3 패치 (2026-05-09 반영 완료)

코드 작성 진입 직전 적용. 패치 항목:
- §3.1 Step 6.d assertion `aud` 표기를 origin 형식 `https://mcp.beauticslab.com`으로 정정 (N3)
- §5.5 matcher 목록에서 `/oauth/mcp-bridge` 제거 (N5)
- §5.6 환경변수 이름 `MCP_WORKER_ORIGIN` → `MCP_WORKER_CALLBACK_URL` (N6)

---

## 익명 모드 폐기 (2026-05-10)

원래 설계(2026-05-09)는 dual-mode(익명 search_product + 인증 get_my_routine). workers-oauth-provider의 `apiRoute` 옵션이 매칭 경로를 무조건 토큰 게이트로 처리한다는 라이브러리 동작이 Step 4 로컬 e2e 검증 중 확인됨. 익명 우회는 라이브러리 의도 외 사용으로 보안 리스크 + 코드 복잡도 큼. MCP 생태계(Claude Desktop/ChatGPT/Cursor)에서도 익명 모드 패턴은 거의 없음 — OAuth 흐름이 표준 UX. 따라서 OAuth 단일 모드로 폐기.

연관 변경:
- DESIGN §3.3 삭제, §7.1/7.2 인증 필수로 재분류
- search_product도 X-MCP-User-Id 헤더 필수, user_activity_logs에 mcp_product_search 로깅
- get_my_routine은 mcp_routine_view 로깅
- 폴더 src/tools/public/ 평탄화

미해결(별도 라운드):
- ~~WWW-Authenticate scope="mcp:read" — 라이브러리 자동 응답 형식과 DESIGN §8.4 "I 결정" 충돌~~ → 2026-05-10 후속에서 I결정 약화로 종결 (DESIGN §8.4)

---

## H결정 갱신: canonical resource URI를 path-specific으로 (2026-05-10)

이전 H결정(2026-05-09)은 origin-only `https://mcp.beauticslab.com`을 canonical resource로 채택. 갱신 사유:

1. **MCP 2025-11-25 spec SHOULD**: "MCP clients SHOULD provide the most specific URI that they can for the MCP server they intend to access". origin-only도 valid canonical URI 예시에 포함되지만, 한 origin에 여러 protected surface를 둘 수 있는 환경에서는 path-specific이 spec 권고에 더 부합.
2. **RFC 8707 §2.2 동일 권고**: "client SHOULD provide the most specific URI". 멀티-resource origin에서 path 포함 URI를 권장.
3. **장기 보안 경계**: 향후 `mcp.beauticslab.com`에 gateway/admin/api/proxy 등이 추가될 가능성 고려. origin-only audience는 모든 path 허용(라이브러리 audienceMatches L1369 — pathname 빈값/`/`이면 모든 path 통과). path-specific(`/mcp`) audience는 path-boundary로 좁힘.

**달성**: 코드 변경 없음 — 라이브러리 default 동작이 sub-path PRM(`/.well-known/oauth-protected-resource/mcp`)을 자동 광고하고, `/mcp` 401의 WWW-Authenticate가 sub-path PRM을 가리킴. spec discovery sequence를 따르는 클라이언트는 자동으로 `resource=https://mcp.beauticslab.com/mcp`를 채택. 토큰 audience도 동일.

**관련 라이브러리 사실 정정**:
- 이전 DESIGN §8.4에 "audience 검증을 우리가 직접 구현 — README 명시" 표현 있었음. **사실 오기**. v0.5.0 README에 그런 명시 없고, 코드(L1017–1020)는 `audienceMatches`로 자동 검증함. 별도 앱코드 audience 검증 코드 불필요.

**`resourceMetadata.resource` 옵션 미사용 사유**: 정적 값 박으면 dev/prod scheme 분기 발생(prod=https, wrangler dev=http) → audienceMatches origin mismatch로 dev e2e 깨짐. 라이브러리 default가 request URL의 scheme/host를 그대로 사용해 두 환경 모두 자동 정합.

근거 자료:
- [MCP Auth 2025-11-25 — Resource Parameter Implementation / Token Handling](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [RFC 8707 §2.2](https://www.rfc-editor.org/rfc/rfc8707)
- [workers-oauth-provider 0.5.0 GitHub README + dist/oauth-provider.js (L269–275, L559, L1017–1020, L1364–1374)](https://github.com/cloudflare/workers-oauth-provider)

---

## wrangler dev host 강제 (2026-05-10 후속, Step 4.2 e2e 통과)

`wrangler.jsonc`의 `dev.host` 미설정 상태에서 Step 4.2 OAuth bridge 브라우저 e2e 진행 중 audience 불일치로 모든 `/mcp` 요청 401 발생.

**근본 원인**: wrangler dev는 `routes` 패턴(`mcp.beauticslab.com/*`)에서 hostname을 자동 추론해 `request.url`을 production host로 rewrite ([cloudflare/workers-sdk#3635](https://github.com/cloudflare/workers-sdk/issues/3635), 의도된 동작). 그러나 라이브러리의 PRM/audience/WWW-Authenticate URL이 같은 함수 안에서도 호출 시점에 따라 origin이 달라져 dev에서 일관성 깨짐.

**해결**: `dev.host: "localhost:8791"` 명시 → wrangler가 inferred host를 무시하고 명시값 사용. PRM resource·발급 토큰 audience·WWW-Authenticate URL 모두 `http://localhost:8791/...`로 일관. production에는 영향 없음(dev 섹션은 로컬 전용).

**검증**: `bash scripts/test-oauth-flow.sh` Phase 1+2 → DCR/authorize/bridge/consent/token/initialize/tools/list 전부 통과, search_product + get_my_routine 2개 노출 확인 (2026-05-10).

---

## Step 6 결정 (사용자용 README + 클라이언트 가이드, 2026-05-12)

근거 핸드오프: `handoffs/done/2026-05/2026-05-12-step6-readme-prep.md`(질문 리스트) + `handoffs/2026-05-12-step6-readme-done.md`(확정 + 산출물)

| ID | 결정 | 상태 |
|---|---|---|
| S1 | README 언어: 한국어 우선 단일 파일. 영문(`README_en.md`)은 한국어 베타 안정화 후 작성 | active |
| S2 | 브랜드 메인 표기: **BeauticsLab** (영문). beauticslab(소문자)/뷰틱스랩 한글은 부수 표기 | active |
| S3 | 라이선스: Proprietary, All rights reserved. 외부 PR 받지 않음. 향후 변경 가능 | active |
| S4 | 사용자 가이드 구성: README 단일 파일에 클라이언트 7종 평탄 나열. `docs/clients.md` 분리 안 함 | active |
| S5 | 지원 채널: beauticslab.com 카카오톡 문의로 단일화. 별도 이메일/이슈 트래커 만들지 않음 | active |
| S6 | 프라이버시: README엔 BeauticsLab 본사이트 개인정보처리방침 링크만. 별도 정책 문서 두지 않음 | active |
| S7 | FAQ 필수 항목: (a) 게시글/루틴 외부 유출 여부, (b) 지원 클라이언트 목록 | active |
| S8 | 클라이언트 가이드 구조: "비서/개발자" 카테고리 분리 폐기 → 클라이언트(툴) 단위 평탄 나열, 모두 동일 템플릿(사전조건→단계→config 예시→출처) | active |

### Step 6 검증 결과 (curl + Claude Code .mcp.json)
- 서버 메타데이터 조회: PRM/AS 정상, RFC 9728 WWW-Authenticate 준수
- DCR 양쪽 패턴(`token_endpoint_auth_method=none` public / 기본 confidential) 모두 정상
- CORS: `https://claude.ai` origin preflight 204
- 풀 E2E (Claude Code attach → OAuth → tools/list → tools/call): search_product 5건 + get_my_routine 6 루틴 정상 반환

상세: `research/clients-2026-05-12.md`

### 발견된 환경 한계 (영향 범위 = 본 프로젝트 외)
- ubuntu-dev 위 Claude Code로 dogfooding 시 OAuth callback이 headless라 수동 URL 복사 필요
- 일반 사용자(데스크탑 클라이언트)에겐 해당 없음
- 메모리 reference 별도 보관: `ref_claude_code_remote_mcp_oauth.md`

---

## 연결 해제·클라이언트 신원 표시 (2026-09-02)

**계기**: 외부 보안 연구자 신고(2026-08-27). "`/register`가 미인증이라 누구나 임의 `redirect_uri`로 클라이언트를 등록할 수 있고, 피해자를 유인하면 인가코드를 탈취할 수 있다."

**사실 확인**: 등록이 열려 있는 것은 맞다. 다만 그것은 RFC 7591·MCP 규격이 의도한 동작이며, 신고자의 권고대로 등록에 사전토큰을 요구하면 사전관계가 없는 Claude·ChatGPT가 연결하지 못한다. 영향도 신고서의 "계정 탈취"가 아니라 `mcp:read` 범위의 읽기 전용 유출이다(도구 3종 모두 읽기 전용, 쓰기 경로 없음).

**진짜 결함**: 동의 화면이 **어떤 클라이언트가 요청했는지 보여주지 않았다.** 열린 등록 자체가 아니라, 열린 등록 위에서 사용자에게 판단 근거를 주지 않은 것이 문제다.

### 결정

| ID | 결정 | 근거 |
|---|---|---|
| 10.7b | CIMD 활성(`clientIdMetadataDocumentEnabled`), DCR은 하위호환으로 유지 | MCP 2026-07-28에서 DCR은 deprecated, CIMD가 후속. CIMD는 `client_id`가 클라이언트 소유 https 문서 URL이라 동의 화면에 **검증된 도메인**을 띄울 수 있다 |
| K2 | 동의 화면에 클라이언트 이름·인가코드 수신 주소를 표시하고, 신원 미검증(DCR·조회실패) 클라이언트에는 경고 | 사용자가 정상/공격자 클라이언트를 구별할 수 있어야 한다 |
| K2 | 신원값은 Worker가 `INTERNAL_HMAC_KEY`로 서명한 `client_ctx` JWT로 전달(aud·exp·`state` 결합) | 쿼리 평문이면 공격자가 자기 `worker_state`에 남의 이름을 붙여 재조립할 수 있다 |
| K2 | CSRF 토큰을 `worker_state`에 결합 | 종전 `HMAC(userId+5분창)`은 같은 사용자의 어떤 인가요청에도 통용돼, 승인이 "이 요청에 대한 승인"임을 보장하지 못했다 |
| 10.4b | 연결 관리·해제 화면(`/settings/connections`) + Worker 내부 API `/internal/grants/list`·`/internal/grants/revoke` | 동의 화면이 약속한 해제 수단이 없었다. refresh token은 next-auth 세션과 분리돼 비밀번호 변경으로 끊기지 않는다 |
| P1 | `/register` 등록 정책 훅: 평문 http는 loopback만, `redirect_uris` 최대 10개, `client_name` 최대 200자, `javascript:`/`data:`/`vbscript:` 거부 | 등록 자체는 열어 두되 명백히 위험한 메타데이터만 차단 |
| P2 | `allowPlainPKCE: false` | plain은 `code_challenge`를 그대로 노출해 보호 효과가 없다 |

### 설계 정정 — 신뢰의 축은 등록 방식이 아니라 수신 주소다 (2026-09-02, 같은 날)

첫 구현은 **등록 방식(DCR/CIMD)** 을 신뢰 축으로 삼아 DCR 클라이언트 전부에 경고를 띄웠다. 운영 배포 후 실측하니 **Claude 가 DCR 로 등록한다**(`client_ctx` 의 `kind=dcr`). 즉 정상 사용자가 매번 경고를 보게 된다. 규격 문서를 다시 읽고 두 가지가 틀렸음을 확인했다.

1. **CIMD ≠ 신뢰.** CIMD 는 "이 도메인이 이 프로그램을 자기 것이라 공개 선언했다"만 증명한다. 공격자도 자기 도메인에 CIMD 문서를 올릴 수 있다. 초록 배지로 "도메인 확인됨"을 띄운 것은 검증됨(verified)을 믿을 만함(trusted)으로 넘겨 읽게 만든다.
2. **경고 피로.** 정상 로그인마다 경고가 뜨면 사용자는 경고를 읽지 않게 된다. 그러면 진짜 공격 때도 안 읽는다.

**정정**: 신뢰 축을 **자격증명이 실제로 전달되는 곳(`redirect_uri` 호스트)** 으로 옮겼다. 공격자가 코드를 훔치려면 결국 자기가 통제하는 주소로 받아야 하므로 그 주소가 진짜 신호다. `beauticslab/src/lib/mcp/client-trust.ts` 가 판정을 전담한다.

| 판정 | 조건 | 화면 |
|---|---|---|
| `known` | 수신 호스트가 알려진 1st-party 클라이언트와 **정확히 일치**(claude.ai·chatgpt.com·chat.openai.com) | 중립. 경고 없음 |
| `loopback` | 수신 호스트가 127.0.0.1·::1·localhost | 추가 경고. **MCP 규격이 명시적으로 요구**한다 |
| `unknown` | 그 외 전부 | 경고 + 수신 주소 확인 안내 |

접미사 매칭은 쓰지 않는다(`claude.ai.evil.example` 이 통과한다). 디렉터리·검사 서비스(smithery·glama)는 목록에 넣지 않았다 — 사용자가 의도한 연결이 아닐 수 있다.

CIMD 는 신뢰 판정에서 빠지고 **부가 정보**로 내려갔다. `client_id` 호스트를 "프로그램이 공개한 도메인"으로 표시하고(draft §6.4), 그 도메인과 수신 주소가 다르면 따로 알린다.

**근거**
- MCP 2026-07-28 `basic/authorization/security-considerations`: "**MUST** clearly display the redirect URI hostname during authorization" / "**SHOULD** display additional warnings for `localhost`-only redirect URIs" / "Client ID Metadata Documents cannot prevent `localhost` URL impersonation by themselves"
- `draft-ietf-oauth-client-id-metadata-document-00` §6.4: `client_id` 호스트명을 표시할 것. fetch 실패 시 그 URL 이 유일한 단서다
- 같은 draft §6.8 (Client ID Domain Trust): 인가서버는 **도메인 신뢰에 대해 자체 정책·휴리스틱을 둘 수 있다**. 신규 도메인에 추가 경고를 두는 예시가 명시돼 있다. 즉 호스트 기반 신뢰 정책은 규격이 열어 둔 길이다

**검증**: `client-trust.ts` 판정 10케이스 통과(정상 Claude·ChatGPT·loopback 2종·신고자 클라이언트·접미사 위장·서브도메인 위장·CIMD 3종).

**남은 개선안(미적용)**: draft §6.8 이 예시로 든 "이 클라이언트를 처음 승인하는 사용자에게 한 번 더 경고" 는 넣지 않았다. 사용자별 최초 승인 여부를 알아야 해서 grant 이력 조회가 필요하다. 필요해지면 별도 결정으로.

### `/register` 요청량 제한 (2026-09-02, 결정 P3)

앞선 보고에서 "등록 정책 훅에 `env` 가 없어 코드로는 불가"라고 적었는데 **틀렸다.** `OAuthProvider.fetch(request, env, ctx)` 가 공개 메서드라 한 겹 감싸면 `env` 를 쓸 수 있다. 콜백만 보고 단정했다.

**막으려는 것은 정보 유출이 아니라 가용성이다.** 등록(`client:` 키)은 명함일 뿐 아무 권한이 아니다. 권한은 사용자가 동의 화면에서 승인해야 생기는 `grant:` 다. 문제는 Workers **무료** 요금제의 **KV 쓰기 하루 1,000건** 한도다. 한도를 넘기면 그날 KV 쓰기가 전부 실패하고, 그러면 정상 사용자의 인증·토큰 갱신도 실패한다. 스크립트 한 대면 몇 분 만에 소진시킬 수 있다.

| 항목 | 값 |
|---|---|
| 실사용 | 월 13건 (2026-06 12 / 07 14 / 08 13) |
| `client:` 키 TTL | 약 90일 자동 만료 (실측 잔여 6.0~88.5일) |
| 4개월간 `grant` | 2건 (둘 다 정상 Claude) |
| KV 쓰기 여유 | 하루 1,000건 중 1건 미만 사용 |

**결정 P3**: Workers Rate Limiting 바인딩으로 `/register` 에 **IP당 5건/60초**. 실사용이 월 13건이라 정상 클라이언트는 닿지 않는다. 처음에 20건/60초로 잡았다가 운영 실측 후 낮췄다(아래 참조).

**채택하지 않은 대안**: Cloudflare 대시보드 WAF 규칙. `beauticslab.com` 은 zone 요금제가 Free 라 **규칙 1개·카운팅 10초·차단 10초** 가 상한이다. 5회/10초로 걸어도 하루 43,200건이 통과해 사실상 못 막으면서, 하나뿐인 무료 규칙을 소모한다.

**한계(명시)**: 카운터는 Cloudflare **지역별로 따로** 집계되고 eventually consistent 다(문서 명시). 분산 공격은 막지 못한다. 이건 보안 경계가 아니라 단일 출처 남용에 대한 보험이다. 진짜 경계는 동의 화면과 grant 승인이다.

**구현 메모**: `cf-connecting-ip` 가 없으면(로컬 dev 등) 제한을 걸지 않는다. 모든 요청이 한 키로 뭉쳐 서로를 막는 편이 더 해롭다. `period` 는 10 또는 60 만 허용된다.

**로컬 검증** (`wrangler dev --local`, 한도 20/60s): 같은 IP 25연타 → 1~20번 201, 21~25번 429. 다른 IP 는 201 정상. 정확히 명목대로 동작한다.

**회귀 확인**: AS 메타데이터·PRM·server-card 200, 인증 없는 `/mcp` 401, 없는 경로 404, `authorize` 302 모두 이상 없음.

### ★운영 실측이 로컬과 다르다 — 이 API 는 하드 캡이 아니다

로컬(miniflare)은 단일 프로세스라 명목대로 정확히 끊는다. **운영은 그렇지 않다.** 2026-09-02 실측:

| 부하 형태 | 결과 |
|---|---|
| 순차 25건 + 15건 (한도 20/60s) | **전부 201.** 한 건도 안 막힘 |
| 동시 30건 | 전부 201 |
| 동시 50 x 200건 | 153건 중 **101건 차단** |
| 초당 1건 x 90초 | 90건 중 **62건 차단** |
| 위 부하 직후 재측정 | 다시 전부 통과 |
| 한도 5/60s 로 낮춘 뒤 순차 20건 | 20건 중 1건 차단 |

원인은 문서에 적혀 있다. 카운터는 **Worker 가 도는 머신에 로컬 캐시**되고 같은 Cloudflare 지역의 배후 저장소와 **비동기로** 맞춰진다. 그래서 요청이 PoP 안 여러 머신에 흩어지면 초기에는 각 머신이 낮은 값만 보고 통과시킨다. Cloudflare 문서 자신이 *"permissive, eventually consistent, 정확한 계수 시스템으로 쓰도록 설계되지 않았다"* 고 명시한다.

**따라서 P3 은 "IP당 5건/60초를 넘으면 거부"가 아니다.** 실제 성질은 **지속적 남용의 감쇄**다. 빠른 대량 연타는 상당 부분 끊지만, 초당 1건 수준으로 꾸준히 두들기는 상대는 완전히 막지 못한다. 한도를 명목상 5로 낮춘 것은 이 undercount 를 보정하려는 것이다.

**남는 위험(수용)**: 페이스를 조절하는 공격자는 여전히 KV 하루 쓰기 한도(무료 1,000건)를 소진시킬 수 있다. 그 경우 피해는 **그날 하루 인증·토큰갱신 실패**이고 데이터 노출은 없다(등록은 명함일 뿐, 권한은 사용자가 승인한 grant 다). 정확히 막으려면 Durable Object 로 강한 일관성 카운터를 세워야 하는데, 이 기능의 실사용자가 2명인 현 시점에는 과잉이라 판단했다. 필요해지면 별도 결정으로.

**진단 흔적**: 원인 규명을 위해 `/__rl-debug` 경로를 잠시 배포했다가 제거했다(현재 404). 테스트로 생성된 `client:` 레코드는 삭제했다.

### 라이브러리 갱신 0.5.0 → 0.10.3

동반된 상위 동작 변화(우리 코드에 영향 있는 것만):
- **0.9.0**: public client가 PKCE를 생략하면 인가요청을 거부. 실측 확인.
- **0.10.0**: `parseAuthRequest()`가 `AuthorizationError`를 던진다. `redirectUri`는 클라이언트 검증을 통과한 경우에만 채워지므로, 채워졌을 때만 OAuth 에러 redirect하고 그 외는 로컬 렌더하도록 `handleAuthorize`를 고쳤다.
- **0.9.1**: DCR 응답에서 `registration_client_uri` 제거(RFC 7592 미구현이라 잘못된 광고였다).
- 메타데이터에 `authorization_response_iss_parameter_supported: true` 자동 추가(RFC 9207).

`clientIdMetadataDocumentEnabled: true`는 `global_fetch_strictly_public` 컴패트 플래그를 요구한다(CIMD 문서 fetch가 우리 zone 내부로 되돌아오는 SSRF 방지). 없으면 `OAuthProvider` 생성자가 throw하므로 `wrangler.jsonc`에 함께 넣었다.

### 검증 (2026-09-02, `wrangler dev --local`)

- 메타데이터: `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true`
- 등록 정책: 비 loopback 평문 http 400 / loopback http 201 / `redirect_uris` 11개 400
- PKCE 없는 public client 인가요청 → `error=invalid_request` + `iss` 포함 redirect
- PKCE 포함 인가요청 → bridge redirect에 `client_ctx` 부착, JWT 검증 통과(`kind=dcr`, `state` 결합 일치)
- 내부 API: 정상 서명 200 / 서명 훼손 401 / `grantId` 누락 400

### 보류

- **`/register` rate limit**: 등록 정책 훅에는 `env`가 주입되지 않아 KV 카운터를 쓸 수 없다. Cloudflare 대시보드의 Rate Limiting 규칙으로 거는 것이 맞다(설정 작업, 코드 아님).
- **MCP 규격 2026-07-28 전송계층 이전**: 세션 제거·`initialize` 폐지·`server/discover` 신설 등 대규모 변경이나, 공식 TypeScript SDK 최신판(1.30.0)의 `LATEST_PROTOCOL_VERSION`이 아직 `2025-11-25`다. SDK가 구현할 때까지 보류한다. CIMD는 OAuth 계층이라 이 대기와 무관하게 먼저 적용했다.
- **LICENSE 파일**: 외부 인덱스(M8ven)가 OSI 라이선스 파일을 권고하나, 결정 S3(Proprietary, All rights reserved)와 충돌한다. S3를 바꿀지는 별도 판단 사항.

---

## 추가 규칙

- 새 결정은 출처 문서(DESIGN, tools-spec, nextjs-integration 등)에서 합의·근거 작성 → 본 표에 ID + 포인터로 등록
- 기존 결정 변경 시 새 ID 부여하고 옛 ID는 `superseded by <새 ID>`로 표시
- ADR per file은 만들지 않음. 정말 큰 결정 (아키텍처 전환 수준)만 별도 문서 승격
