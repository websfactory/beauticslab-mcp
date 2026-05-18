# beauticslab-mcp 외부 디렉토리 등록 — 후속 작업

작성: 2026-05-17
업데이트: 2026-05-18 (Smithery 등재 완료 + Glama 자동 인덱싱 확인)
선행: MCP Registry 등록 완료 (`com.beauticslab/mcp`), Claude Desktop + ChatGPT attach 검증 완료

## 진행 상태

| 항목 | 상태 |
|---|---|
| MCP Registry (`com.beauticslab/mcp`) | 완료 (2026-05-17, v1.0.1 메타데이터 정정 2026-05-18) |
| Claude Desktop attach | 검증 완료 (2026-05-17, README 한글 흐름 보강) |
| ChatGPT attach | 검증 완료 (2026-05-17, README 한글 흐름 보강) |
| Smithery (smithery.ai) | **완료 (2026-05-18)** — Public, Quality 84/100, Verification 5/6, [페이지](https://smithery.ai/servers/websfactoryinfo/beauticslab) |
| Glama (glama.ai) | **자동 인덱싱 됨 (Registry 기반)** — [페이지](https://glama.ai/mcp/connectors/com.beauticslab/mcp). Status: Unhealthy (OAuth 401 false positive) |
| Product Hunt | **미등록 — 자료 준비 후 런칭** |
| mcp.so 등 기타 디렉토리 | 후순위 |

## Smithery 등재 결과 (2026-05-18)

- **URL**: https://smithery.ai/servers/websfactoryinfo/beauticslab
- **Namespace**: websfactoryinfo (개인 namespace)
- **Visibility**: Public (검색·카테고리 노출)
- **Quality Score**: 84/100
- **Verification**: 5/6 통과
  - ✅ Successful release / ✅ Quality > 80 / ✅ Homepage / ✅ TXT record / ✅ Link to Smithery
  - ⬜ Paid plan (무료 유지 결정, "Verified" 배지는 미발급)
- **자동화 노트**:
  - server-card.json (`/.well-known/mcp/server-card.json`)을 OAuth-blocked scanner 우회용으로 호스팅 → 도구 3개 자동 인식 성공
  - 등록 폼 + Settings 입력은 openclaw `beauticslab` 프로필로 자동화 (visibility/icon 토글만 React 컴포넌트 제약으로 수동)
- **TXT 인증값**: `smithery-verification=68e086e3e722a43f8dec04d63c60c008267a2901ceb7082a0d0dd4f15c618f37` (beauticslab.com apex)
- **백링크**: README.md/README_en.md 양쪽 헤더 서비스 라인에 Smithery 링크 추가 (commit e377890)

## Glama 자동 인덱싱 결과 (2026-05-18 확인)

- MCP Registry 등록(2026-05-17) → Glama가 자동 크롤. 24~72시간 대기 불필요
- 모든 메타데이터 Registry server.json 그대로 사용 (description, repo, transport)
- ⚠️ Status: **Unhealthy** — OAuth 인증 필수 서버라 health check가 401을 실패로 해석. 일반적 함정. 실제 클라이언트 사용엔 무관
- 개선 옵션: "Claim this connector" → 도메인 검증 (TXT 이미 존재) → 메타데이터 직접 통제. 우선순위 낮음

---

## 공통 자료 (모든 디렉토리에서 재사용)

- **서버명**: BeauticsLab MCP (한글: 뷰틱스랩 MCP)
- **엔드포인트**: `https://mcp.beauticslab.com/mcp`
- **Registry ID**: `com.beauticslab/mcp`
- **Transport**: Streamable HTTP (MCP 2025-11-25)
- **인증**: OAuth 2.1 + DCR (Google / Kakao)
- **도구 3개**:
  - `get_my_routine` — 내 스킨케어 루틴 조회 (성분 포함 옵션)
  - `search_product` — 제품 검색 (이름/브랜드/카테고리)
  - `get_product_ingredients` — 제품 성분 분석
- **검증된 클라이언트**: Claude Desktop, ChatGPT (Apps), Claude Code CLI
- **GitHub**: (필요시 repo 링크 — public 여부 확인)
- **레퍼런스 문서**: README.md, docs/nextjs-integration.md

### 영문 설명

- **Tagline (영)**: "AI assistant integration for Korean skincare — your routine, products, and ingredients on demand."
- **Description (영)**: "Connect Claude, ChatGPT, and other MCP clients to BeauticsLab — Korea's curated cosmetics ingredient database. Browse your personal skincare routine, search across thousands of products, and inspect full ingredient breakdowns directly inside your AI assistant. OAuth-secured, no data leaves your account."

### 한글 설명

- **Tagline (한)**: "AI 어시스턴트에서 내 스킨케어 루틴·제품·성분을 한 번에"
- **Description (한)**: "Claude, ChatGPT, 그 외 MCP 클라이언트를 BeauticsLab — 국내 큐레이션 화장품 성분 데이터베이스 — 와 연결. 내 루틴 조회, 수천 개 제품 검색, 성분 풀데이터까지 AI 채팅 안에서 바로. OAuth 인증으로 본인 데이터만 접근."

### 태그 / 카테고리

- skincare, cosmetics, korean-beauty, k-beauty, ingredients, routine, beauty, lifestyle, health

---

## 1. Smithery (smithery.ai)

### 등록 절차 (다음 세션에 사용자가 직접 진행)

1. smithery.ai 가입 + 로그인
2. "Add a server" / "New server" 메뉴 → 등록 양식
3. 입력값 (위 공통 자료에서 가져가기)
   - Name: `BeauticsLab`
   - URL: `https://mcp.beauticslab.com/mcp`
   - Description: 영문 Description 사용
   - Category: Beauty / Lifestyle (Smithery 카테고리 옵션에 맞춰 선택)
   - Tags: 위 태그 목록
   - Tools: 도구 3개 이름 + 설명 입력 (필드가 있다면)
4. 제출 → Smithery 측 검수 (자동/수동 여부 확인)
5. 등록되면 README "검증된 도구" 섹션에 Smithery 링크 추가

### 참고

- Smithery는 MCP Registry와 별개 디렉토리. 등록 양식은 수동
- DCR 사용 명시 (Client ID/Secret 비워두기 안내 필드가 있다면 그대로)

---

## 2. Glama (glama.ai)

### 확인 절차

1. WebFetch로 `https://glama.ai/mcp/servers` 또는 검색 페이지에서 "beauticslab" 조회
2. 미인덱싱이면 24~72시간 대기 후 재확인 (Glama는 MCP Registry 자동 크롤링이라고 알려짐)
3. 일정 시간 후에도 미인덱싱이면 Glama 측에 수동 등록 폼이 있는지 확인

### 등록 후

- README "검증된 도구" 섹션에 Glama 링크 추가
- Glama 페이지의 README/메타데이터가 GitHub README를 가져오는지 확인

---

## 3. Product Hunt 런칭

### 별개 큰 작업 — 자료 준비 필요

MCP 등록 디렉토리가 아니라 일반 제품 런칭 플랫폼. 더 큰 마케팅성 자료 필요.

### 필요 자료 체크리스트

- [ ] **Tagline**: 60자 이내 핵심 가치 (영문)
- [ ] **Description**: 260자 이내 (제품 한 줄 설명)
- [ ] **Gallery**: 스크린샷/GIF 4~6개
  - Claude Desktop에서 사용하는 GIF (Step 7 데모 GIF 재활용 가능)
  - ChatGPT에서 사용하는 GIF
  - 도구 호출 결과 화면 (루틴/제품/성분 각 1장)
  - Hero 이미지 (서버 로고 + 핵심 문구)
- [ ] **Makers 프로필**: 본인 + (있다면) 협업자
- [ ] **Topics/Tags**: AI, Developer Tools, Productivity, Beauty
- [ ] **First comment** (런칭 직후 메이커가 다는 코멘트): 만든 이유 + 사용법 1문단
- [ ] **런칭 날짜·시간**: KST 기준 결정 (PT 자정 직후가 한국 오후 4시 — 그 시간대 트래픽 노출 유리)

### 런칭 후 액션

- README 상단에 "Featured on Product Hunt" 배지 추가
- BeauticsLab 본 사이트 / SNS 채널에서 Product Hunt 페이지 공유 (upvote 유도)

---

## 4. 기타 디렉토리 후보 (후순위)

- **mcp.so** — MCP 서버 디렉토리 사이트. 등록 절차 확인 필요
- **punkpeye/awesome-mcp-servers** (GitHub) — Awesome 리스트. PR로 추가
- **modelcontextprotocol.io showcase** — 공식 사이트에 showcase 섹션 있다면 등록
- **MCP Hub / MCP Servers** — 기타 커뮤니티 디렉토리

---

## 다음 세션 시작 시 진행 순서

1. 이 문서 첫 줄부터 읽어서 상태 파악
2. **Smithery 등록** (사용자가 smithery.ai에서 직접, 위 공통 자료 복붙)
3. **Glama 인덱싱 확인** (Claude가 WebFetch로 조회)
4. **Product Hunt 자료 준비 시작** (가장 시간이 많이 드는 작업, 분리 진행)

각 등록 완료 후 README "검증된 도구" 섹션에 링크 누적 추가.
