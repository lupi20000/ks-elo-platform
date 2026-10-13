# -*- coding: utf-8 -*-
"""
카페 'Elo 결과입력란'(71번 게시판) 글을 읽어 kS ELO 관리자 서버로 보낸다. 오라클 서버(VM)에서 매일 돈다.

  python push.py            # 새 글만 (지난번 보낸 글 다음부터)
  python push.py --all      # 처음 한 번: 게시판 전체 (과거 기록 채우기)

지키는 것 (카페알림 봇과 같은 약속)
  - cafe-toto 쿠키 파일(~/cafe-toto/data/bot_cookies.json)은 '읽기만' 한다. 절대 쓰지 않는다.
  - 로그인하지 않는다. 쿠키가 죽어 있으면 그냥 멈추고 로그만 남긴다.
설정: 같은 폴더 .env 에  ELO_INGEST_KEY=...  (보내기 열쇠)
"""
import json, os, re, sys, time, html, datetime as dt
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
COOKIE_FILE = os.path.join(os.path.expanduser("~"), "cafe-toto", "data", "bot_cookies.json")
STATE = os.path.join(HERE, "data", "state.json")
API = "https://ks-elo-api.afterworkting.workers.dev/cafe/ingest"
CLUB, MENU = "30800617", "71"
LIST = ("https://apis.naver.com/cafe-web/cafe2/ArticleListV2dot1.json"
        "?search.clubid={c}&search.menuid={m}&search.page={p}&search.perPage=50")
BODY = "https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/{c}/articles/{a}?useCafeId=true"
KST = dt.timezone(dt.timedelta(hours=9))


def env_key():
    p = os.path.join(HERE, ".env")
    for line in open(p, encoding="utf-8") if os.path.exists(p) else []:
        if line.strip().startswith("ELO_INGEST_KEY="):
            return line.split("=", 1)[1].strip()
    return os.environ.get("ELO_INGEST_KEY", "")


def cookie_header():
    d = json.load(open(COOKIE_FILE, encoding="utf-8"))          # 읽기만
    if isinstance(d, list):
        d = {c.get("name"): c.get("value") for c in d if isinstance(c, dict)}
    return "; ".join(f"{k}={v}" for k, v in d.items() if k and v)


def get(url, cookie=None):
    h = {"User-Agent": "Mozilla/5.0", "Referer": "https://cafe.naver.com/"}
    if cookie:
        h["Cookie"] = cookie
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30).read().decode("utf-8"))


def text_of(h):
    h = re.sub(r"<br\s*/?>|</p>|</div>", "\n", h or "", flags=re.I)
    return re.sub(r"\n\s*\n+", "\n", html.unescape(re.sub(r"<[^>]+>", " ", h))).strip()


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
    key = env_key()
    if not key:
        print("ELO_INGEST_KEY 가 없습니다(.env)"); return 1
    state = json.load(open(STATE, encoding="utf-8")) if os.path.exists(STATE) else {"last": 0}
    full = "--all" in sys.argv or not state.get("last")
    cookie = cookie_header()
    arts = []
    for page in range(1, 200 if full else 4):
        r = (get(LIST.format(c=CLUB, m=MENU, p=page), cookie).get("message") or {}).get("result") or {}
        lst = r.get("articleList") or []
        if not lst:
            break
        arts += [a for a in lst if str(a.get("menuId")) == MENU]
        if not r.get("hasNext", True):
            break
        time.sleep(0.4)
    new = [a for a in arts if full or int(a.get("articleId") or 0) > int(state.get("last") or 0)]
    print(f"{dt.datetime.now(KST):%Y-%m-%d %H:%M} 글 {len(arts)}개 중 보낼 글 {len(new)}개")
    posts, fail = [], 0
    for a in sorted(new, key=lambda x: int(x.get("articleId") or 0)):
        aid = a.get("articleId")
        try:
            art = (get(BODY.format(c=CLUB, a=aid), cookie).get("result") or {}).get("article") or {}
            body = text_of(art.get("contentHtml"))
        except Exception as e:
            fail += 1
            if fail >= 5 and not posts:
                print("본문을 계속 못 읽습니다 — 쿠키가 죽었을 수 있습니다(cafe-toto 쪽에서 되살려야 함):", type(e).__name__)
                return 1
            continue
        ts = (a.get("writeDateTimestamp") or 0) / 1000
        posts.append({"articleId": aid, "title": html.unescape(a.get("subject") or ""), "writer": a.get("writerNickname") or "",
                      "date": dt.datetime.fromtimestamp(ts, KST).strftime("%Y-%m-%d") if ts else "", "body": body})
        time.sleep(0.5)
    for i in range(0, len(posts), 100):
        req = urllib.request.Request(API, data=json.dumps({"posts": posts[i:i + 100]}).encode("utf-8"),
                                     headers={"content-type": "application/json", "x-ingest-key": key}, method="POST")
        print("보냄:", urllib.request.urlopen(req, timeout=60).read().decode("utf-8"))
    if posts:
        state["last"] = max(int(p["articleId"]) for p in posts)
        json.dump(state, open(STATE, "w", encoding="utf-8"))
    print(f"끝: 보낸 글 {len(posts)}개, 본문 실패 {fail}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
