# 시트 구조 살펴보기 (탭 목록 + 탭마다 앞부분 몇 줄) — 진단용
import sys, re, csv, io, urllib.request
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read().decode("utf-8", "replace")
for sid in sys.argv[1:]:
    print("=" * 30, sid)
    try:
        h = get(f"https://docs.google.com/spreadsheets/d/{sid}/htmlview")
    except Exception as e:
        print("htmlview 실패", e); continue
    tabs = re.findall(r'\{name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(\d+)"', h) or re.findall(r'id="sheet-button-(\d+)"[^>]*>(?:<a[^>]*>)?([^<]+)', h)
    print("탭:", tabs)
    for t in tabs:
        name, gid = (t if t[1].isdigit() else (t[1], t[0]))
        try:
            rows = list(csv.reader(io.StringIO(get(f"https://docs.google.com/spreadsheets/d/{sid}/gviz/tq?tqx=out:csv&gid={gid}"))))
        except Exception as e:
            print("--", name, gid, "실패", e); continue
        print(f"-- [{name}] gid={gid} 행 {len(rows)}")
        for r in rows[:14]:
            print("   ", [c[:18] for c in r[:22]])
