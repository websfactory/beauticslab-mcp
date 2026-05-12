# BeauticsLab MCP

[BeauticsLab](https://beauticslab.com)의 화장품/스킨케어 데이터와 내 루틴을, 내가 쓰는 AI 도구(Claude, ChatGPT, Cursor 등)에서 직접 불러올 수 있게 해 주는 원격 MCP 서버.

[English](./README_en.md) · 조사일 기준: 2026-05-12

![BeauticsLab MCP demo](./docs/demo.gif)

> Claude Desktop에서 BeauticsLab MCP 호출: 비타민C 세럼 추천 → 내 루틴과 겹치는지 확인까지 40초. ([고화질 영상](https://github.com/user-attachments/assets/70f9f9ac-2a72-466c-9c19-9f5e7a3576a1))

---

## 한눈에

- **Endpoint**: `https://mcp.beauticslab.com/mcp`
- **연결 방식**: 각 AI 도구의 "Custom Connector / MCP Server 추가" UI에 위 URL 입력 → BeauticsLab 계정으로 로그인 → 권한 허용
- **계정**: [beauticslab.com](https://beauticslab.com) Google/Kakao 로그인 계정
- **상태**: 베타 (무료)

---

## 무엇을 할 수 있나

자기 AI에서 자연어로 호출하면 됩니다.

- "수분 크림 추천해줘" → 올리브영·에누리·다이소 및 BeauticsLab 검증 카탈로그에서 검색
- "내 루틴 보여줘" → BeauticsLab에 저장해 둔 본인 스킨케어 루틴 조회
- 이후 AI가 위 결과를 바탕으로 비교·추천·답변 생성

> 읽기 전용입니다. 데이터 수정/생성 도구는 없습니다.

---

## 노출되는 도구

| 도구 | 설명 |
|---|---|
| 제품 검색 | 키워드로 화장품/스킨케어 제품 검색 (한국어 권장) |
| 내 루틴 조회 | 본인 BeauticsLab 계정의 루틴 리스트 + 제품 + (선택) 성분 |

다른 사용자 데이터는 조회할 수 없습니다. 본인 계정 범위로만 작동합니다.

---

## 연결하기

도구별 단계가 다릅니다. 자기가 쓰는 도구의 섹션만 보면 됩니다.

### Claude Desktop · claude.ai

지원 플랜: Free / Pro / Max / Team / Enterprise (Free는 custom connector 1개 제한, 베타)

**Claude Desktop**
1. `Settings → Connectors` 진입
2. 화면 하단 **"Add custom connector"** 클릭
3. URL에 `https://mcp.beauticslab.com/mcp` 입력 후 Add
4. 새 브라우저 창에서 BeauticsLab 로그인 → "허용" → Claude로 돌아옴
5. 새 채팅에서 "내 BeauticsLab 루틴 보여줘" 시도

**claude.ai 웹 (Pro/Max)**
1. `Customize → Connectors → +` (Add custom connector)
2. URL 입력 → 이하 동일

**claude.ai Team / Enterprise**
- 조직 오너가 `Organization settings → Connectors → Add → Custom → Web`에서 등록
- 멤버는 `Customize → Connectors`에서 활성화

> Advanced settings의 Client ID/Secret 필드는 **비워 두세요**. 서버가 동적 클라이언트 등록(DCR)을 처리합니다.

출처: [Anthropic: Custom connectors with remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

---

### ChatGPT

지원 플랜: Plus / Pro / Business / Enterprise / Edu (2025-11-13~). "Connectors"는 2025-12-17부터 공식적으로 **"Apps"**로 표기됩니다.

1. `Settings → Apps & Connectors → Advanced settings → Developer Mode` 토글 ON
2. `Settings → Apps & Connectors → Create`
3. 입력값
   - Name: `BeauticsLab`
   - Connector URL: `https://mcp.beauticslab.com/mcp`
4. 저장하면 OAuth 인증 페이지로 이동 → BeauticsLab 로그인 → 허용
5. 새 대화에서 BeauticsLab 도구 호출

> ChatGPT는 등록 시 "OpenAI가 검증하지 않은 커스텀 MCP 서버" 경고 배너를 표시합니다. 정상입니다.

출처: [OpenAI: Connect from ChatGPT (Apps SDK)](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt)

---

### Cursor

설정 파일 위치 (둘 중 하나):
- 전체 적용: `~/.cursor/mcp.json`
- 프로젝트 한정: `<프로젝트>/.cursor/mcp.json`

내용:

```json
{
  "mcpServers": {
    "beauticslab": {
      "url": "https://mcp.beauticslab.com/mcp"
    }
  }
}
```

UI에서 추가하려면 `Cursor Settings → Tools & MCP → New MCP Server`.

저장 후 Cursor가 자동으로 브라우저 OAuth 팝업을 띄웁니다. BeauticsLab 로그인 → 허용 → 자격증명은 Cursor가 보관합니다 (JSON에 노출되지 않습니다).

출처: [Cursor: Model Context Protocol](https://cursor.com/docs/mcp)

---

### VS Code (GitHub Copilot Chat)

설정 파일 위치:
- 워크스페이스: `.vscode/mcp.json`
- 사용자 전역: 커맨드 팔레트 → `MCP: Open User Configuration`

내용:

```json
{
  "servers": {
    "beauticslab": {
      "type": "http",
      "url": "https://mcp.beauticslab.com/mcp"
    }
  }
}
```

> 참고: VS Code MCP 클라이언트의 OAuth 자동 흐름은 공식 문서가 아직 빈약합니다. OAuth 처리가 자동으로 트리거되지 않으면 [Cline 확장](#cline-vs-code-확장)을 대안으로 권장합니다.

출처: [VS Code: MCP configuration reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration)

---

### Cline (VS Code 확장)

OAuth + DCR 흐름이 가장 매끄럽게 검증됨.

1. Cline 사이드바 → **Remote Servers** 탭
2. URL 입력: `https://mcp.beauticslab.com/mcp`
3. **Authenticate** 버튼 → 브라우저 OAuth → 자격증명 영구 저장

또는 config 직접 편집:

```json
{
  "mcpServers": {
    "beauticslab": {
      "url": "https://mcp.beauticslab.com/mcp",
      "type": "streamableHttp",
      "disabled": false,
      "autoApprove": [],
      "timeout": 60
    }
  }
}
```

출처: [Cline: Connecting to a Remote Server](https://docs.cline.bot/mcp/connecting-to-a-remote-server)

---

### Zed

`settings.json`의 `context_servers` 항목에 추가:

```json
{
  "context_servers": {
    "beauticslab": {
      "url": "https://mcp.beauticslab.com/mcp"
    }
  }
}
```

Authorization 헤더 없이 저장하면 Zed가 표준 MCP OAuth 흐름으로 자동 안내합니다.

출처: [Zed: Model Context Protocol](https://zed.dev/docs/ai/mcp)

---

### 기타 MCP 호환 클라이언트

위에 없는 클라이언트라도 다음 조건을 만족하면 동작합니다.

- MCP **Streamable HTTP** transport 지원
- **OAuth 2.1 + PKCE(S256)** 지원
- 가급적 **Dynamic Client Registration(DCR)** 지원 (없으면 사전 등록 client 필요)

Endpoint만 알면 됩니다: `https://mcp.beauticslab.com/mcp`

클라이언트별 호환성은 [modelcontextprotocol.io/clients](https://modelcontextprotocol.io/clients) 참고.

---

## 인증 / 권한

- 프로토콜: OAuth 2.1 + PKCE(S256) + Dynamic Client Registration
- 스코프: `mcp:read` (읽기 전용)
- 로그인 주체: BeauticsLab 계정 (Google / Kakao 소셜 로그인)
- 익명 모드 없음: 모든 호출은 사용자 컨텍스트가 필요합니다

서버 메타데이터 (확인용):
- `https://mcp.beauticslab.com/.well-known/oauth-protected-resource`
- `https://mcp.beauticslab.com/.well-known/oauth-authorization-server`

---

## FAQ

**Q. 내 게시글이나 루틴이 외부로 유출되나요?**
아니오. 본인 계정으로 인증한 AI 세션에서만 본인 데이터에 접근합니다. 다른 사용자의 데이터는 조회할 수 없습니다. 응답은 사용자가 사용 중인 AI 클라이언트에만 전달됩니다.

**Q. 어떤 AI 도구가 지원되나요?**
검증된 도구: Claude Desktop, claude.ai, ChatGPT, Cursor, Cline, Zed, VS Code(Copilot Chat). 그 외에도 MCP 2025-11-25 표준의 Streamable HTTP + OAuth 2.1을 지원하는 모든 클라이언트가 호환됩니다.

**Q. 데이터 출처는 어디인가요?**
올리브영, 에누리, 다이소 등 공개 카탈로그와 BeauticsLab에서 검증한 커스텀 제품입니다.

**Q. 한국어/영어 어느 쪽이 잘 검색되나요?**
한국어 쿼리를 권장합니다. 영어 쿼리도 가능하지만 검색 정확도가 떨어질 수 있습니다.

**Q. 연결을 끊거나 권한을 회수하려면?**
사용 중인 AI 클라이언트의 Connectors/MCP 설정에서 BeauticsLab 항목을 제거하면 됩니다. 토큰은 클라이언트 쪽에 보관되며 만료 시 자동 폐기됩니다.

**Q. 사용량 제한이 있나요?**
베타 단계이므로 SLA를 보장하지 않습니다. 비정상적 트래픽 패턴은 차단될 수 있습니다.

---

## 프라이버시

데이터 수집·보관·삭제 및 제3자 공유 방침은 BeauticsLab 본사이트의 [개인정보처리방침](https://beauticslab.com/privacy)을 따릅니다.

---

## 지원

- 문의 / 이슈 신고: [BeauticsLab 사이트의 카카오톡 문의하기](https://beauticslab.com)

---

## 라이선스

Proprietary. All rights reserved. © BeauticsLab.

외부 기여(Pull Request)는 현재 받지 않습니다. 이슈 리포트는 위 지원 채널로 전달해 주세요.
