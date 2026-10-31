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
        t = re.sub(r"[\u200b-\u200f\ufeff]", "", v.get("b") or "")
        labs = list(re.finditer(r"[A-Za-z0-9가-힣]?\s*선수[^:：\n]*[:：]", t)); rm = re.search(r"결과[^:：\n]*[:：]", t)
        if len(labs) >= 2 and rm:
            a = cafe._player(t[labs[0].end():labs[1].start()]); b = cafe._player(t[labs[1].end():rm.start()])
            raw = lambda x: " ".join(f"U+{ord(c):04X}" if not c.isalnum() and not c.isspace() and ord(c) > 127 else ("A" if c.isascii() and c.isalpha() else c) for c in x)
            print("   결과칸:", repr(raw(t[rm.end():])[:120]), "| 칸수", len(labs), "| parse_form:", cafe.parse_form(v.get("b") or "") != [])
            print("   진단: A선수", bool(a), repr(raw(t[labs[0].end():labs[1].start()])[:80]), "| B선수", bool(b), repr(raw(t[labs[1].end():rm.start()])[:80]))
        else:
            print("   진단: 칸 찾기 실패", len(labs), bool(rm))
        print(f"--- 제목: {mask(v.get('t') or '')} | 본문 {len(str(v.get('b') or ''))}자:", " / ".join(body)[:300])
print("읽힘", ok, "· 못 읽음", bad)
