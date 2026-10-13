#!/bin/bash
# kS ELO 카페 수집 준비 — VM 에서 한 번만. (cafe-toto 폴더는 건드리지 않는다)
#  사용: ELO_INGEST_KEY=받은열쇠 bash setup.sh
set -e
HERE="$HOME/ks-elo-cafe"
PY="$HOME/cafe-toto/.venv/bin/python"; [ -x "$PY" ] || PY=python3
mkdir -p "$HERE/data" "$HERE/logs"
cp "$(dirname "$0")/push.py" "$HERE/"
if [ -n "${ELO_INGEST_KEY:-}" ]; then echo "ELO_INGEST_KEY=$ELO_INGEST_KEY" > "$HERE/.env"; chmod 600 "$HERE/.env"; fi
[ -s "$HERE/.env" ] || { echo ".env 에 ELO_INGEST_KEY 가 없습니다"; exit 1; }
echo "== 처음 한 번: 게시판 전체 보내기 =="
cd "$HERE" && PYTHONIOENCODING=utf-8 "$PY" push.py --all | tail -5
echo "== 매일 새벽 4시 37분 예약 (사이트 갱신 5시 7분 전에) =="
LINE="37 4 * * * cd $HERE && PYTHONIOENCODING=utf-8 $PY push.py >> $HERE/logs/push.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'ks-elo-cafe' ; echo "$LINE" ) | crontab -
crontab -l | grep ks-elo-cafe
echo "끝났습니다."
