# -*- coding: utf-8 -*-
"""
kS ELO 플랫폼 빌더

  python build.py            # 원본 시트를 새로 받아서 계산
  python build.py --offline  # 원본/ 폴더에 받아둔 CSV로만 계산

환경변수(선택)
  ELO_SOURCES_FILE : 관리자가 등록한 시트 출처 목록(JSON 배열) 파일 경로
  out/cafe_games.json 이 있으면 카페 'Elo 결과입력란' 경기도 넣는다 (tools/cafe.py 가 만듦)

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
import urllib.request, urllib.error, urllib.parse
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "tools"))
import sheetsrc  # noqa: E402  관리자 등록 시트 매핑 적용

RAW = os.path.join(HERE, "원본")
SITE = os.path.join(HERE, "site")
OUT = os.path.join(HERE, "out")
CFG = json.load(open(os.path.join(HERE, "config.json"), encoding="utf-8"))
OFFLINE = "--offline" in sys.argv
KST = dt.timezone(dt.timedelta(hours=9))     # 자동실행(깃허브)은 UTC 시계라서 한국 시간으로 맞춘다
NOW = dt.datetime.now(KST).replace(tzinfo=None)
TODAY = NOW.date()
EPOCH = dt.date(2022, 1, 1)
TIERS = CFG["tiers"]
TIER_IDX = {t.lower(): i for i, t in enumerate(TIERS)}
BUJONG = len(TIERS)          # 티어 코드 8 = 부종
RACES = ["P", "T", "Z"]

os.makedirs(RAW, exist_ok=True)
os.makedirs(SITE, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

# ───────────────────────── 1) 수집 ─────────────────────────
SRC_STATUS = []
STATUS_FILE = os.path.join(RAW, "_status.json")
try:
    LAST_STATUS = json.load(open(STATUS_FILE, encoding="utf-8")) if os.path.exists(STATUS_FILE) else {}
except Exception:  # 캐시가 깨져 있어도 계속
    LAST_STATUS = {}


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


LADDER_ROSTER_URL = "https://lupi20000.github.io/ks-clan-ladder/" + urllib.parse.quote("명단.json")


def fetch_ladder_roster():
    """클랜 래더 명단(닉변 old 필드용). 인터넷 → 원본/ 캐시 → 참고/ 로컬 사본 순서로 찾는다"""
    cache = os.path.join(RAW, "ladder_roster.json")
    if not OFFLINE:
        try:
            req = urllib.request.Request(LADDER_ROSTER_URL, headers={"User-Agent": "Mozilla/5.0"})
            d = json.loads(urllib.request.urlopen(req, timeout=60).read().decode("utf-8"))
            if isinstance(d, list):
                json.dump(d, open(cache, "w", encoding="utf-8"), ensure_ascii=False)
                return d
        except Exception as e:
            print("래더 명단 수집 실패:", type(e).__name__)
    for path in (cache, os.path.join(HERE, "참고", "ks-clan-ladder", "명단.json")):
        if os.path.exists(path):
            try:
                return json.load(open(path, encoding="utf-8"))
            except Exception:
                pass
    return []


def fetch_tab(name):
    """config 의 sources.<name> 탭을 받는다(없으면 None). KPL 일정·명단·랭킹 같은 화면용 탭"""
    if name not in CFG["sources"]:
        return None
    return fetch_sheet(name)


# ───── 관리자가 등록한 시트 출처 (ELO_SOURCES_FILE) ─────
SRCSTAT_FILE = os.path.join(OUT, "srcstat.json")


def load_srcstat():
    try:
        d = json.load(open(SRCSTAT_FILE, encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def load_admin_sources():
    """ELO_SOURCES_FILE(JSON 배열) → 출처 목록. 파일이 없거나 깨졌으면 빈 목록"""
    path = os.environ.get("ELO_SOURCES_FILE")
    if not path or not os.path.exists(path):
        return []
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        print("출처 목록 파일을 읽지 못함:", type(e).__name__)
        return []
    if isinstance(d, dict):
        d = d.get("sources") or list(d.values())
    return [x for x in d if isinstance(x, dict)]


def load_repo_sources():
    """저장소에 적어 둔 출처(data/sources.json) — 카페 리그글에서 찾은 시트 등. 관리자 등록분과 합친다"""
    path = os.path.join(HERE, "data", "sources.json")
    try:
        d = json.load(open(path, encoding="utf-8"))
        return [x for x in d if isinstance(x, dict)]
    except Exception:
        return []


def collect_admin_sources(sources, stat):
    """등록된 출처마다 CSV 받기 → 매핑 적용 → 세트 목록. stat[id] 에 결과 기록"""
    out = []
    for src in sources:
        sid = str(src.get("id") or src.get("name") or "").strip()
        if not sid or not src.get("enabled", True):
            continue
        name = (src.get("name") or sid).strip()
        st = {"ok": False, "rows": 0, "games": 0, "skipped": 0, "msg": "", "at": NOW.strftime("%Y-%m-%d %H:%M")}
        stat[sid] = st
        url = sheetsrc.csv_url(src.get("url"), src.get("sheet") or "", src.get("gid") or "")
        cache = os.path.join(RAW, "src_" + re.sub(r"[^\w\-]", "_", sid) + ".csv")
        rows = None
        if not url:
            st["msg"] = "시트 주소가 없음"
            continue
        if not OFFLINE:
            try:
                rows = sheetsrc.fetch_rows(url)
                with open(cache, "w", encoding="utf-8", newline="") as f:
                    csv.writer(f).writerows(rows)
            except urllib.error.HTTPError as e:
                st["msg"] = f"접근 불가(HTTP {e.code}) — 시트를 '링크가 있는 모든 사용자 보기'로 공유해 주세요"
            except Exception as e:
                st["msg"] = f"수집 실패({type(e).__name__})"
        if rows is None and os.path.exists(cache):
            rows = list(csv.reader(open(cache, encoding="utf-8")))
            st["msg"] = (st["msg"] + " · " if st["msg"] else "") + "지난번 받은 사본 사용"
        if rows is None:
            SRC_STATUS.append({"name": "src:" + sid, "label": name, "status": st["msg"], "rows": 0})
            continue
        mp = src.get("mapping")
        if not mp:                                       # 매핑이 없으면 자동으로 짐작
            try:
                mp, _ = sheetsrc.guess_mapping(rows)
            except Exception:
                mp = None
            if not mp or mp.get("cols", {}).get("winner") is None or mp.get("cols", {}).get("loser") is None:
                st["msg"] = "승자·패자 열을 자동으로 못 찾음 — 운영진 화면에서 열을 지정해 주세요"
                continue
        if src.get("defaultDate") and not mp.get("defaultDate"):
            mp = dict(mp, defaultDate=src["defaultDate"])
        try:
            sets, nrows, skipped = sheetsrc.apply_mapping(rows, mp, (src.get("league") or "ELO").strip())
        except Exception as e:
            st["msg"] = f"매핑 적용 실패({type(e).__name__}) — 열 번호를 확인해 주세요"
            continue
        weight = src.get("weight")
        for g in sets:
            g["lg"] = CFG["league_group"].get(g["lg"], g["lg"])
            g["wr"], g["lr"] = clean_race(g["wr"]), clean_race(g["lr"])
            g["wt"], g["lt"] = clean_tier(g["wt"]), clean_tier(g["lt"])
            g["src"], g["url"] = name, ""
            if weight not in (None, "") and g["lg"] not in CFG["league_weight"]:
                CFG["league_weight"][g["lg"]] = float(weight)   # 처음 보는 리그는 출처 가중치로
        if weight not in (None, "") and src.get("league"):
            CFG["league_weight"][src["league"].strip()] = float(weight)
        st.update(ok=True, rows=nrows, skipped=skipped, games=len(sets))
        st["msg"] = (st["msg"] + " · " if st["msg"] else "") + f"{nrows}행 중 {len(sets)}세트 읽음, {skipped}행 건너뜀"
        SRC_STATUS.append({"name": "src:" + sid, "label": name, "status": "수집" if not OFFLINE else "캐시", "rows": nrows})
        out.append((sid, sets))
    return out


def load_cafe_games(path=None, label="카페 Elo 결과입력란", name="cafe", src_default="카페"):
    """경기 목록 JSON → 세트 목록. 기본은 tools/cafe.py 가 만든 out/cafe_games.json
    같은 모양으로: data/elo_backfill.json(카페 과거기록), tools/_submits.json(사이트 입력양식)"""
    path = path or os.path.join(OUT, "cafe_games.json")
    if not os.path.exists(path):
        return []
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception:
        return []
    out = []
    for x in d.get("games", d) if isinstance(d, dict) else d:
        dd = sheetsrc.parse_date(x.get("date"))
        if not dd or not x.get("winner") or not x.get("loser"):
            continue
        out.append({"d": dd, "lg": x.get("league") or "ELO", "map": (x.get("map") or "").strip(),
                    "w": x["winner"].strip(), "l": x["loser"].strip(),
                    "wr": clean_race(x.get("wrace")), "lr": clean_race(x.get("lrace")),
                    "wt": clean_tier(x.get("wtier")), "lt": clean_tier(x.get("ltier")),
                    "src": x.get("src") or src_default, "url": x.get("url") or ""})
    SRC_STATUS.append({"name": name, "label": label, "status": "수집", "rows": len(out)})
    return out


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


def _int(s, default=0):
    m = re.search(r"-?\d+", (s or "").replace(",", ""))
    return int(m.group()) if m else default


def _wl(s):
    """'23승 22패' → (23, 22)"""
    m = re.search(r"(\d+)\s*승\s*(\d+)\s*패", s or "")
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def build_kpl(sched, results, kroster, kranking, kfor):
    """KPL 화면용 묶음: 순위표·팀 명단·개인 랭킹·경기(세트 포함). 일정 탭을 못 받으면 None"""
    if not sched:
        return None
    C = lambda r, i: (r[i] if i < len(r) else "").strip()  # noqa: E731

    # 순위표: 순위(7)·팀명(9)·승(10)·패(11)·득실(12)·개인전(13)·에결(14)·벌점(15)
    standings = []
    for r in sched[:20]:
        if re.fullmatch(r"\d+", C(r, 7)) and C(r, 9) and re.fullmatch(r"-?\d+", C(r, 10)):
            sw, sl = _wl(C(r, 13))
            aw, al = _wl(C(r, 14))
            standings.append({"rank": int(C(r, 7)), "team": C(r, 9), "w": _int(C(r, 10)), "l": _int(C(r, 11)),
                              "diff": _int(C(r, 12)), "setW": sw, "setL": sl, "aceW": aw, "aceL": al,
                              "pen": _int(C(r, 15))})

    # 세트 기록: 경기결과 탭 블록(머리행에 날짜·리그구분·경기·HOME·점수·AWAY)
    blocks = {}
    cur = None
    for r in (results or [])[1:]:
        r = r + [""] * (24 - len(r))
        if C(r, 0) or C(r, 2):
            cur = {"date": C(r, 0), "stage": C(r, 1), "no": C(r, 2), "home": C(r, 3), "away": C(r, 7), "sets": []}
            blocks[(cur["stage"], cur["no"])] = cur
            d = sheetsrc.parse_date(cur["date"])
            if d:
                blocks[(d.isoformat(), cur["home"], cur["away"])] = cur
        if not cur or not C(r, 12) or not C(r, 16):
            continue                                     # 안 치른 세트는 뺀다
        w, l, wr, lr = C(r, 12), C(r, 16), clean_race(C(r, 14)), clean_race(C(r, 18))
        cur["sets"].append({"n": _int(C(r, 9)), "kind": "ACE" if "ACE" in C(r, 8).upper() else "개인",
                            "map": C(r, 10), "wteam": C(r, 11), "w": w, "wk": kfor(w, wr), "wtier": C(r, 13),
                            "wrace": wr, "lteam": C(r, 15), "l": l, "lk": kfor(l, lr), "ltier": C(r, 17),
                            "lrace": lr, "note": C(r, 19)})

    # 경기 일정: No(2)·날짜(3)·시간(4)·HOME(5)·점수(6):(8)·AWAY(9)·중계(10)·MVP(20)
    matches, rnd, sub = [], "", ""
    for r in sched:
        if C(r, 0):
            rnd = "POST" if "POST" in C(r, 0).upper() else C(r, 0)
            sub = ""
        if C(r, 1) and not re.fullmatch(r"W\d+", C(r, 1)):
            sub = C(r, 1)                                # 포스트시즌: 준PO / PO / FINAL
        if not (C(r, 2) and C(r, 5) and C(r, 9) and C(r, 7) == ":"):
            continue
        d = sheetsrc.parse_date(C(r, 3))
        stage = sub if rnd == "POST" and sub else rnd
        hs, as_ = _int(C(r, 6)), _int(C(r, 8))
        b = blocks.get((stage, C(r, 2))) or (blocks.get((d.isoformat(), C(r, 5), C(r, 9))) if d else None)
        sets = sorted(b["sets"], key=lambda x: x["n"]) if b else []
        played = (hs + as_) > 0 or bool(sets)
        matches.append({"date": d.isoformat() if d else "", "time": C(r, 4), "stage": stage, "no": C(r, 2),
                        "home": C(r, 5), "away": C(r, 9), "hs": hs, "as": as_, "mvp": C(r, 20),
                        "caster": C(r, 10), "played": played, "sets": sets if played else []})

    # 팀 명단: 소속팀(1)·아이디(2)·티어(3)·종족(4)·간부진(5)
    teams = {}
    for r in (kroster or [])[1:]:
        team, pid = C(r, 1), C(r, 2)
        if not team or not pid:
            continue
        race = clean_race(C(r, 4))
        role = C(r, 5) if C(r, 5) in ("팀장", "부팀장") else ""
        teams.setdefault(team, []).append({"id": pid, "k": kfor(pid, race), "tier": C(r, 3), "race": race, "role": role})
    order = {s["team"]: i for i, s in enumerate(standings)}
    team_list = [{"name": t, "members": sorted(m, key=lambda x: {"팀장": 0, "부팀장": 1}.get(x["role"], 2))}
                 for t, m in sorted(teams.items(), key=lambda kv: (order.get(kv[0], 99), kv[0]))]

    # 개인 랭킹: 순위·닉네임·티어·종족·출전·전체승패·승률·개인승패·에결승패·MVP·PT
    ranking = []
    for r in (kranking or [])[1:]:
        if not C(r, 1) or not re.fullmatch(r"\d+", C(r, 0)):
            continue
        race = clean_race(C(r, 3))
        ranking.append({"rank": _int(C(r, 0)), "id": C(r, 1), "k": kfor(C(r, 1), race), "tier": C(r, 2),
                        "race": race, "apps": _int(C(r, 4)), "w": _int(C(r, 5)), "l": _int(C(r, 6)),
                        "indW": _int(C(r, 8)), "indL": _int(C(r, 9)), "aceW": _int(C(r, 10)),
                        "aceL": _int(C(r, 11)), "mvp": _int(C(r, 12)), "pt": _int(C(r, 13))})

    return {"season": CFG["sources"].get("kpl_results", {}).get("title") or "KPL",
            "updated": NOW.strftime("%Y-%m-%d %H:%M"),
            "standings": standings, "teams": team_list, "ranking": ranking, "matches": matches}


def merge_dedup(games, new, label, loose=False):
    """
    새 출처 세트를 넣되, 같은 (날짜·리그·맵·승·패) 묶음은 출처 중 많은 쪽만 인정(옮겨 적은 중복 방지)
    loose=True(카페): 맵·리그를 안 적는 경우가 많아 (날짜·승·패)만 같아도 같은 경기로 본다
    """
    def key(g):
        if loose:
            return (g["d"], resolve(g["w"]), resolve(g["l"]))
        return (g["d"], g["lg"], g["map"], resolve(g["w"]), resolve(g["l"]))
    have = Counter(key(g) for g in games)
    newc, added = Counter(), 0
    for g in new:
        k = key(g)
        newc[k] += 1
        if newc[k] > have[k]:
            games.append(g)
            added += 1
        else:
            ISSUES["dup_cross_source"].append(f"{label} {g['d']} {g['w']}>{g['l']}")
    return added


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
    kpl_sched = fetch_tab("kpl_schedule")   # KPL 화면용(순위표·일정·팀·랭킹)
    kpl_roster = fetch_tab("kpl_roster")
    kpl_rank = fetch_tab("kpl_ranking")
    srcstat = load_srcstat()                # 카페 수집기가 먼저 써 둔 상태를 이어 씀
    srcs = load_admin_sources()
    have_ids = {str(x.get("id")) for x in srcs}
    srcs += [x for x in load_repo_sources() if str(x.get("id")) not in have_ids]
    admin = collect_admin_sources(srcs, srcstat)
    cafe = load_cafe_games()
    backfill = load_cafe_games(os.path.join(HERE, "data", "elo_backfill.json"), "카페 과거 ELO 기록", "backfill", "카페(과거)")
    subs_path = os.environ.get("ELO_SUBMITS_FILE")
    subs = load_cafe_games(subs_path, "사이트 결과 입력", "submits", "입력양식") if subs_path else []

    # 별칭: V5 DB 특이사항의 'A -> B' 표기, 래더 명단의 old 필드
    for x in (v5_db or []):
        for c in x[:3]:
            for o, nw in re.findall(r"([A-Za-z0-9_.\-]{2,})\s*->\s*([A-Za-z0-9_.\-]{2,})", c):
                add_alias(o, nw, "V5 DB 특이사항")
    for p in fetch_ladder_roster():
        for o in re.split(r"[,/ ]+", p.get("old") or ""):
            if o and p.get("id"):
                add_alias(o, p["id"], "래더 명단 old")

    # 세트 기록
    games = []
    if v5:
        games += parse_v5(v5, "V5")
    if kpl:
        games += parse_kpl(kpl, "KPL S10", CFG["sources"]["kpl_results"].get("season", "KPL"))
    if elo_new:
        merge_dedup(games, parse_v5(elo_new, "ELO New"), "ELO New")
    for sid, sets in admin:                 # 관리자 등록 시트
        added = merge_dedup(games, sets, sid)
        st = srcstat[sid]
        if added < len(sets):
            st["msg"] += f" · 이미 있는 기록과 겹쳐 {len(sets) - added}세트 제외"
        st["games"] = added
    if cafe:                                # 카페 결과입력란
        added = merge_dedup(games, cafe, "카페", loose=True)
        if "cafe" in srcstat:
            srcstat["cafe"]["added"] = added
            if added < len(cafe):
                srcstat["cafe"]["msg"] += f" · 이미 있는 기록과 겹쳐 {len(cafe) - added}세트 제외"
    for sid, sets in (("backfill", backfill), ("submits", subs)):
        if sets:
            added = merge_dedup(games, sets, sid, loose=True)
            srcstat[sid] = {"ok": True, "games": added, "rows": len(sets), "skipped": len(sets) - added,
                            "msg": f"{len(sets)}세트 중 {added}세트 반영", "at": NOW.strftime("%Y-%m-%d %H:%M")}
    json.dump(srcstat, open(SRCSTAT_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
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

    day = np.array([(g["d"] - EPOCH).days for g in games], dtype=int)
    WI = np.array([idx[g["wk"]] for g in games], dtype=int)
    LI = np.array([idx[g["lk"]] for g in games], dtype=int)
    LG = np.array([lidx[g["lg"]] for g in games], dtype=int)
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
    if n == 0:                              # 받은 자료가 하나도 없을 때도 죽지 않게
        R, EFF = np.zeros(0), np.zeros(0)
    else:
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
            "updated": NOW.strftime("%Y-%m-%d %H:%M"), "today": TODAY.isoformat(),
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

    # KPL 화면용 묶음 — 선수 키(k)는 data.json players[].k 와 같은 규칙
    def kfor(name, race=""):
        b = resolve(name)
        if not b:
            return None
        mr = main_race.get(b)
        k = f"{b}·{race}" if race and mr and race != mr else b
        return k if k in idx else (b if b in idx else None)
    try:
        kpl_block = build_kpl(kpl_sched, kpl, kpl_roster, kpl_rank, kfor)
    except Exception as e:                  # KPL 표 모양이 바뀌어도 전체 빌드는 계속
        print("KPL 묶음 만들기 실패:", type(e).__name__, e)
        kpl_block = None
    if kpl_block:
        data["kpl"] = kpl_block
    if not OFFLINE:
        json.dump({x["name"]: (NOW.strftime("%Y-%m-%d %H:%M") if x["status"] == "수집" else x["status"])
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
