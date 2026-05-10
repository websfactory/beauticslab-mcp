# beauticslab-mcp

beauticslab.com의 원격 MCP(Model Context Protocol) 서버. ChatGPT, Claude, Cursor 사용자가 자기 AI 클라이언트에서 beauticslab 기능을 사용할 수 있게 한다.

## 상태

v1 설계 단계. 구현 시작 전.

- 설계 문서: [`docs/DESIGN.md`](docs/DESIGN.md)
- 다음 세션 진입점: [`docs/HANDOFF.md`](docs/HANDOFF.md)

## 아키텍처 한 줄

Cloudflare Worker(`mcp.beauticslab.com`) + Next.js(`beauticslab.com`)가 OAuth 2.1로 연결되며, MCP 클라이언트는 Worker에 붙고, Worker는 HMAC 서명된 server-to-server 호출로 Next.js 내부 API를 호출한다.

## 폴더

```
beauticslab-mcp/
├── docs/            설계 문서, 핸드오프, 후속 합의
├── src/             Worker 코드 (구현 전)
├── tests/interop/   Claude/Cursor/ChatGPT 수동 스모크 절차
└── wrangler.jsonc   (구현 시 추가)
```

## 관련 프로젝트

- `beauticslab/` Next.js + Flask + FastAPI + MariaDB 풀스택 (cafe24 운영)
- 스킬 문서: `.claude/skills/beauticslab/`
