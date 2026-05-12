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
| 10.4 | 토큰 revoke UX | v1엔 안 만듦 | deferred → v2 | DESIGN §10.4 |
| 10.5 | 멀티 클라이언트 | workers-oauth-provider grant 분리로 자동 지원 | active | DESIGN §10.5 |
| 10.6 | 로그·관측 | Cloudflare Logs + `mcp:tool:<name>` scope | active | DESIGN §10.6 |
| 10.7 | 클라이언트 등록 | DCR만 (CIMD는 v1.x 검토) | active | DESIGN §10.7 |
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
| K | consent CSRF/state 바인딩 | 명시 | active | DESIGN §3.1 |

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

## 추가 규칙

- 새 결정은 출처 문서(DESIGN, tools-spec, nextjs-integration 등)에서 합의·근거 작성 → 본 표에 ID + 포인터로 등록
- 기존 결정 변경 시 새 ID 부여하고 옛 ID는 `superseded by <새 ID>`로 표시
- ADR per file은 만들지 않음. 정말 큰 결정 (아키텍처 전환 수준)만 별도 문서 승격
