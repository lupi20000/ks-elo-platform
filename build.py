# -*- coding: utf-8 -*-
"""
kS ELO 플랫폼 빌더

  python build.py            # 원본 시트를 새로 받아서 계산
  python build.py --offline  # 원본/ 폴더에 받아둔 CSV로만 계산

하는 일
  1) 수집   : 공개 구글시트(CSV) + 클랜 래더 페이지 → 원본/*.csv
  2) 정규화 : 리그별 시트 구조를 하나의 세트 기록(날짜·리그·맵·승자·패자·종족·티어)으로 통일
  3) 신원   : [kS] 떼기 · 대소문자 무시 · 닉변 별칭 · 부종(다른 종족) 분리 · 탈퇴/휴면 보존
  4) 레이팅 : 시간 감쇠 가중 브래들리-테리(=ELO 척도) 최대우도 + 티어 시드 사전분포
  5) 출력   : site/data.json, 검증-리포트.md

시트에는 절대 쓰지 않는다(읽기 전용). 실명(이름 열)은 출력에 넣지 않는다.
"""
import csv, io, json, math, os, re, sys, hashlib, datetime as dt
from collections import Counter, defaultdict
import urllib.request, urllib.error
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "원본")
SITE = os.path.join(HERE, "site")
CFG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
OFFLINE = "--offline" in sys.argv
TODAY = dt.date.today()
EPOCH = dt.date(2022, 1, 1)
TIERS = CFG["tiers"]
TIER_IDX = {t.lower(): i for i, t in enumerate(TIERS)}
BUJONG = len(TIERS)          # 티어 코드 8 = 부종
RACES = ["P", "T", "Z"]

os.makedirs(RAW, exist_ok=True)
os.makedirs(SITE, exist_ok=True)

# ───────────────────────── 1) 수집 ─────────────────────────
SRC_STATUS = []
STATUS_FILE = os.path.join(RAW, "_status.json")
LAST_STATUS = json.load(open(STATUS_FILE, encoding="utf-8")) if os.path.exists(STATUS_FILE) else {}


def _status(name, status):
    if status == "캐시":
        prev = LAST_STATUS.get(name)
        return f"캐시 사용 (마지막 수집: {prev})" if prev else "캐시 사용"
    return status


def fetch_sheet(name):
    src = CFG["sources"][name]
    path = os.path.join(RAW, name + ".csv")
    status = "캐시"
    if not OFFLINE:
        url = f"https://docs.google.com/spreadsheets/d/{src['sheet']}/gviz/tq?tqx=out:csv"
        if src.get("gid"):
            url += f"&gid={src['gid']}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            body = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
            if body.lstrip().startswith("<"):
                raise urllib.error.HTTPError(url, 401, "login page", None, None)
            open(path, "w", encoding="utf-8").write(body)
            status = "수집"
        except urllib.error.HTTPError as e:
            status = f"접근 불가(HTTP {e.code} — 링크 공유 꺼짐)"
        except Exception as e:  # 네트워크
            status = f"수집 실패({type(e).__name__})"
    if not os.path.exists(path):
        if status == "캐시":
            status = LAST_STATUS.get(name) or "미수집"
        SRC_STATUS.append({"name": name, "label": src["label"], "status": status, "rows": 0})
        return None
    rows = list(csv.reader(io.StringIO(open(path, encoding="utf-8").read())))
    SRC_STATUS.append({"name": name, "label": src["label"], "status": _status(name, status), "rows": len(rows)})
    return rows


def fetch_ladder():
    path = os.path.join(RAW, "ladder.json")
    status = "캐시"
    if not OFFLINE:
        try:
            req = urllib.request.Request(CFG["sources"]["ladder"]["url"], headers={"User-Agent": "Mozilla/5.0"})
            html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
            m = re.search(r"window\.KS_DATA = (\{.*?\});</script>", html, re.S)
            json.dump(json.loads(m.group(1)), open(path, "w", encoding="utf-8"), ensure_ascii=False)
            status = "수집"
        except Exception as e:
            status = f"수집 실패({type(e).__name__})"
    if not os.path.exists(path):
        SRC_STATUS.append({"name": "ladder", "label": CFG["sources"]["ladder"]["label"], "status": status, "rows": 0})
        return None
    d = json.load(open(path, encoding="utf-8"))
    SRC_STATUS.append({"name": "ladder", "label": CFG["sources"]["ladder"]["label"], "status": _status("ladder", status),
                       "rows": len(d.get("rows", [])), "updated": d.get("updated")})
    return d


