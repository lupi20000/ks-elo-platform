# -*- coding: utf-8 -*-
"""
관리자가 등록한 시트 출처를 읽는 공용 도구 (build.py · analyze_sheet.py 가 같이 씀)

  - 시트 주소 → CSV 주소 바꾸기
  - 여러 모양의 날짜 읽기 (2026-08-31 / 2026.8.31 / '26. 8. 31. (월)' / 8/31/2026 / 2026년 8월 31일)
  - 매핑(어느 열이 승자·패자·날짜인지)을 적용해서 세트 기록 만들기
  - 머리행 낱말로 매핑을 짐작하기
"""
import csv, io, re, datetime as dt
import urllib.request, urllib.error

UA = {"User-Agent": "Mozilla/5.0"}


def csv_url(url="", sheet="", gid=""):
    """시트 주소(편집 링크·공유 링크·CSV 링크)나 시트ID+gid → 내려받을 CSV 주소"""
    url = (url or "").strip()
    if url and ("output=csv" in url or "tqx=out:csv" in url or "format=csv" in url):
        return url
    if not sheet:
        m = re.search(r"/spreadsheets/d/([A-Za-z0-9_\-]{20,})", url)
        sheet = m.group(1) if m else ""
    if not gid:
        m = re.search(r"[#?&]gid=(\d+)", url)
        gid = m.group(1) if m else ""
    if not sheet:
        return url or None
    u = f"https://docs.google.com/spreadsheets/d/{sheet}/gviz/tq?tqx=out:csv"
    if str(gid).strip():
        u += f"&gid={str(gid).strip()}"
    return u


def fetch_rows(url, timeout=60):
    """CSV 내려받아 행 목록으로. 로그인 화면(비공개 시트)이면 HTTPError 401"""
    req = urllib.request.Request(url, headers=UA)
    body = urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")
    if body.lstrip().startswith("<"):
        raise urllib.error.HTTPError(url, 401, "login page", None, None)
    return list(csv.reader(io.StringIO(body)))


def _mk(y, m, d):
    try:
        y = int(y)
        if y < 100:
            y += 2000
        return dt.date(y, int(m), int(d))
    except (ValueError, TypeError):
        return None


def parse_date(s, y=None, m=None, d=None):
    """날짜 글자 → date. 따로 된 연·월·일 칸(y, m, d)이 있으면 그걸 씀. 못 읽으면 None"""
    if y not in (None, "") or m not in (None, "") or d not in (None, ""):
        nums = [re.sub(r"\D", "", str(v or "")) for v in (y, m, d)]
        if all(nums):
            return _mk(*nums)
    s = (s or "").strip()
    if not s:
        return None
    s = re.sub(r"\(.*?\)", " ", s)                       # (월) 같은 요일 떼기
    nums = re.findall(r"\d+", s)
    if len(nums) < 3:
        return None
    a, b, c = nums[:3]
    if len(a) == 4:                                      # 2026-08-31, 2026.8.31, 2026년 8월 31일
        return _mk(a, b, c)
    if len(c) == 4:                                      # 8/31/2026 (구글 CSV 미국식)
        return _mk(c, a, b)
    if len(a) <= 2:                                      # '26. 8. 31.
        return _mk(a, b, c)
    return None


def _cell(row, i):
    if i is None or i == "" or i < 0 or i >= len(row):
        return ""
    return (row[i] or "").strip()


def apply_mapping(rows, mapping, default_league):
    """
    매핑 적용 → (세트 목록, 데이터 행 수, 건너뛴 행 수)
    세트 = {d, lg, map, w, l, wr, lr, wt, lt}  (종족·티어는 글자 그대로, 정리는 부르는 쪽에서)
    """
    cols = mapping.get("cols") or {}
    hdr = int(mapping.get("headerRow") or 0)
    fill = [int(c) for c in (mapping.get("fillDown") or []) if str(c).lstrip("-").isdigit()]

    def ci(name):
        v = cols.get(name)
        try:
            return None if v is None or v == "" else int(v)
        except (TypeError, ValueError):
            return None

    c = {k: ci(k) for k in ("date", "year", "month", "day", "winner", "loser", "map", "league",
                            "wrace", "lrace", "wtier", "ltier")}
    out, nrows, skipped, last = [], 0, 0, {}
    for row in rows[hdr:]:
        if not any((x or "").strip() for x in row):
            continue
        row = list(row)
        for f in fill:                                   # 위 칸 값 내려 채우기(병합 셀)
            if f < 0:
                continue
            while len(row) <= f:
                row.append("")
            if row[f].strip():
                last[f] = row[f]
            elif f in last:
                row[f] = last[f]
        nrows += 1
        w, l = _cell(row, c["winner"]), _cell(row, c["loser"])
        d = parse_date(_cell(row, c["date"]), _cell(row, c["year"]) if c["year"] is not None else None,
                       _cell(row, c["month"]) if c["month"] is not None else None,
                       _cell(row, c["day"]) if c["day"] is not None else None)
        if d is None and mapping.get("defaultDate"):     # 날짜 칸이 없는 시트 → 리그 기간으로 정한 날짜
            d = parse_date(mapping["defaultDate"])
        if not w or not l or d is None or w.lower() == l.lower() or "?" in (w + l):
            skipped += 1
            continue
        out.append({"d": d, "lg": _cell(row, c["league"]) or default_league, "map": _cell(row, c["map"]),
                    "w": w, "l": l, "wr": _cell(row, c["wrace"]), "lr": _cell(row, c["lrace"]),
                    "wt": _cell(row, c["wtier"]), "lt": _cell(row, c["ltier"])})
    return out, nrows, skipped


