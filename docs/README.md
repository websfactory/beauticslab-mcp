# beauticslab-mcp 문서 인덱스

beauticslab.com 사용자가 ChatGPT/Claude/Cursor 등에서 자기 스킨케어 데이터를 활용할 수 있게 하는 원격 MCP 서버. Cloudflare Worker(`mcp.beauticslab.com`) + Next.js login bridge.

상태: production live (2026-05-11~), Step 6(사용자 README + 클라이언트 E2E 검증) 완료 (2026-05-12).

## 진입 순서 (새 세션이 처음 보는 경우)

1. `handoffs/`에서 날짜 가장 최근 파일: 지금 어디까지 됐고 다음에 뭘 할지
2. 루트 `../README.md`: 사용자용 가이드 (클라이언트 7종 연결법 + FAQ)
3. `DESIGN.md`: 전체 아키텍처와 핵심 결정
4. `tools-spec.md`: v1 tool 2개의 입출력 contract
5. `nextjs-integration.md`: Next.js 측 통합 contract

## 문서 목록

### 사용자용
| 파일 | 역할 |
|---|---|
| `../README.md` | 사용자용 한국어 가이드. 클라이언트 7종 연결법 + FAQ + 지원/라이선스 |
| `../README_en.md` | 영문 (한국어 베타 안정화 후 작성 예정) |

### 내부 설계
| 파일 | 역할 | 상태 |
|---|---|---|
| `DESIGN.md` | 시스템 아키텍처, 토큰 모델, 보안 모델, 배포 모델 | v0.3 |
| `tools-spec.md` | `search_product`, `get_my_routine` 입출력 스펙 | v1.1 |
| `nextjs-integration.md` | `/oauth/mcp-bridge`, HMAC 미들웨어, 신규 라우트·service contract | v1.0 (Codex 1차 리뷰 반영) |
| `decisions.md` | 모든 결정 통합 인덱스 (DESIGN §10, tools-spec A~K, nextjs §9 N1~N8, Step 6 S1~S6) | active |
| `research-dossier.md` | F1~F13 외부 자료 분석 (라이브러리·spec·선행 사례 조사) | reference |
| `research/clients-2026-05-12.md` | 클라이언트 4종 공식 docs 조사 + prod 서버 메타데이터/DCR/CORS 검증 결과 | reference |

### 핸드오프
| 파일 | 역할 |
|---|---|
| `handoffs/*.md` | 세션별 진행 상태 + 다음 액션 (가장 최근 파일이 현재) |
| `handoffs/done/YYYY-MM/` | 완료된 핸드오프 (보존) |

## 향후 추가 후보

- `deployment.md`: Cloudflare 배포 + cafe24 환경변수 주입 절차
- `testing.md`: 로컬 dev e2e 테스트 절차
- `directory-listing.md`: MCP 디렉터리(modelcontextprotocol.io/servers, mcp.so) 등록용 발췌본

## 문서 운영 규칙

- **handoffs**: 파일명 `YYYY-MM-DD-<slug>.md` 형식. `active.md` 같은 sentinel 안 씀. 같은 날 여러 건 가능. 완료된 건은 `done/YYYY-MM/`로 이동
- **결정**: `decisions.md`에 ID + 포인터 형식으로 누적. 본문은 원래 문서에 둠
- **버전**: 본 문서 자체는 버전 안 매김. 각 문서 frontmatter/heading에 버전 표기
- **분리 임계치**: 단일 문서가 1000줄 넘어가면 분리 검토. 그 전엔 평면 유지
