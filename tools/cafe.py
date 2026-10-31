# -*- coding: utf-8 -*-
"""
네이버 카페 'Elo 결과입력란' 게시판에서 경기 결과 모으기

  python tools/cafe.py            # 설정: 환경변수 ELO_CAFE_FILE (JSON)
                                  #   {"enabled": true, "clubid": 30800617, "menuid": 71, "url": "..."}
  NAVER_COOKIE=...  (선택)        # 있으면 글 본문까지 읽음(카페 회원 로그인 쿠키). 없으면 제목만.

결과
  out/cafe_games.json : 읽어낸 세트 목록 (리그 "ELO", 출처 "카페")
  out/srcstat.json    : "cafe" 항목에 상태 + 못 읽은 글 목록(unparsed, 최대 30개)

글 모양이 정해져 있지 않아서 아래 같은 모양을 너그럽게 읽는다.
  A 승 B 패 · A > B · A vs B 승자 A · [ELO] 날짜 맵 A 승 B · vs B 2:0 승(글쓴이가 A) · VS B 0:3 B 승
읽지 못한 글은 지우지 않고 목록으로 남겨서 관리자가 볼 수 있게 한다.
"""
import json, os, re, sys, time, html, datetime as dt
import urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "out")
KST = dt.timezone(dt.timedelta(hours=9))
NOW = dt.datetime.now(KST)
LIST_API = ("https://apis.naver.com/cafe-web/cafe2/ArticleListV2dot1.json"
            "?search.clubid={clubid}&search.menuid={menuid}&search.page={page}&search.perPage=50")
BODY_API = "https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/{clubid}/articles/{aid}?useCafeId=true"
MAX_PAGES = 40
ID_RE = r"[A-Za-z0-9_.\-]{2,20}"              # 게임 아이디로 볼 수 있는 글자(한글 별명은 신원 확인 불가라 제외)
RACE = r"(?:\(\s*[PTZptz]\s*\))?"


def get_json(url, cookie=None):
    h = {"User-Agent": "Mozilla/5.0", "Referer": "https://cafe.naver.com/"}
    if cookie:
        h["Cookie"] = cookie
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30).read().decode("utf-8"))


def clean_id(s):
    """'[kS]' 꼬리표·종족 괄호 떼기"""
    s = re.sub(r"\[\s*ks\s*\]", "", s or "", flags=re.I)
    s = re.sub(r"\(\s*[PTZptz]\s*\)", "", s)
    return s.strip(" .,:;/|-")


def race_of(s):
    m = re.search(r"\(\s*([PTZptz])\s*\)", s or "")
    return m.group(1).upper() if m else ""


def is_id(s):
    return bool(re.fullmatch(ID_RE, s or ""))