# ───────────────────────── 2) 정규화 ─────────────────────────
ISSUES = defaultdict(list)


def clean_tier(t):
    t = (t or "").strip()
    if t.lower() in TIER_IDX:
        return TIER_IDX[t.lower()]
    if t == "부종":
        return BUJONG
    if t and t not in ("---", "휴면", "미배정"):
        ISSUES["tier_text"].append(t)       # 실명 등 — 리포트엔 개수만
    return -1


def clean_race(r):
    r = (r or "").strip().upper()
    return r if r in RACES else ""


def parse_v5(rows, src):
    """ELO V5 '결과입력' 형식: 연,월,일,Match,Map,Winner,Loser,URL,,WinnerTier,Race,LoserTier,Race"""
    out, last = [], None
    for i, x in enumerate(rows):
        if len(x) < 13 or x[0] == "연":
            continue
        w, l = x[5].strip(), x[6].strip()
        if not w or not l:
            continue
        d = None
        try:
            d = dt.date(int(x[0]), int(x[1]), int(x[2]))
        except Exception:
            if last:
                d = last
                ISSUES["date_filled"].append(f"{src} 행{i + 1}: 날짜 '{x[0]}/{x[1]}/{x[2]}' → 앞 행 {last}")
        if d is None:
            ISSUES["no_date"].append(f"{src} 행{i + 1}")
            continue
        last = d
        out.append({"d": d, "lg": x[3].strip() or "미분류", "map": x[4].strip(), "w": w, "l": l,
                    "wr": clean_race(x[10]), "lr": clean_race(x[12]),
                    "wt": clean_tier(x[9]), "lt": clean_tier(x[11]), "src": src,
                    "url": x[7].strip()})
    return out


def parse_kpl(rows, src, season):
    """KPL 경기결과 형식: 7행 블록(머리행에 날짜·리그·경기). 기권 세트는 제외."""
    out, cur = [], None
    for i, r in enumerate(rows[1:], start=2):
        r = r + [""] * (20 - len(r))
        if r[0].strip():
            cur = {"date": r[0].strip(), "stage": r[1].strip(), "no": r[2].strip()}
        if not cur or not r[12].strip() or not r[16].strip():
            continue
        if "기권" in r[19]:
            ISSUES["forfeit"].append(f"{src} 행{i}")
            continue
        if "?" in (r[12] + r[16]):
            ISSUES["unknown_player"].append(f"{src} 행{i}")
            continue
        try:
            d = dt.date.fromisoformat(cur["date"][:10])
        except ValueError:
            ISSUES["no_date"].append(f"{src} 행{i}")
            continue
        stage = cur["stage"]
        lg = CFG["league_group"].get(stage, "KPL")
        if r[8].strip() == "ACE" and lg == "KPL":
            lg = "KPL 에결"
        out.append({"d": d, "lg": lg, "map": r[10].strip(), "w": r[12].strip(), "l": r[16].strip(),
                    "wr": clean_race(r[14]), "lr": clean_race(r[18]),
                    "wt": clean_tier(r[13]), "lt": clean_tier(r[17]), "src": src,
                    "season": season, "stage": stage, "url": ""})
    return out


# ───────────────────────── 3) 신원 ─────────────────────────
def norm(name):
    return re.sub(r"\[\s*ks\s*\]", "", (name or ""), flags=re.I).strip().lower()


ALIAS = {}


def add_alias(old, new, why):
    o, n = norm(old), norm(new)
    if o and n and o != n:
        ALIAS[o] = n
        ISSUES["alias"].append(f"{old} → {new} ({why})")


def resolve(name):
    k, seen = norm(name), set()
    while k in ALIAS and k not in seen:
        seen.add(k)
        k = ALIAS[k]
    return k


