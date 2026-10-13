# -*- coding: utf-8 -*-
"""
시트 주소를 주면 '어느 열이 승자·패자·날짜·맵인지' 매핑을 짐작해서 JSON으로 보여준다.

  python tools/analyze_sheet.py "https://docs.google.com/spreadsheets/d/<ID>/edit#gid=<gid>"
  python tools/analyze_sheet.py <주소> --rows 8      # 미리보기 세트 수
  python tools/analyze_sheet.py --file 받은파일.csv   # 인터넷 없이 CSV 파일로

출력 맨 위 JSON(mapping)을 관리자 화면의 출처 등록 'mapping' 칸에 그대로 넣으면 된다.
열 번호는 0부터 센다(A열=0). headerRow 는 1부터 센다(머리행이 몇 번째 줄인지).
"""
import argparse, csv, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sheetsrc  # noqa: E402


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="시트 매핑 짐작")
    ap.add_argument("url", nargs="?", help="구글 시트 주소(편집 링크 그대로 OK)")
    ap.add_argument("--file", help="CSV 파일 경로(인터넷 없이 시험할 때)")
    ap.add_argument("--rows", type=int, default=5, help="미리보기 세트 수")
    a = ap.parse_args()
    if a.file:
        rows = list(csv.reader(open(a.file, encoding="utf-8")))
    elif a.url:
        u = sheetsrc.csv_url(a.url)
        try:
            rows = sheetsrc.fetch_rows(u)
        except Exception as e:
            print(json.dumps({"ok": False, "msg": f"시트를 받지 못함({type(e).__name__}: {e}) — 링크 공유가 켜져 있는지 확인"},
                             ensure_ascii=False))
            sys.exit(1)
    else:
        ap.print_help()
        sys.exit(2)

    mapping, head = sheetsrc.guess_mapping(rows)
    games, nrows, skipped = sheetsrc.apply_mapping(rows, mapping, "ELO")
    missing = [k for k in ("date", "winner", "loser") if mapping["cols"].get(k) is None
               and not (k == "date" and mapping["cols"].get("year") is not None)]
    print(json.dumps(mapping, ensure_ascii=False))
    print()
    print(f"머리행({mapping['headerRow']}번째 줄):")
    for j, h in enumerate(head):
        if h.strip():
            tag = [k for k, v in mapping["cols"].items() if v == j]
            print(f"  {j:>2}: {h.strip()[:20]}" + (f"  ← {', '.join(tag)}" if tag else ""))
    print()
    if missing:
        print("못 찾은 열:", ", ".join(missing), "— 직접 열 번호를 넣어 주세요")
    print(f"데이터 {nrows}행 → 세트 {len(games)}개 읽힘, {skipped}행 건너뜀")
    for g in games[:a.rows]:
        print(f"  {g['d']} [{g['lg']}] {g['map']}: {g['w']}({g['wr']},{g['wt']}) > {g['l']}({g['lr']},{g['lt']})")


if __name__ == "__main__":
    main()
