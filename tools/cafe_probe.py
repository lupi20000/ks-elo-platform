"""카페 수집 점검 (일회용): 받은 글 수·본문 유무·못 읽는 글의 '모양'만 출력. 아이디·영문은 가려서 공개 로그에 남지 않게 한다."""
import json, re, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import cafe
P = json.load(open(sys.argv[1], encoding="utf-8"))
print("받은 글", len(P), "· 본문 있는 글", sum(1 for v in P.values() if str(v.get("b") or "").strip()))
mask = lambda s: re.sub(r"[0-9]+", "9", re.sub(r"[A-Za-z][A-Za-z0-9_.\-\[\]]*", "A", s))
ok = bad = 0; shown = 0
for aid, v in sorted(P.items(), key=lambda x: -int(x[0])):
    w = v.get("w") or ""
    found = cafe.parse_text(v.get("t") or "", w) or cafe.parse_form(v.get("b") or "")
    if not found:
      for line in str(v.get("b") or "").splitlines():
        found += cafe.parse_text(line, w)
    if found: ok += 1; continue
    bad += 1
    if shown < 25:
        shown += 1
        body = [mask(l.strip()) for l in str(v.get("b") or "").splitlines() if l.strip()][:6]
        print(f"--- 제목: {mask(v.get('t') or '')} | 본문 {len(str(v.get('b') or ''))}자:", " / ".join(body)[:300])
print("읽힘", ok, "· 못 읽음", bad)