# ───────────────────────── 4) 레이팅 ─────────────────────────
def league_weight(lg):
    w = CFG["league_weight"].get(lg)
    if w is None:
        ISSUES["unknown_league"].append(lg)
        w = 1
    return math.sqrt(w) if CFG.get("league_weight_mode") == "sqrt" else w


def fit(wi, li, wt, seeds, n, prior, iters=400, init=None):
    """가중 브래들리-테리 MM 반복. seeds(ELO 척도)를 가상 상대로 prior 경기만큼 1승1패씩 붙인다."""
    a = np.power(10.0, seeds / 400.0)
    g = a.copy() if init is None else np.power(10.0, init / 400.0)
    wins = np.bincount(wi, weights=wt, minlength=n) + prior / 2
    for _ in range(iters):
        s = wt / (g[wi] + g[li])
        den = np.bincount(wi, weights=s, minlength=n) + np.bincount(li, weights=s, minlength=n) + prior / (g + a)
        ng = wins / den
        if np.max(np.abs(np.log10(ng) - np.log10(g))) < 1e-7:
            g = ng
            break
        g = ng
    return 400.0 * np.log10(g)


def main():
    try:  # Windows 콘솔(cp949)에서도 로그 출력이 죽지 않게
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    # 수집
    v5 = fetch_sheet("v5_results")
    v5_main = fetch_sheet("v5_main")
    v5_db = fetch_sheet("v5_db")
    kpl = fetch_sheet("kpl_results")
    roster = fetch_sheet("roster")
    bujong = fetch_sheet("bujong")
    elo_new = fetch_sheet("elo_new")
    fetch_sheet("ks_admin")             # 구조 파악용(접근되면 원본/에 저장만)
    ladder = fetch_ladder()

    # 별칭: V5 DB 특이사항의 'A -> B' 표기, 래더 명단의 old 필드
    for x in (v5_db or []):
        for c in x[:3]:
            for o, nw in re.findall(r"([A-Za-z0-9_.\-]{2,})\s*->\s*([A-Za-z0-9_.\-]{2,})", c):
                add_alias(o, nw, "V5 DB 특이사항")
    lad_list = os.path.join(HERE, "참고", "ks-clan-ladder", "명단.json")
    if os.path.exists(lad_list):
        for p in json.load(open(lad_list, encoding="utf-8")):
            for o in re.split(r"[,/ ]+", p.get("old") or ""):
                if o:
                    add_alias(o, p["id"], "래더 명단 old")

    # 세트 기록
    games = []
    if v5:
        games += parse_v5(v5, "V5")
    if kpl:
        games += parse_kpl(kpl, "KPL S10", CFG["sources"]["kpl_results"].get("season", "KPL"))
    if elo_new:
        new = parse_v5(elo_new, "ELO New")
        # 같은 (날짜·리그·맵·승·패) 묶음은 출처 중 많은 쪽만 인정(옮겨 적은 중복 방지)
        def key(g):
            return (g["d"], g["lg"], g["map"], resolve(g["w"]), resolve(g["l"]))
        have = Counter(key(g) for g in games)
        newc = Counter()
        for g in new:
            k = key(g)
            newc[k] += 1
            if newc[k] > have[k]:
                games.append(g)
            else:
                ISSUES["dup_cross_source"].append(f"{g['d']} {g['w']}>{g['l']}")
    games.sort(key=lambda g: g["d"])

    # 명단: 활동/휴면 + 현재 티어·종족 (이름 열은 읽지 않는다)
    roster_info = {}
    for x in (roster or [])[1:]:
        if len(x) < 4 or not x[2].strip():
            continue
        t = x[1].strip()
        st = "D" if t == "휴면" else "A"
        roster_info[resolve(x[2])] = {"id": x[2].strip(), "tier": t if t in TIERS else None,
                                     "race": clean_race(x[3]), "st": st, "unassigned": t == "미배정"}
    off_tier = {}
    for x in (bujong or [])[1:]:
        if len(x) < 4 or "_" not in x[2]:
            continue
        race, base = x[2].split("_", 1)
        off_tier[(resolve(base), race.upper())] = x[1].strip() if x[1].strip() in TIERS else None

    # 주종족: 명단 → 없으면 경기 최빈 종족
    race_cnt = defaultdict(Counter)
    for g in games:
        if g["wr"]:
            race_cnt[resolve(g["w"])][g["wr"]] += 1
        if g["lr"]:
            race_cnt[resolve(g["l"])][g["lr"]] += 1
    main_race = {}
    for k, c in race_cnt.items():
        main_race[k] = (roster_info.get(k) or {}).get("race") or c.most_common(1)[0][0]
    for k, v in roster_info.items():
        main_race.setdefault(k, v["race"])

    # 선수 키: 기본 = resolve(id), 부종 = base·종족
    P = {}          # key -> dict
    display = {}

    def pkey(name, race, tier_code):
        b = resolve(name)
        display.setdefault(b, name.strip().replace("[kS]", "").replace("[ks]", ""))
        mr = main_race.get(b)
        if race and mr and race != mr:
            return f"{b}·{race}"
        return b

    for g in games:
        g["wk"] = pkey(g["w"], g["wr"], g["wt"])
        g["lk"] = pkey(g["l"], g["lr"], g["lt"])
        if g["wk"] == g["lk"]:
            ISSUES["self_match"].append(f"{g['src']} {g['d']} {g['w']}")
    games = [g for g in games if g["wk"] != g["lk"]]
    for k, v in roster_info.items():
        display[k] = v["id"]          # 현재 표기 우선

    keys = sorted({g["wk"] for g in games} | {g["lk"] for g in games} | set(roster_info))
    idx = {k: i for i, k in enumerate(keys)}
    n = len(keys)

    last_tier = {}
    for g in games:
        for k, t in ((g["wk"], g["wt"]), (g["lk"], g["lt"])):
            if 0 <= t < len(TIERS):
                last_tier[k] = TIERS[t]

    seeds = np.zeros(n)
    seed_src = []
    for k in keys:
        base, _, orace = k.partition("·")
        info = roster_info.get(base)
        if orace:
            t = off_tier.get((base, orace)) or last_tier.get(k)
            if t:
                seeds[idx[k]] = CFG["tier_seed"][t]; seed_src.append("부종표")
            else:
                bt = (info or {}).get("tier") or last_tier.get(base)
                seeds[idx[k]] = (CFG["tier_seed"][bt] if bt else CFG["default_seed"]) - 200; seed_src.append("주종-200")
        elif info and info["tier"]:
            seeds[idx[k]] = CFG["tier_seed"][info["tier"]]; seed_src.append("명단")
        elif last_tier.get(k):
            seeds[idx[k]] = CFG["tier_seed"][last_tier[k]]; seed_src.append("기록티어")
        else:
            seeds[idx[k]] = CFG["default_seed"]; seed_src.append("기본")

    leagues = sorted({g["lg"] for g in games}, key=lambda s: (-CFG["league_weight"].get(s, 1), s))
    lidx = {s: i for i, s in enumerate(leagues)}
    lw = np.array([league_weight(s) for s in leagues])
    maps = [m for m, _ in Counter(g["map"] for g in games if g["map"]).most_common()]
    midx = {m: i for i, m in enumerate(maps)}

    day = np.array([(g["d"] - EPOCH).days for g in games])
    WI = np.array([idx[g["wk"]] for g in games])
    LI = np.array([idx[g["lk"]] for g in games])
    LG = np.array([lidx[g["lg"]] for g in games])
    HL = CFG["half_life_days"]
    prior = CFG["prior_games"]

    def rate_at(asof_day, init=None):
        m = day <= asof_day
        wt = lw[LG[m]] * np.power(0.5, (asof_day - day[m]) / HL)
        keep = wt > 0
        wi, li, wt = WI[m][keep], LI[m][keep], wt[keep]
        r = fit(wi, li, wt, seeds, n, prior, init=init)
        eff = np.bincount(wi, weights=wt, minlength=n) + np.bincount(li, weights=wt, minlength=n)
        return r, eff

    today_d = (TODAY - EPOCH).days
    R, EFF = rate_at(today_d)

    # 월별 스냅샷(그래프용) — 그 시점까지의 기록만, 그 시점 기준 감쇠
    months, hist = [], defaultdict(list)
    if games:
        y, mo = games[0]["d"].year, games[0]["d"].month
        prev = None
        while (y, mo) <= (TODAY.year, TODAY.month):
            nxt = dt.date(y + (mo == 12), mo % 12 + 1, 1)
            asof = min(nxt - dt.timedelta(days=1), TODAY)
            r, eff = rate_at((asof - EPOCH).days, init=prev)
            prev = r
            mi_ = len(months)
            months.append(f"{y}-{mo:02d}")
            for i in np.nonzero(eff >= 0.5)[0]:
                hist[i].append([mi_, int(round(r[i]))])
            y, mo = nxt.year, nxt.month

    # 래더 결합 (toon에서 [kS] 떼고 명단 키와 맞춤)
    lad = {}
    if ladder:
        for row in ladder.get("rows", []):
            k = resolve(row.get("toon", ""))
            if not k:
                continue
            cur = lad.get(k)
            if cur is None or (row.get("rating") or 0) > (cur.get("rating") or 0):
                lad[k] = {"toon": row.get("toon"), "rating": row.get("rating") or 0,
                          "standing": row.get("standing"), "race": row.get("cwalRace"),
                          "w": row.get("wins", 0), "l": row.get("losses", 0), "mu": row.get("mu", {}),
                          "est": bool(row.get("estMmr")), "gw": row.get("gateway")}

    # 선수 표
    W = np.bincount(WI, minlength=n); L = np.bincount(LI, minlength=n)
    first, last = {}, {}
    for g in games:
        for k in (g["wk"], g["lk"]):
            first.setdefault(k, g["d"]); last[k] = g["d"]
    players = []
    for k in keys:
        i = idx[k]
        base, _, orace = k.partition("·")
        info = roster_info.get(base)
        st = info["st"] if info else "X"
        if orace:
            tier = off_tier.get((base, orace))
        else:
            tier = info["tier"] if info else last_tier.get(k)
        race = orace or main_race.get(base, "")
        players.append({
            "k": k, "id": display.get(base, base) + (f" ({orace}부종)" if orace else ""),
            "base": display.get(base, base), "off": bool(orace), "st": st,
            "tier": tier, "tierCur": bool(info and not orace), "race": race,
            "r": round(float(R[i]), 1), "eff": round(float(EFF[i]), 2), "seed": int(seeds[i]),
            "w": int(W[i]), "l": int(L[i]),
            "first": first[k].isoformat() if k in first else None,
            "last": last[k].isoformat() if k in last else None,
            "h": hist.get(i, []), "lad": None if orace else lad.get(base),
        })

    # 출력용 경기 배열 (가볍게): [일, 리그, 맵, 승자, 패자, 승종, 패종, 승티어, 패티어, 출처]
    srcs = sorted({g["src"] for g in games})
    sidx = {s: i for i, s in enumerate(srcs)}
    rc = {"": -1, "P": 0, "T": 1, "Z": 2}
    G = [[int(day[j]), int(LG[j]), midx.get(g["map"], -1), int(WI[j]), int(LI[j]),
          rc[g["wr"]], rc[g["lr"]], g["wt"], g["lt"], sidx[g["src"]]] for j, g in enumerate(games)]

    gaps = []
    names = {s["name"]: s for s in SRC_STATUS}
    for nm in ("elo_new", "ks_admin"):
        if names.get(nm, {}).get("rows", 0) == 0:
            gaps.append(f"{CFG['sources'][nm]['label']}: {names.get(nm, {}).get('status', '미수집')}")
    if games:
        v5_last = max((g["d"] for g in games if g["src"] == "V5"), default=None)
        kpl_first = min((g["d"] for g in games if g["src"] != "V5"), default=None)
        if v5_last and kpl_first and (kpl_first - v5_last).days > 45 and not elo_new:
            gaps.append(f"기록 공백 {v5_last} ~ {kpl_first} (ELO New 시트에 있을 것으로 추정)")

    data = {
        "meta": {
            "updated": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "today": TODAY.isoformat(),
            "epoch": EPOCH.isoformat(), "halfLife": HL, "prior": prior, "leagueWeightMode": CFG["league_weight_mode"],
            "rankedMinEff": CFG["ranked_min_eff_games"], "rankedMinGames": CFG.get("ranked_min_games", 0), "sources": SRC_STATUS, "gaps": gaps,
            "adminHash": os.environ.get("KS_ADMIN_HASH") or None,
            "games": len(G), "players": n,
        },
        "tiers": TIERS, "seeds": CFG["tier_seed"], "defaultSeed": CFG["default_seed"],
        "leagues": [{"name": s, "w": CFG["league_weight"].get(s, 1)} for s in leagues],
        "maps": maps, "srcs": srcs, "months": months,
        "adjustments": CFG["adjustments"], "promo": CFG["promotion_defaults"],
        "players": players, "g": G,
    }
    if not OFFLINE:
        json.dump({x["name"]: (dt.datetime.now().strftime("%Y-%m-%d %H:%M") if x["status"] == "수집" else x["status"])
                   for x in SRC_STATUS}, open(STATUS_FILE, "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(data, open(os.path.join(SITE, "data.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))

    # 검증 리포트
    act = [p for p in players if p["st"] == "A" and not p["off"]]
    rk = sorted([p for p in act if p["eff"] >= CFG["ranked_min_eff_games"] and p["w"] + p["l"] >= CFG.get("ranked_min_games", 0)],
                key=lambda p: -p["r"])
    no_games = [p for p in act if p["w"] + p["l"] == 0]
    Lr = ["# 검증 리포트", "", f"생성: {data['meta']['updated']} · 감쇠 반감기 {HL}일 · 사전 {prior}경기", "",
          "## 출처", "", "| 출처 | 상태 | 행 |", "|---|---|---|"]
    Lr += [f"| {s['label']} | {s['status']} | {s['rows']} |" for s in SRC_STATUS]
    Lr += ["", "## 집계", "",
           f"- 반영 세트 {len(G)} · 선수 키 {n} (부종 프로필 {sum(p['off'] for p in players)})",
           f"- 현재 명단 활동 {len(act)}명 · 정식 순위(통산 ≥ {CFG.get('ranked_min_games', 5)}세트 · 감쇠 유효경기 ≥ {CFG['ranked_min_eff_games']}) {len(rk)}명 · 기록 없음 {len(no_games)}명",
           f"- 휴면 {sum(1 for p in players if p['st'] == 'D' and not p['off'])}명 · 명단에 없음(탈퇴·외부) {sum(1 for p in players if p['st'] == 'X' and not p['off'])}명",
           f"- 시드 출처: {dict(Counter(seed_src))}", "", "## 공백·제한", ""]
    Lr += [f"- {x}" for x in gaps] or ["- 없음"]
    Lr += ["", "## 이상치", ""]
    Lr += [f"- 날짜 보정(앞 행 날짜 사용): {len(ISSUES['date_filled'])}건",
           f"- 날짜 없음 제외: {len(ISSUES['no_date'])}건",
           f"- 같은 선수 양쪽(제외): {len(ISSUES['self_match'])}건 " + "; ".join(ISSUES["self_match"][:10]),
           f"- 기권 세트 제외: {len(ISSUES['forfeit'])}건 · 선수 미상('?') 제외: {len(ISSUES['unknown_player'])}건",
           f"- 티어 칸에 티어가 아닌 글자(실명 등 — 내용 비공개): {len(ISSUES['tier_text'])}건",
           f"- 출처 간 중복으로 뺀 세트: {len(ISSUES['dup_cross_source'])}건",
           f"- 가중치 표에 없는 리그(가중치 1 적용): {sorted(set(ISSUES['unknown_league'])) or '없음'}",
           "", "## 닉네임 별칭 적용", ""]
    Lr += [f"- {a}" for a in sorted(set(ISSUES["alias"]))] or ["- 없음"]
    open(os.path.join(HERE, "검증-리포트.md"), "w", encoding="utf-8").write("\n".join(Lr) + "\n")

    print(f"games={len(G)} players={n} active={len(act)} ranked={len(rk)} months={len(months)}")
    for s in SRC_STATUS:
        print(" ", s["name"], s["status"], s["rows"])
    print("top10:", [(p["id"], p["tier"], p["r"]) for p in rk[:10]])


if __name__ == "__main__":
    main()