# ───────── 매핑 짐작 (머리행 낱말 맞추기) ─────────
KW = {
    "winner": ["승리선수", "승자", "winner", "승리자", "이긴사람", "승리아이디"],
    "loser": ["패배선수", "패자", "loser", "패배자", "진사람", "패배아이디"],
    "date": ["날짜", "date", "일자", "경기일"],
    "year": ["연", "년", "year"],
    "month": ["월", "month"],
    "day": ["일", "day"],
    "map": ["맵", "map"],
    "league": ["리그", "대회", "league", "리그구분", "구분"],
    "race": ["종족", "race"],
    "tier": ["티어", "tier", "등급"],
}


def _norm(h):
    return re.sub(r"[\s_\-]", "", (h or "")).lower()


def _match(h, words, exact=False):
    h = _norm(h)
    for i, wd in enumerate(words):
        wd = wd.lower()
        if (h == wd) if exact else (wd in h):
            return len(words) - i                        # 앞 낱말일수록 점수 높음
    return 0


def guess_mapping(rows, scan=10):
    """머리행 찾기 + 열 짐작. 반환 (매핑, 머리행 값)"""
    best, bi = -1, 0
    for i, r in enumerate(rows[:scan]):
        sc = 0
        for h in r:
            for k in ("winner", "loser", "date", "map", "race", "tier"):
                if _match(h, KW[k]):
                    sc += 1
        if sc > best:
            best, bi = sc, i
    head = rows[bi] if rows else []
    cols = {k: None for k in ("date", "winner", "loser", "map", "league", "wrace", "lrace", "wtier", "ltier")}

    def pick(key, exact=False, exclude=("팀", "team")):
        cand = [(_match(h, KW[key], exact), j) for j, h in enumerate(head)
                if not any(x in _norm(h) for x in exclude)]
        cand = [x for x in cand if x[0] > 0]
        return max(cand, key=lambda x: (x[0], -x[1]))[1] if cand else None

    cols["winner"] = pick("winner")
    cols["loser"] = pick("loser")
    cols["date"] = pick("date", exclude=())
    cols["map"] = pick("map")
    cols["league"] = pick("league", exclude=("세트",))
    if cols["date"] is None:                             # 연·월·일 따로
        y, m, d = pick("year", True, ()), pick("month", True, ()), pick("day", True, ())
        if y is not None and m is not None and d is not None:
            cols.update(year=y, month=m, day=d)
    # 종족·티어: 승자 뒤 첫 칸 = 승자 것, 패자 뒤 첫 칸 = 패자 것
    for key, wk, lk in (("race", "wrace", "lrace"), ("tier", "wtier", "ltier")):
        idxs = [j for j, h in enumerate(head) if _match(h, KW[key])]
        w, l = cols["winner"], cols["loser"]
        if w is not None and l is not None:
            lo, hi = sorted((w, l))
            first = [j for j in idxs if lo < j < hi]
            after = [j for j in idxs if j > hi]
            if w < l:
                cols[wk] = first[0] if first else None
                cols[lk] = after[0] if after else None
            else:
                cols[lk] = first[0] if first else None
                cols[wk] = after[0] if after else None
        elif len(idxs) >= 2:
            cols[wk], cols[lk] = idxs[0], idxs[1]
    # 내려 채우기: 승자가 있는 행 중 날짜(·리그) 칸이 비어 있는 비율이 크면
    fill = []
    data = rows[bi + 1:]
    wrows = [r for r in data if cols["winner"] is not None and _cell(r, cols["winner"])]
    for key in ("date", "year", "month", "day", "league"):
        j = cols.get(key)
        if j is None or not wrows:
            continue
        filled = sum(1 for r in wrows if _cell(r, j))
        if filled < 0.6 * len(wrows):
            fill.append(j)
    mapping = {"headerRow": bi + 1, "fillDown": fill, "cols": cols}
    return mapping, head
