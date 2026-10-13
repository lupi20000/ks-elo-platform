#!/usr/bin/env bash
# ELO 관리자 서버 보관함(KV) 'ks-elo-data' 의 ID 를 찾는다. 없으면 만든다. (클라우드플레어 API 직접 호출)
# 필요: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.  출력: 보관함 ID 한 줄
set -euo pipefail
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces"
H=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")
id=$(curl -fsS "${H[@]}" "$API?per_page=100" | python3 -c "import json,sys; print(next((n['id'] for n in json.load(sys.stdin)['result'] if n['title']=='ks-elo-data'),''))")
if [ -z "$id" ]; then
  id=$(curl -fsS "${H[@]}" -X POST "$API" -d '{"title":"ks-elo-data"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['id'])")
fi
echo "$id"