def find_date(text, default):
    m = re.search(r"(20\d{2}|\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})", text)
    if m:
        y = int(m.group(1)); y += 2000 if y < 100 else 0
        try:
            return dt.date(y, int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    return default


def parse_text(text, writer):
    """
    글(제목 또는 본문 한 줄) → [(승자, 패자, 승종족, 패종족, 맵, 세트수)] 또는 [] (못 읽음)
    writer = 글쓴이 별명 (제목이 'vs 상대' 로 시작하면 왼쪽 선수로 씀)
    """
    t = html.unescape(text or "").strip()
    t = re.sub(r"^\s*\[[^\]]*elo[^\]]*\]\s*", "", t, flags=re.I)        # [ELO] 머리표
    t = re.sub(r"\b(20)?\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}\.?", " ", t)  # 날짜 지우기
    mp = ""
    mm = re.search(r"(?:맵|map)\s*[:：]?\s*([^\s,/|]+)", t, flags=re.I)
    if mm:
        mp = mm.group(1)
    P = rf"({ID_RE}(?:\s*\[\s*k[sS]\s*\])?\s*{RACE})"

    # 1) A 승 B 패  /  A 승 B
    m = re.search(rf"{P}\s*승\s*[,/]?\s*{P}(?:\s*패)?", t)
    if m:
        return [(m.group(1), m.group(2), mp, 1)]
    # 2) B 패 A 승
    m = re.search(rf"{P}\s*패\s*[,/]?\s*{P}\s*승", t)
    if m:
        return [(m.group(2), m.group(1), mp, 1)]
    # 3) A > B  /  B < A
    m = re.search(rf"{P}\s*>\s*{P}", t)
    if m:
        return [(m.group(1), m.group(2), mp, 1)]
    m = re.search(rf"{P}\s*<\s*{P}", t)
    if m:
        return [(m.group(2), m.group(1), mp, 1)]
    # 4) [A] vs B [점수] [승자 X | X 승 | 승]
    m = re.search(rf"^(.*?)\s*\bvs\.?\s*(.+)$", t, flags=re.I)
    if not m:
        m = re.search(rf"^(.*?)vs\.?\s*(.+)$", t, flags=re.I)      # 'vsggplay' 처럼 붙여 쓴 경우
    if not m:
        return []
    left, rest = m.group(1).strip(), m.group(2).strip()
    lm = re.search(rf"{P}\s*$", left)
    a = lm.group(1) if lm else (writer if not left else None)
    rm = re.match(P, rest)
    if not a or not rm:
        return []
    b = rm.group(1)
    tail = rest[rm.end():]
    sc = re.search(r"(\d+)\s*[:：]\s*(\d+)", tail)
    wname = None
    wm = re.search(rf"승자\s*[:：]?\s*{P}", tail) or re.search(rf"{P}\s*(?:님\s*)?승", tail)
    if wm:
        wname = wm.group(1)
    elif re.search(r"승\b|승$|승리", tail):
        wname = a                                      # '2:0 승' → 왼쪽(글쓴이) 승
    elif re.search(r"패\b|패$|패배", tail):
        wname = b
    if sc:
        x, y = int(sc.group(1)), int(sc.group(2))
        if wname is not None:                          # 승자를 적었으면 큰 점수 = 승자 (점수 순서가 제각각이라)
            wc = clean_id(wname).lower()
            if wc == clean_id(a).lower():
                pass
            elif wc == clean_id(b).lower():
                a, b = b, a
            else:
                return []
            x, y = max(x, y), min(x, y)
        out = []
        if x:
            out.append((a, b, mp, x))
        if y:
            out.append((b, a, mp, y))
        return out
    if wname:
        wc = clean_id(wname).lower()
        if wc == clean_id(a).lower():
            return [(a, b, mp, 1)]
        if wc == clean_id(b).lower():
            return [(b, a, mp, 1)]
    return []


RACE_WORD = {"p": "P", "t": "T", "z": "Z", "프로토스": "P", "토스": "P", "프": "P", "테란": "T", "테": "T", "저그": "Z", "저": "Z"}


def _player(v):
    """양식 칸 값 'rox Z' / 'rox[kS], 저그' / 'rox(T)' → 'rox(Z)' (종족 모르면 'rox'), 못 찾으면 None"""
    v = re.sub(r"[​-‏﻿☀-➿\U0001F000-\U0001FFFF]", " ", v or "")
    rc = race_of(v)
    pid = None
    for tok in re.split(r"[\s,/|·]+", re.sub(r"\(\s*[PTZptz]\s*\)", " ", v)):
        t = tok.strip(" :.-")
        if not t:
            continue
        r = RACE_WORD.get(t.lower())
        if r:
            rc = rc or r
            continue
        c = clean_id(t)
        if pid is None and is_id(c):
            pid = c
    if not pid:
        return None
    return f"{pid}({rc})" if rc else pid


def parse_form(body):
    """카페 결과입력 양식 본문:
        A선수 ID (종족 포함…) : rox Z
        ⚔️
        B선수 ID (종족 포함…) : abc T
        🔢 결과 (세트별 승리 순서 포함) : 2:1 rox 승  |  패승승  |  2승  |  rox 2/1
    → [(승자, 패자, 맵, 세트수)]. 결과는 따로 이름이 없으면 A선수 기준으로 읽는다."""
    t = re.sub(r"[​-‏﻿]", "", html.unescape(body or ""))
    labs = list(re.finditer(r"[A-Za-z0-9가-힣]?\s*선수[^:：\n]*[:：]", t))
    rm = re.search(r"결과[^:：\n]*[:：]", t)
    if len(labs) < 2 or not rm or rm.start() < labs[1].end():
        return []
    a = _player(t[labs[0].end():labs[1].start()])
    b = _player(t[labs[1].end():rm.start()])
    if not a or not b or clean_id(a).lower() == clean_id(b).lower():
        return []
    res = re.sub(r"\s+", " ", t[rm.end():]).strip()[:120]
    ca, cb = clean_id(a).lower(), clean_id(b).lower()
    low = res.lower()
    named = [x for x, c in ((a, ca), (b, cb)) if re.search(rf"(?<![A-Za-z0-9_]){re.escape(c)}(?![A-Za-z0-9_])", low)]
    sc = re.search(r"(\d+)\s*[:;/：]\s*(\d+)", res)
    compact = re.sub(r"[\s,./]", "", res)
    out = lambda w, l, n: [(w, l, "", n)] if n > 0 else []
    if sc:
        x, y = int(sc.group(1)), int(sc.group(2))
        if len(named) == 1:
            w = named[0]
            lose = re.search(rf"{re.escape(clean_id(w).lower())}\s*(님\s*)?패", low)
            if lose:
                w = b if w == a else a
            l = b if w == a else a
            return out(w, l, max(x, y)) + out(l, w, min(x, y))
        if not named:                                   # 이름 없이 '2:1' → A선수:B선수
            return out(a, b, x) + out(b, a, y)
        return []
    m = re.fullmatch(r"([승패]+)\d*", compact)           # '패승승승' = A선수의 세트별 결과
    if m:
        seq = m.group(1)
        return out(a, b, seq.count("승")) + out(b, a, seq.count("패"))
    m = re.fullmatch(r"(\d+)([승패])", compact)          # '2승' / '1패' = A선수 기준
    if m:
        n = int(m.group(1))
        return out(a, b, n) if m.group(2) == "승" else out(b, a, n)
    if len(named) == 1 and "승" in res:                  # 'rox 승'
        w = named[0]
        return out(w, b if w == a else a, 1)
    return []


def body_text(clubid, aid, cookie):
    d = get_json(BODY_API.format(clubid=clubid, aid=aid), cookie)
    art = (d.get("result") or {}).get("article") or {}
    h = art.get("contentHtml") or ""
    h = re.sub(r"<br\s*/?>|</p>|</div>", "\n", h, flags=re.I)
    return html.unescape(re.sub(r"<[^>]+>", " ", h))


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    os.makedirs(OUT, exist_ok=True)
    cfg = {}
    p = os.environ.get("ELO_CAFE_FILE")
    if p and os.path.exists(p):
        try:
            cfg = json.load(open(p, encoding="utf-8")) or {}
        except Exception:
            cfg = {}
    if not isinstance(cfg, dict):
        cfg = {}
    url = cfg.get("url") or ""
    clubid = str(cfg.get("clubid") or (re.search(r"clubid=(\d+)", url) or [None, ""])[1] or "30800617")
    menuid = str(cfg.get("menuid") or (re.search(r"menuid=(\d+)", url) or re.search(r"/menus/(\d+)", url) or [None, ""])[1] or "")
    stat_path = os.path.join(OUT, "srcstat.json")
    try:
        stat = json.load(open(stat_path, encoding="utf-8"))
    except Exception:
        stat = {}
    st = {"ok": False, "rows": 0, "games": 0, "skipped": 0, "msg": "", "at": NOW.strftime("%Y-%m-%d %H:%M"),
          "unparsed": []}
    games_path = os.path.join(OUT, "cafe_games.json")

    def finish():
        stat["cafe"] = st
        json.dump(stat, open(stat_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("카페:", st["msg"])

    if not cfg:                                   # 설정이 아직 없으면 기본: 'Elo 결과입력란'(71번) 켜짐
        cfg = {"enabled": True, "clubid": "30800617", "menuid": "71"}
        menuid = "71"
    if not cfg.get("enabled"):
        st["msg"] = "꺼져 있음(관리 화면에서 켜면 모음)"
        if os.path.exists(games_path):
            os.remove(games_path)
        return finish()
    if not menuid:
        st["msg"] = "게시판 번호(menuid)가 없음"
        return finish()

    cookie = os.environ.get("NAVER_COOKIE") or None
    posts = {}                                    # 오라클 서버 카페 봇이 보내 둔 본문 {글번호: {b: 본문}}
    pp = os.environ.get("ELO_CAFEPOSTS_FILE")
    if pp and os.path.exists(pp):
        try:
            posts = json.load(open(pp, encoding="utf-8")) or {}
        except Exception:
            posts = {}
    arts = []
    try:
        for page in range(1, MAX_PAGES + 1):
            d = get_json(LIST_API.format(clubid=clubid, menuid=menuid, page=page))
            r = (d.get("message") or {}).get("result") or {}
            lst = r.get("articleList") or []
            if not lst:
                break
            arts += [a for a in lst if str(a.get("menuId")) == menuid]
            if not r.get("hasNext", True):
                break
            time.sleep(0.3)
    except Exception as e:
        st["msg"] = f"게시판 목록을 못 받음({type(e).__name__})"
        if not arts:
            return finish()

    games, unparsed, body_fail = [], [], 0
    for a in arts:
        aid, title = a.get("articleId"), html.unescape(a.get("subject") or "")
        writer = clean_id(a.get("writerNickname") or "")
        wdate = dt.datetime.fromtimestamp((a.get("writeDateTimestamp") or 0) / 1000, KST).date()
        if re.fullmatch(r"[\s\-=ㅡ_~*.]+.*[\-=ㅡ_~*.]+\s*", title) and not re.search(r"\bvs\b", title, re.I):
            continue                                   # '------ elo 마감 ------' 같은 구분선 글
        found = [(title, x) for x in parse_text(title, writer)]
        if not found and str(aid) in posts:
            body = str(posts[str(aid)].get("b") or "")
            found = [(body, x) for x in parse_form(body)]
        if not found and str(aid) in posts:
            for line in str(posts[str(aid)].get("b") or "").splitlines():
                found += [(line, x) for x in parse_text(line, writer)]
        if not found and cookie:
            try:
                for line in body_text(clubid, aid, cookie).splitlines():
                    found += [(line, x) for x in parse_text(line, writer)]
            except Exception:
                body_fail += 1
        ok = []
        for src_text, (w, l, mp, n) in found:
            wc, lc = clean_id(w), clean_id(l)
            if not (is_id(wc) and is_id(lc)) or wc.lower() == lc.lower():
                continue
            for _ in range(max(1, min(n, 9))):
                ok.append({"date": find_date(src_text, wdate).isoformat(), "league": "ELO", "map": mp,
                           "winner": wc, "loser": lc, "wrace": race_of(w), "lrace": race_of(l),
                           "wtier": "", "ltier": "", "src": "카페", "articleId": aid,
                           "url": f"https://cafe.naver.com/ca-fe/cafes/{clubid}/articles/{aid}"})
        if ok:
            games += ok
        else:
            unparsed.append({"articleId": aid, "title": title, "writer": a.get("writerNickname") or "",
                             "date": wdate.isoformat()})

    json.dump({"updated": NOW.strftime("%Y-%m-%d %H:%M"), "games": games}, open(games_path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)
    st.update(ok=True, rows=len(arts), games=len(games), skipped=len(unparsed), unparsed=unparsed[:30])
    msg = f"글 {len(arts)}개 중 {len(arts) - len(unparsed)}개에서 {len(games)}세트 읽음, {len(unparsed)}개는 모양을 몰라 못 읽음"
    if not cookie:
        msg += " (본문은 로그인이 필요해서 제목만 읽음)"
    elif body_fail:
        msg += f" (본문 {body_fail}개 읽기 실패 — 쿠키 만료 가능)"
    st["msg"] = (st["msg"] + " · " if st["msg"] else "") + msg
    finish()


if __name__ == "__main__":
    main()
