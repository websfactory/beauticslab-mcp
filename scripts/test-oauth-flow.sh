#!/usr/bin/env bash
# Step 4.2 OAuth bridge e2e 테스트 헬퍼.
# 사용법:
#   bash scripts/test-oauth-flow.sh         # PKCE+DCR+authorize URL 출력
#   bash scripts/test-oauth-flow.sh CODE    # code 받은 후 /token + tools/list 실행
set -euo pipefail

WORKER=http://localhost:8791
CLIENT_REDIRECT=http://localhost:9999/cb   # 클라이언트가 등록할 redirect_uri (실제 서버 불필요, URL 바만 읽으면 됨)
# Dev 회피: wrangler dev가 PRM endpoint와 /mcp endpoint에서 request.url origin을 다르게 처리
# (PRM=routes-rewritten production host, /mcp=실제 localhost). 양쪽 origin을 일치시키려면
# resource를 localhost로 고정해야 audience 검증이 통과. 프로덕션에서는 https://mcp.beauticslab.com/mcp 사용.
RESOURCE=http://localhost:8791/mcp
STATE_FILE=/tmp/mcp-oauth-flow.json

if [[ $# -eq 0 ]]; then
  # ---- Phase 1: PKCE + DCR + authorize URL ----
  # base64 출력의 줄바꿈/패딩 제거 후 43자 컷. 줄바꿈을 제거하지 않으면 verifier에 \n이 끼어 PKCE/JSON 깨짐.
  VERIFIER=$(openssl rand -base64 96 | tr -d '=+/\n' | cut -c1-43)
  if [[ ${#VERIFIER} -ne 43 ]]; then echo "verifier 생성 실패 (length=${#VERIFIER})" >&2; exit 1; fi
  CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=\n')
  STATE=$(openssl rand -hex 16)

  REGISTER_RES=$(curl -s -X POST "$WORKER/register" \
    -H 'content-type: application/json' \
    -d "{\"redirect_uris\":[\"$CLIENT_REDIRECT\"],\"client_name\":\"e2e-test\",\"grant_types\":[\"authorization_code\"],\"response_types\":[\"code\"],\"token_endpoint_auth_method\":\"none\"}")
  CLIENT_ID=$(printf '%s' "$REGISTER_RES" | jq -r .client_id)
  if [[ -z "$CLIENT_ID" || "$CLIENT_ID" == "null" ]]; then
    echo "DCR 실패: $REGISTER_RES" >&2; exit 1
  fi

  cat > "$STATE_FILE" <<EOF
{"verifier":"$VERIFIER","client_id":"$CLIENT_ID","state":"$STATE"}
EOF

  AUTH_URL="$WORKER/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=$(printf '%s' "$CLIENT_REDIRECT" | jq -sRr @uri)&code_challenge=$CHALLENGE&code_challenge_method=S256&state=$STATE&resource=$(printf '%s' "$RESOURCE" | jq -sRr @uri)&scope=mcp:read"

  echo "=== Phase 1 완료 ==="
  echo "client_id: $CLIENT_ID"
  echo "state(저장): $STATE_FILE"
  echo
  echo "다음 단계:"
  echo "1) 아래 URL을 브라우저에 붙여넣기 (beauticslab 로그인된 상태):"
  echo
  echo "$AUTH_URL"
  echo
  echo "2) 동의 페이지 → '동의' 클릭 → URL 바에 'http://localhost:9999/cb?code=<CODE>&state=...' 표시됨"
  echo "   (localhost:9999는 서버 없음. 'connection refused' 나와도 정상 — URL 바의 code만 복사)"
  echo "3) 받은 CODE로 다시 실행:"
  echo "   bash scripts/test-oauth-flow.sh <CODE>"
  exit 0
fi

# ---- Phase 2: /token 교환 + tools/list ----
CODE="$1"
if [[ ! -f "$STATE_FILE" ]]; then echo "$STATE_FILE 없음 — Phase 1부터 다시 실행" >&2; exit 1; fi
VERIFIER=$(jq -r .verifier "$STATE_FILE")
CLIENT_ID=$(jq -r .client_id "$STATE_FILE")

echo "=== Phase 2: /token ==="
TOKEN_RES=$(curl -s -X POST "$WORKER/token" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "code_verifier=$VERIFIER" \
  --data-urlencode "redirect_uri=$CLIENT_REDIRECT" \
  --data-urlencode "resource=$RESOURCE")
echo "$TOKEN_RES" | jq .
ACCESS_TOKEN=$(printf '%s' "$TOKEN_RES" | jq -r .access_token)
TOKEN_RESOURCE=$(printf '%s' "$TOKEN_RES" | jq -r .resource)

if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
  echo "토큰 발급 실패" >&2; exit 1
fi

echo
echo "=== 검증 1: 토큰 응답의 resource = $RESOURCE ==="
if [[ "$TOKEN_RESOURCE" == "$RESOURCE" ]]; then
  echo "✅ resource = $TOKEN_RESOURCE"
else
  echo "❌ resource mismatch: got=$TOKEN_RESOURCE expected=$RESOURCE"
fi

echo
echo "=== 검증 2: tools/list (Bearer + audience 검증 통과) ==="
curl -s -X POST "$WORKER/mcp" \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | sed 's/^data: //' | jq '.result.tools[]?|{name,description}' 2>/dev/null || echo "응답 파싱 실패 — raw:"

echo
echo "=== 검증 3: tools/list 무토큰 → 401 (audience 자동 검증 동작) ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$WORKER/mcp" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
[[ "$STATUS" == "401" ]] && echo "✅ 401" || echo "❌ status=$STATUS"
