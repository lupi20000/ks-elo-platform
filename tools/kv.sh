#!/usr/bin/env bash
# 관리자 서버 보관함(KV) 값 읽기/쓰기 (클라우드플레어 API 직접 호출)
#   bash tools/kv.sh get <키> <저장할 파일>
#   bash tools/kv.sh put <키> <올릴 파일>
# 필요: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, KV_NS
set -euo pipefail
key=$(python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" "$2")
URL="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_NS/values/$key"
case "$1" in
  get) curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$URL" -o "$3" ;;
  put) curl -fsS -X PUT -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: text/plain" --data-binary "@$3" "$URL" > /dev/null ;;
  *) echo "get 또는 put" >&2; exit 2 ;;
esac
