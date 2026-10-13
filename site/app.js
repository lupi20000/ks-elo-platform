/* kS ELO — 클라이언트 (프레임워크 없음) */
(() => {
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RN = ["P", "T", "Z"], RACE_KO = { P: "프로토스", T: "테란", Z: "저그" };
const ST_KO = { A: "활동", D: "휴면", X: "탈퇴·외부" };
let D, P, G, T, byP, EPOCH, rankAll = {}, rankTier = {}, ranked = [], keyIdx = {};

/* ---------- 공통 ---------- */
const tc = t => (t && T.includes(t)) ? `var(--${t})` : "var(--none)";
const tierB = t => t ? `<span class="tier ${esc(t)}" style="--tc:${tc(t)}">${esc(t)}</span>` : `<span class="tier none">미배정</span>`;
const raceB = r => r ? `<span class="race" style="--rc:var(--${r})" title="${RACE_KO[r]}">${r}</span>` : "";
const stB = s => s === "A" ? "" : `<span class="st ${s}">${ST_KO[s]}</span>`;
const day2date = d => { const x = new Date(EPOCH.getTime() + d * 864e5); return x; };
const fmtD = d => { const x = day2date(d); return `${x.getFullYear()}.${String(x.getMonth() + 1).padStart(2, "0")}.${String(x.getDate()).padStart(2, "0")}`; };
const dateDay = s => Math.round((new Date(s + "T00:00:00Z") - EPOCH) / 864e5);
const pct = (w, n) => n ? (100 * w / n) : NaN;
const pctS = (w, n) => n ? (100 * w / n).toFixed(1) + "%" : "—";
const r0 = x => Math.round(x);
const isRanked = p => p.eff >= D.meta.rankedMinEff && p.w + p.l >= D.meta.rankedMinGames;
const pLink = i => `#/p/${encodeURIComponent(P[i].k)}`;
const delta = p => {
  const m = D.months.length - 2; if (!p.h.length) return null;
  const prev = p.h.filter(x => x[0] <= m).pop(); if (!prev) return null;
  return p.r - prev[1];
};
const dl = v => v == null ? `<span class="dl z">NEW</span>` : Math.abs(v) < 0.5 ? `<span class="dl z">—</span>` :
  `<span class="dl ${v > 0 ? "up" : "dn"}">${v > 0 ? "▲" : "▼"}${Math.abs(r0(v))}</span>`;
const expect = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));

/* ---------- 데이터 준비 ---------- */
function prep(data) {
  D = data; P = D.players; G = D.g; T = D.tiers;
  EPOCH = new Date(D.meta.epoch + "T00:00:00Z");
  byP = P.map(() => []);
  G.forEach((g, j) => { byP[g[3]].push(j); byP[g[4]].push(j); });
  P.forEach((p, i) => { p.i = i; keyIdx[p.k] = i; });
  ranked = P.filter(p => p.st === "A" && !p.off && isRanked(p)).sort((a, b) => b.r - a.r);
  ranked.forEach((p, n) => rankAll[p.i] = n + 1);
  T.forEach(t => ranked.filter(p => p.tier === t).forEach((p, n) => rankTier[p.i] = n + 1));
  $("#stamp").innerHTML = `UPDATED <b>${esc(D.meta.updated)}</b>`;
  $("#foot").innerHTML = `kS CLAN ELO · 세트 ${G.length.toLocaleString()} · 선수 ${P.filter(p => !p.off).length.toLocaleString()} · 시간감쇠 반감기 ${D.meta.halfLife}일 · <a href="#/about" style="text-decoration:underline">계산 기준</a>`;
}

/* ---------- 라우터 ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [r, ...rest] = h.split("/");
  const name = r || "rank";
  document.querySelectorAll("[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === (name === "p" ? "rank" : name)));
  window.scrollTo(0, 0);
  ({ rank: viewRank, p: () => viewPlayer(decodeURIComponent(rest.join("/"))), stats: () => viewStats(rest[0]),
     vs: () => viewVs(rest.map(decodeURIComponent)), ladder: viewLadder, admin: viewAdmin, about: viewAbout }[name] || viewRank)();
}
window.addEventListener("hashchange", route);

/* ---------- 랭킹 ---------- */
const RS = { tier: "all", race: "all", st: "A", q: "", sort: "r", dir: -1, limit: 60, prov: false, off: false };
function viewRank() {
  const gap = D.meta.gaps.length ? `<div class="notice"><b>!</b><div>${D.meta.gaps.map(esc).join("<br>")}<br>→ 이 구간 기록은 아직 순위에 반영되지 않았습니다.</div></div>` : "";
  const top = ranked.slice(0, 3);
  const pod = top.map((p, n) => `
    <a class="pod ${n ? "" : "first"}" style="--tc:${tc(p.tier)}" href="${pLink(p.i)}">
      <div class="pos">${n + 1}</div>
      <div class="kicker">NO.${n + 1}</div>
      <div class="who" style="margin-top:8px">${esc(p.id)} ${raceB(p.race)} ${tierB(p.tier)}</div>
      <div class="rt num">${r0(p.r)}<small>ELO</small></div>
      <div class="sub"><span>${p.w}승 ${p.l}패</span><span>${pctS(p.w, p.w + p.l)}</span><span>${dl(delta(p))}</span></div>
    </a>`).join("");
  app.innerHTML = `${gap}
    <div class="h"><h2><small>현재 클랜원 · 전 리그 통합 · 최근 경기일수록 가중</small>Power Ranking</h2>
      <div class="aside">정식 ${ranked.length}명</div></div>
    <div class="podium">${pod}</div>
    <div class="bar">
      <label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input id="q" placeholder="아이디 검색" value="${esc(RS.q)}" autocomplete="off"></label>
      <select class="sel" id="st">
        <option value="A">활동 클랜원</option><option value="D">휴면</option><option value="X">탈퇴·외부</option><option value="all">전체 DB</option>
      </select>
    </div>
    <div class="bar" style="margin-top:0">
      <div class="chips" id="tchips">${["all", ...T].map(t => `<span class="chip ${RS.tier === t ? "on" : ""}" data-t="${t}" style="--tc:${tc(t)}">${t === "all" ? "전체 티어" : `<i></i>${t}`}</span>`).join("")}</div>
    </div>
    <div class="bar" style="margin-top:0">
      <div class="chips" id="rchips">${["all", ...RN].map(r => `<span class="chip ${RS.race === r ? "on" : ""}" data-r="${r}">${r === "all" ? "전 종족" : RACE_KO[r]}</span>`).join("")}
        <span class="chip ${RS.prov ? "on" : ""}" id="prov">잠정 포함</span>
        <span class="chip ${RS.off ? "on" : ""}" id="offc">부종 포함</span></div>
    </div>
    <div class="panel scroll"><table class="tbl" id="rt"></table></div>
    <button class="more" id="more">MORE</button>`;
  $("#st").value = RS.st;
  $("#q").oninput = e => { RS.q = e.target.value; RS.limit = 60; drawRank(); };
  $("#st").onchange = e => { RS.st = e.target.value; RS.limit = 60; drawRank(); };
  $("#tchips").onclick = e => { const c = e.target.closest("[data-t]"); if (!c) return; RS.tier = c.dataset.t; RS.limit = 60; viewRank(); };
  $("#rchips").onclick = e => {
    const c = e.target.closest(".chip"); if (!c) return;
    if (c.id === "prov") RS.prov = !RS.prov; else if (c.id === "offc") RS.off = !RS.off; else RS.race = c.dataset.r;
    RS.limit = 60; viewRank();
  };
  $("#more").onclick = () => { RS.limit += 100; drawRank(); };
  drawRank();
}
function drawRank() {
  const q = RS.q.trim().toLowerCase();
  let L = P.filter(p => (RS.st === "all" || p.st === RS.st) && (RS.off || !p.off) && (RS.prov || isRanked(p))
    && (RS.tier === "all" || p.tier === RS.tier) && (RS.race === "all" || p.race === RS.race)
    && (!q || p.id.toLowerCase().includes(q)) && (p.w + p.l > 0 || RS.st === "A"));
  const key = { r: p => p.r, n: p => p.w + p.l, wr: p => pct(p.w, p.w + p.l) || 0, last: p => p.last || "", lad: p => p.lad?.rating || 0, d: p => delta(p) ?? -999 }[RS.sort];
  L.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * RS.dir || b.r - a.r);
  const th = (k, t, cls = "") => `<th class="${cls} ${RS.sort === k ? "sorted" : ""}" data-s="${k}">${t}${RS.sort === k ? (RS.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  const rows = L.slice(0, RS.limit).map(p => {
    const rk = rankAll[p.i];
    const n = p.w + p.l;
    return `<tr data-k="${esc(p.k)}">
      <td class="rk num ${rk && rk <= 3 ? "t3" : ""}">${rk || "–"}</td>
      <td class="stripe" style="--tc:${tc(p.tier)}"></td>
      <td class="nm">${esc(p.id)} ${stB(p.st)} ${isRanked(p) ? "" : `<span class="prov">잠정</span>`}
        <span class="sub">${p.tier ? esc(p.tier) : "미배정"}${rankTier[p.i] ? ` #${rankTier[p.i]}` : ""} · ${RACE_KO[p.race] || "—"}</span></td>
      <td class="r rt num">${r0(p.r)}</td>
      <td class="r">${dl(delta(p))}</td>
      <td class="r hide-m num" style="font-size:15px">${p.w}-${p.l}</td>
      <td class="r hide-m"><span class="wr num">${pctS(p.w, n)}<span class="b"><i style="width:${pct(p.w, n) || 0}%"></i></span></span></td>
      <td class="r hide-m num" style="color:var(--ink2)">${p.lad?.rating ? p.lad.rating : "—"}</td>
      <td class="r hide-m" style="color:var(--ink3);font-size:12px">${p.last ? p.last.replaceAll("-", ".") : "—"}</td></tr>`;
  }).join("");
  $("#rt").innerHTML = `<thead><tr><th>#</th><th></th><th>선수</th>${th("r", "ELO", "r")}${th("d", "월간", "r")}${th("n", "전적", "r hide-m")}${th("wr", "승률", "r hide-m")}${th("lad", "래더", "r hide-m")}${th("last", "최근", "r hide-m")}</tr></thead>
    <tbody>${rows || `<tr><td colspan="9" class="empty">조건에 맞는 선수가 없습니다</td></tr>`}</tbody>`;
  $("#more").style.display = L.length > RS.limit ? "" : "none";
  $("#rt thead").onclick = e => { const s = e.target.closest("[data-s]")?.dataset.s; if (!s) return; RS.dir = RS.sort === s ? -RS.dir : -1; RS.sort = s; drawRank(); };
  $("#rt tbody").onclick = e => { const k = e.target.closest("tr[data-k]")?.dataset.k; if (k) location.hash = `#/p/${encodeURIComponent(k)}`; };
}

/* ---------- 선수 ---------- */
function agg(idxs, i, keyFn) {
  const m = new Map();
  for (const j of idxs) {
    const g = G[j], win = g[3] === i, k = keyFn(g, win);
    if (k == null) continue;
    const o = m.get(k) || { w: 0, l: 0 }; win ? o.w++ : o.l++; m.set(k, o);
  }
  return [...m.entries()].map(([k, o]) => ({ k, ...o, n: o.w + o.l }));
}
function chart(h, opts = {}) {
  if (!h.length) return `<div class="empty">그래프를 그릴 기록이 없습니다</div>`;
  const W = Math.max(300, Math.min(760, (app.clientWidth || 720) - 40)), H = opts.h || (W < 500 ? 190 : 220), pl = 40, pr = 12, pt = 14, pb = 24;
  const m0 = h[0][0], m1 = Math.max(D.months.length - 1, h[h.length - 1][0]);
  const vs = h.map(x => x[1]); let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = Math.max(30, (hi - lo) * .12); lo -= pad; hi += pad;
  const X = m => pl + (m1 === m0 ? (W - pl - pr) / 2 : (m - m0) / (m1 - m0) * (W - pl - pr));
  const Y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  const step = Math.ceil((hi - lo) / 4 / 50) * 50;
  let grid = "";
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
  let xl = "";
  D.months.forEach((mm, k) => { if (k >= m0 && k <= m1 && mm.endsWith("-01")) xl += `<text x="${X(k)}" y="${H - 6}" text-anchor="middle">${mm.slice(0, 4)}</text>`; });
  let adj = "";
  D.adjustments.forEach(a => { const k = D.months.indexOf(a.date.slice(0, 7)); if (k >= m0 && k <= m1) adj += `<line class="adj" x1="${X(k)}" x2="${X(k)}" y1="${pt}" y2="${H - pb}"><title>${esc(a.name)} 등급조정 ${a.date}</title></line>`; });
  const pts = h.map(x => `${X(x[0]).toFixed(1)},${Y(x[1]).toFixed(1)}`);
  const area = `M${X(h[0][0])},${H - pb}L${pts.join("L")}L${X(h[h.length - 1][0])},${H - pb}Z`;
  const last = h[h.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">
    <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c6ff3d" stop-opacity=".22"/><stop offset="1" stop-color="#c6ff3d" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${grid}</g>${adj}${xl}<path class="ar" d="${area}"/><polyline class="ln" points="${pts.join(" ")}"/>
    <circle class="dot" cx="${X(last[0])}" cy="${Y(last[1])}" r="4"/></svg>`;
}
function muRows(rows, labelFn, color) {
  return rows.map(o => `<div class="row"><span class="lbl">${labelFn(o.k)}</span>
    <div class="track" style="--c:${color ? color(o.k) : (o.n && o.w / o.n >= .5 ? "var(--acc)" : "var(--down)")}"><i style="width:${pct(o.w, o.n)}%"></i></div>
    <span class="v"><b>${pctS(o.w, o.n)}</b> ${o.w}-${o.l}</span></div>`).join("");
}
function viewPlayer(k) {
  const i = keyIdx[k];
  if (i == null) { app.innerHTML = `<div class="empty">선수를 찾을 수 없습니다</div>`; return; }
  const p = P[i], idxs = byP[i], n = p.w + p.l;
  const myRace = (g, win) => RN[win ? g[5] : g[6]];
  const vsRace = agg(idxs, i, (g, win) => RN[win ? g[6] : g[5]] ?? null).sort((a, b) => RN.indexOf(a.k) - RN.indexOf(b.k));
  const byLg = agg(idxs, i, g => g[1]).sort((a, b) => b.n - a.n);
  const byMap = agg(idxs, i, g => g[2] >= 0 ? g[2] : null).sort((a, b) => b.n - a.n).slice(0, 10);
  const byOpp = agg(idxs, i, (g, win) => win ? g[4] : g[3]).sort((a, b) => b.n - a.n).slice(0, 10);
  const byYear = agg(idxs, i, g => day2date(g[0]).getFullYear()).sort((a, b) => a.k - b.k);
  const recent = idxs.slice(-15).reverse();
  const form = idxs.slice(-10).map(j => G[j][3] === i ? `<span class="res W">W</span>` : `<span class="res L">L</span>`).join("");
  const sibs = P.filter(q => q.base === p.base && q.k !== p.k);
  const peak = p.h.length ? Math.max(...p.h.map(x => x[1])) : null;
  const lad = p.lad;
  app.innerHTML = `<a class="back" onclick="history.length>1?history.back():location.hash='#/'">← 목록</a>
  <section class="hero" style="--tc:${tc(p.tier)}">
    <div>
      <div class="kicker">${p.off ? "OFF-RACE PROFILE" : "PLAYER"}</div>
      <div class="id">${esc(p.id)}</div>
      <div class="meta">${tierB(p.tier)} ${raceB(p.race)} <span class="st ${p.st}">${ST_KO[p.st]}</span>
        ${isRanked(p) ? "" : `<span class="prov">잠정 — 유효경기 ${p.eff.toFixed(1)}</span>`}
        ${sibs.map(s => `<a class="chip" href="${pLink(s.i)}">${esc(s.id)}</a>`).join("")}</div>
      <div class="form" style="margin-top:12px">${form}</div>
    </div>
    <div class="big">
      <div class="kv acc"><b class="num">${r0(p.r)}</b><span>ELO</span></div>
      <div class="kv"><b class="num">${rankAll[i] ? "#" + rankAll[i] : "—"}</b><span>클랜</span></div>
      <div class="kv"><b class="num">${rankTier[i] ? "#" + rankTier[i] : "—"}</b><span>${esc(p.tier || "티어")} 내</span></div>
    </div>
  </section>
  <div class="stats" style="margin-top:12px">
    <div><b class="num">${p.w}-${p.l}</b><span>통산 전적</span></div>
    <div><b class="num">${pctS(p.w, n)}</b><span>승률</span></div>
    <div><b class="num">${peak ?? "—"}</b><span>최고 레이팅(월말)</span></div>
    <div><b class="num">${dl(delta(p))}</b><span>지난달 대비</span></div>
  </div>
  <div class="grid c21">
    <div class="card"><h3>Rating Trend<em>월말 기준 · 점선 = 등급조정일</em></h3>${chart(p.h)}</div>
    <div class="card"><h3>vs Race</h3><div class="mu">${muRows(vsRace, r => `vs ${r}`, r => `var(--${r})`) || `<div class="empty">—</div>`}</div>
      <h3 style="margin-top:18px">By Year</h3><div class="mu">${muRows(byYear, y => y)}</div></div>
  </div>
  <div class="grid c3">
    <div class="card"><h3>리그별</h3><table class="mini"><tr><th>리그</th><th class="r">전적</th><th class="r">승률</th></tr>
      ${byLg.map(o => `<tr><td>${esc(D.leagues[o.k].name)}</td><td class="r num">${o.w}-${o.l}</td><td class="r num">${pctS(o.w, o.n)}</td></tr>`).join("")}</table></div>
    <div class="card"><h3>맵별<em>상위 10</em></h3><table class="mini"><tr><th>맵</th><th class="r">전적</th><th class="r">승률</th></tr>
      ${byMap.map(o => `<tr><td>${esc(D.maps[o.k])}</td><td class="r num">${o.w}-${o.l}</td><td class="r num">${pctS(o.w, o.n)}</td></tr>`).join("") || `<tr><td colspan=3 class="empty">—</td></tr>`}</table></div>
    <div class="card"><h3>자주 만난 상대</h3><table class="mini"><tr><th>상대</th><th class="r">전적</th><th class="r">ELO</th></tr>
      ${byOpp.map(o => `<tr class="clk" data-vs="${esc(P[o.k].k)}"><td>${esc(P[o.k].id)} ${raceB(P[o.k].race)}</td><td class="r num">${o.w}-${o.l}</td><td class="r num">${r0(P[o.k].r)}</td></tr>`).join("")}</table></div>
  </div>
  <div class="grid ${lad ? "c21" : ""}">
    <div class="card"><h3>최근 경기<em>${recent.length}경기</em></h3><div class="scroll"><table class="mini">
      <tr><th></th><th>날짜</th><th>리그</th><th>상대</th><th>맵</th></tr>
      ${recent.map(j => { const g = G[j], win = g[3] === i, o = win ? g[4] : g[3];
        return `<tr class="clk" data-vs="${esc(P[o].k)}"><td><span class="res ${win ? "W" : "L"}">${win ? "W" : "L"}</span></td><td class="num">${fmtD(g[0])}</td>
        <td>${esc(D.leagues[g[1]].name)}</td><td>${esc(P[o].id)} ${raceB(RN[win ? g[6] : g[5]])}</td><td style="color:var(--ink3)">${esc(D.maps[g[2]] || "")}</td></tr>`; }).join("")}
    </table></div></div>
    ${lad ? `<div class="card"><h3>Ladder<em>cwal.gg</em></h3>
      <div class="stats" style="grid-template-columns:1fr 1fr">
        <div><b class="num">${lad.rating || "—"}</b><span>래더 점수${lad.est ? " (추정)" : ""}</span></div>
        <div><b class="num">${lad.standing ? "#" + lad.standing.toLocaleString() : "—"}</b><span>전체 순위</span></div>
        <div><b class="num">${lad.w}-${lad.l}</b><span>시즌 전적</span></div>
        <div><b class="num">${esc(lad.toon)}</b><span>계정</span></div></div>
      <div class="mu" style="margin-top:12px">${muRows(Object.entries(lad.mu || {}).map(([k, v]) => ({ k, w: v[0], l: v[1], n: v[0] + v[1] })), x => x)}</div></div>` : ""}
  </div>
  <p style="color:var(--ink3);font-size:12px;margin-top:14px">기록 기간 ${p.first ? p.first.replaceAll("-", ".") : "—"} ~ ${p.last ? p.last.replaceAll("-", ".") : "—"} · 시드 ${p.seed} · 감쇠 유효경기 ${p.eff.toFixed(1)}</p>`;
  app.onclick = e => { const v = e.target.closest("[data-vs]")?.dataset.vs; if (v) location.hash = `#/vs/${encodeURIComponent(p.k)}/${encodeURIComponent(v)}`; };
}

/* ---------- 분석 ---------- */
function viewStats(tab = "league") {
  app.onclick = null;
  const tabs = { league: "리그", tier: "티어", race: "종족", map: "맵", activity: "활동" };
  app.innerHTML = `<div class="h"><h2><small>${G.length.toLocaleString()}세트 · ${fmtD(G[0][0])} ~ ${fmtD(G[G.length - 1][0])}</small>Analytics</h2></div>
    <div class="seg">${Object.entries(tabs).map(([k, v]) => `<button class="${k === tab ? "on" : ""}" data-tab="${k}">${v}</button>`).join("")}</div><div id="sv"></div>`;
  $(".seg").onclick = e => { const t = e.target.dataset.tab; if (t) location.hash = `#/stats/${t}`; };
  const sv = $("#sv");
  if (tab === "league") {
    const L = D.leagues.map((l, k) => ({ ...l, k, n: 0, ps: new Set(), d0: 1e9, d1: -1, wins: new Map() }));
    G.forEach(g => { const o = L[g[1]]; o.n++; o.ps.add(g[3]); o.ps.add(g[4]); o.d0 = Math.min(o.d0, g[0]); o.d1 = Math.max(o.d1, g[0]); o.wins.set(g[3], (o.wins.get(g[3]) || 0) + 1); });
    const max = Math.max(...L.map(o => o.n));
    sv.innerHTML = `<div class="panel scroll"><table class="tbl"><thead><tr><th>리그</th><th class="r">가중치</th><th class="r">세트</th><th class="r hide-m">선수</th><th class="hide-m">기간</th><th class="hide-m">최다승</th></tr></thead><tbody>
      ${L.filter(o => o.n).sort((a, b) => b.n - a.n).map(o => { const top = [...o.wins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        return `<tr style="cursor:default"><td class="nm">${esc(o.name)}<span class="sub"><span class="wr"><span class="b" style="width:120px"><i style="width:${100 * o.n / max}%;background:var(--acc)"></i></span></span></span></td>
        <td class="r num">×${o.w}</td><td class="r num rt">${o.n.toLocaleString()}</td><td class="r hide-m num">${o.ps.size}</td>
        <td class="hide-m" style="color:var(--ink3);font-size:12px">${fmtD(o.d0)} ~ ${fmtD(o.d1)}</td>
        <td class="hide-m">${top.map(([pi, c]) => `<a href="${pLink(pi)}">${esc(P[pi].id)}</a> <span style="color:var(--ink3)">${c}</span>`).join(" · ")}</td></tr>`; }).join("")}
      </tbody></table></div><p class="legend">가중치는 기존 ELO V5 시트의 대회 가중치를 그대로 가져왔고, 레이팅 계산엔 √가중치로 완화해 적용합니다.</p>`;
  }
  if (tab === "tier") {
    const M = T.map(() => T.map(() => ({ w: 0, n: 0 })));
    G.forEach(g => { const a = g[7], b = g[8]; if (a < 0 || b < 0 || a >= T.length || b >= T.length || a === b) return; M[a][b].w++; M[a][b].n++; M[b][a].n++; });
    const cell = o => { if (o.n < 5) return `<td style="background:#14171c;color:var(--ink3)">${o.n ? "·" : ""}</td>`;
      const v = o.w / o.n, c = v >= .5 ? `rgba(61,255,162,${(v - .5) * 1.6})` : `rgba(255,77,106,${(.5 - v) * 1.6})`;
      return `<td style="background:${c}" title="${o.w}승 ${o.n - o.w}패">${(v * 100).toFixed(0)}<small>${o.n}</small></td>`; };
    const dist = T.map(t => { const rs = ranked.filter(p => p.tier === t).map(p => p.r).sort((a, b) => a - b);
      return { t, rs, med: rs.length ? rs[Math.floor(rs.length / 2)] : null }; });
    const all = dist.flatMap(d => d.rs); const lo = Math.min(...all) - 20, hi = Math.max(...all) + 20, X = v => 100 * (v - lo) / (hi - lo);
    sv.innerHTML = `<div class="grid c2" style="margin-top:0">
      <div class="card"><h3>티어 상성<em>행 티어의 승률 % · 작은 숫자 = 세트 수</em></h3><div class="scroll"><table class="heat">
        <tr><th></th>${T.map(t => `<th style="color:${tc(t)}">${t.slice(0, 3)}</th>`).join("")}</tr>
        ${T.map((t, a) => `<tr><th style="color:${tc(t)};text-align:right">${t}</th>${T.map((_, b) => a === b ? `<td style="background:#0e1013"></td>` : cell(M[a][b])).join("")}</tr>`).join("")}
      </table></div><p class="legend">시트에 기록된 '경기 당시' 티어 기준. 5세트 미만 칸은 생략.</p></div>
      <div class="card"><h3>티어별 레이팅 분포<em>현재 정식 순위 기준</em></h3>
        ${dist.map(d => `<div style="display:grid;grid-template-columns:64px 1fr 52px;gap:10px;align-items:center;margin:10px 0">
          ${tierB(d.t)}<div style="position:relative;height:18px;background:#15191f">
          ${d.rs.length ? `<div style="position:absolute;top:7px;height:4px;left:${X(d.rs[0])}%;width:${X(d.rs[d.rs.length - 1]) - X(d.rs[0])}%;background:${tc(d.t)};opacity:.35"></div>
          ${d.rs.map(v => `<i style="position:absolute;top:4px;width:2px;height:10px;left:${X(v)}%;background:${tc(d.t)}"></i>`).join("")}
          <i style="position:absolute;top:0;width:3px;height:18px;left:${X(d.med)}%;background:#fff"></i>` : ""}</div>
          <span class="num" style="text-align:right;font-size:15px">${d.med ? r0(d.med) : "—"}</span></div>`).join("")}
        <p class="legend">흰 막대 = 중앙값 · 티어가 겹치는 구간이 승격·강등 후보 구간입니다.</p></div></div>`;
  }
  if (tab === "race" || tab === "map") {
    const pairs = [["P", "T"], ["P", "Z"], ["T", "Z"]];
    const mk = () => ({ PT: { w: 0, n: 0 }, PZ: { w: 0, n: 0 }, TZ: { w: 0, n: 0 }, mirror: 0, n: 0 });
    const add = (o, g) => { const a = RN[g[5]], b = RN[g[6]]; if (!a || !b) return; o.n++; if (a === b) { o.mirror++; return; }
      const [x, y] = [a, b].sort(), key = x + y; o[key].n++; if (a === x) o[key].w++; };
    if (tab === "race") {
      const tot = mk(), years = {};
      G.forEach(g => { add(tot, g); const y = day2date(g[0]).getFullYear(); add(years[y] = years[y] || mk(), g); });
      const card = (o, title) => `<div class="card"><h3>${title}<em>${o.n.toLocaleString()}세트</em></h3><div class="mu">
        ${pairs.map(([a, b]) => { const s = o[a + b]; return `<div class="row" style="grid-template-columns:62px 1fr 92px"><span class="lbl"><span style="color:var(--${a})">${a}</span>v<span style="color:var(--${b})">${b}</span></span>
        <div class="track" style="--c:var(--${a});background:color-mix(in srgb,var(--${b}) 55%,#1b1f26)"><i style="width:${pct(s.w, s.n) || 50}%"></i></div>
        <span class="v"><b>${pctS(s.w, s.n)}</b> ${s.n}</span></div>`; }).join("")}</div></div>`;
      const pop = { P: 0, T: 0, Z: 0 }; ranked.forEach(p => p.race && pop[p.race]++);
      const avg = r => { const L = ranked.filter(p => p.race === r); return L.length ? r0(L.reduce((s, p) => s + p.r, 0) / L.length) : "—"; };
      sv.innerHTML = `<div class="stats" style="margin-bottom:12px">${RN.map(r => `<div><b class="num" style="color:var(--${r})">${pop[r]}명</b><span>${RACE_KO[r]} · 평균 ELO ${avg(r)}</span></div>`).join("")}
        <div><b class="num">${pctS(tot.mirror, tot.n)}</b><span>동족전 비율</span></div></div>
        <div class="grid c2" style="margin-top:0">${card(tot, "전체 종족 상성")}${Object.keys(years).sort().reverse().map(y => card(years[y], y + "년")).join("")}</div>
        <p class="legend">막대 왼쪽 색 = 앞 종족 승률. 각 세트 기록의 종족 기준(부종 포함).</p>`;
    } else {
      const mp = D.maps.map(() => mk());
      G.forEach(g => g[2] >= 0 && add(mp[g[2]], g));
      sv.innerHTML = `<div class="panel scroll"><table class="tbl"><thead><tr><th>맵</th><th class="r">세트</th><th class="r">PvT</th><th class="r">PvZ</th><th class="r">TvZ</th></tr></thead><tbody>
        ${mp.map((o, k) => ({ o, k })).filter(x => x.o.n >= 20).sort((a, b) => b.o.n - a.o.n).map(({ o, k }) => `<tr style="cursor:default"><td class="nm">${esc(D.maps[k])}</td><td class="r num rt">${o.n}</td>
          ${pairs.map(([a, b]) => { const s = o[a + b], v = pct(s.w, s.n); return `<td class="r num" style="color:${!s.n ? "var(--ink3)" : v >= 55 ? `var(--${a})` : v <= 45 ? `var(--${b})` : "var(--ink)"}">${pctS(s.w, s.n)} <span style="color:var(--ink3);font-size:11px">${s.n}</span></td>`; }).join("")}</tr>`).join("")}
        </tbody></table></div><p class="legend">20세트 이상 맵 · 수치는 앞 종족 승률 · 55% 이상/45% 이하는 유리 종족 색으로 표시</p>`;
    }
  }
  if (tab === "activity") {
    const nM = D.months.length, gm = new Array(nM).fill(0), pm = D.months.map(() => new Set());
    const m0y = +D.months[0].slice(0, 4), m0m = +D.months[0].slice(5);
    G.forEach(g => { const d = day2date(g[0]), k = (d.getFullYear() - m0y) * 12 + d.getMonth() + 1 - m0m; if (k >= 0 && k < nM) { gm[k]++; pm[k].add(g[3]); pm[k].add(g[4]); } });
    const max = Math.max(...gm), W = 720, H = 200, bw = (W - 40) / nM;
    const bars = gm.map((v, k) => `<rect x="${30 + k * bw}" y="${H - 20 - (H - 40) * v / max}" width="${Math.max(1, bw - 2)}" height="${(H - 40) * v / max}" fill="${v ? "#c6ff3d" : "#333"}" opacity=".85"><title>${D.months[k]} · ${v}세트 · ${pm[k].size}명</title></rect>`).join("");
    const yl = D.months.map((m, k) => m.endsWith("-01") ? `<text x="${30 + k * bw}" y="${H - 4}">${m.slice(0, 4)}</text>` : "").join("");
    sv.innerHTML = `<div class="card"><h3>월별 세트 수<em>막대에 손을 올리면 상세</em></h3><svg class="chart" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}">${bars}${yl}</svg>
      ${D.meta.gaps.length ? `<div class="notice red" style="margin-top:12px">${D.meta.gaps.map(esc).join("<br>")}</div>` : ""}</div>
      <div class="grid c3">${["A", "D", "X"].map(s => { const L = P.filter(p => p.st === s && !p.off);
        return `<div class="card"><h3>${ST_KO[s]}<em>${L.length}명</em></h3><div class="stats" style="grid-template-columns:1fr 1fr">
        <div><b class="num">${L.filter(p => p.w + p.l > 0).length}</b><span>기록 보유</span></div><div><b class="num">${L.reduce((a, p) => a + p.w + p.l, 0).toLocaleString()}</b><span>참여 세트</span></div></div></div>`; }).join("")}</div>`;
  }
}

/* ---------- 맞대결 ---------- */
function picker(id, val) {
  return `<div class="pick"><input id="${id}" placeholder="선수 검색" value="${esc(val ? P[keyIdx[val]]?.id : "")}" autocomplete="off"><div class="dd" id="${id}dd"></div></div>`;
}
function bindPick(id, onPick) {
  const inp = $("#" + id), dd = $("#" + id + "dd");
  inp.oninput = () => { const q = inp.value.trim().toLowerCase(); if (!q) { dd.classList.remove("on"); return; }
    const L = P.filter(p => p.id.toLowerCase().includes(q) && p.w + p.l > 0).sort((a, b) => (b.st === "A") - (a.st === "A") || b.r - a.r).slice(0, 12);
    dd.innerHTML = L.map(p => `<div data-k="${esc(p.k)}">${tierB(p.tier)} ${esc(p.id)} ${raceB(p.race)} ${stB(p.st)}<span style="margin-left:auto" class="num">${r0(p.r)}</span></div>`).join("") || `<div>없음</div>`;
    dd.classList.add("on"); };
  dd.onclick = e => { const k = e.target.closest("[data-k]")?.dataset.k; if (k) { dd.classList.remove("on"); onPick(k); } };
}
function viewVs([a, b] = []) {
  app.onclick = null;
  app.innerHTML = `<div class="h"><h2><small>두 선수의 상대 전적 · 현재 레이팅 기준 예상 승률</small>Head to Head</h2></div>
    <div class="vsbox"><div class="side">${picker("pa", a)}</div><div class="x">VS</div><div class="side">${picker("pb", b)}</div></div><div id="vr"></div>`;
  bindPick("pa", k => location.hash = `#/vs/${encodeURIComponent(k)}/${encodeURIComponent(b || "")}`);
  bindPick("pb", k => location.hash = `#/vs/${encodeURIComponent(a || "")}/${encodeURIComponent(k)}`);
  const ia = keyIdx[a], ib = keyIdx[b];
  if (ia == null || ib == null) { $("#vr").innerHTML = `<div class="empty">두 선수를 고르세요</div>`; return; }
  const A = P[ia], B = P[ib];
  const js = byP[ia].filter(j => G[j][3] === ib || G[j][4] === ib);
  const aw = js.filter(j => G[j][3] === ia).length, bw = js.length - aw;
  const e = expect(A.r, B.r);
  const maps = agg(js, ia, g => g[2] >= 0 ? g[2] : null).sort((x, y) => y.n - x.n);
  $("#vr").innerHTML = `<div class="score"><b class="num ${aw > bw ? "lead" : ""}">${aw}</b><span>${js.length} SETS</span><b class="num ${bw > aw ? "lead" : ""}">${bw}</b></div>
    <div class="card" style="margin-top:12px"><h3>현재 예상 승률<em>ELO ${r0(A.r)} vs ${r0(B.r)}</em></h3>
      <div class="track" style="height:14px;--c:var(--acc);background:#2b3038"><i style="width:${e * 100}%"></i></div>
      <div style="display:flex;justify-content:space-between;margin-top:6px" class="num"><b>${esc(A.id)} ${(e * 100).toFixed(1)}%</b><b>${((1 - e) * 100).toFixed(1)}% ${esc(B.id)}</b></div></div>
    <div class="grid c2">
      <div class="card"><h3>맵별<em>${esc(A.id)} 기준</em></h3><div class="mu">${muRows(maps.map(o => ({ ...o, k: o.k })), k => esc((D.maps[k] || "").slice(0, 6)))}</div></div>
      <div class="card"><h3>기록</h3><div class="scroll"><table class="mini"><tr><th>날짜</th><th>리그</th><th>승자</th><th>맵</th></tr>
        ${js.slice().reverse().map(j => { const g = G[j]; return `<tr><td class="num">${fmtD(g[0])}</td><td>${esc(D.leagues[g[1]].name)}</td><td><b style="color:${g[3] === ia ? "var(--acc)" : "var(--ink)"}">${esc(P[g[3]].id)}</b></td><td style="color:var(--ink3)">${esc(D.maps[g[2]] || "")}</td></tr>`; }).join("") || `<tr><td colspan=4 class="empty">맞대결 기록 없음</td></tr>`}
      </table></div></div></div>`;
}

/* ---------- 래더 ---------- */
function viewLadder() {
  app.onclick = null;
  const L = P.filter(p => p.lad && !p.off).sort((a, b) => (b.lad.rating || 0) - (a.lad.rating || 0));
  const lu = D.meta.sources.find(s => s.name === "ladder");
  app.innerHTML = `<div class="h"><h2><small>cwal.gg 래더 점수 × 클랜 ELO · 계정 ${L.length}개 연결</small>Ladder</h2><div class="aside">래더 갱신 ${esc(lu?.updated || "—")}</div></div>
    <div class="panel scroll"><table class="tbl"><thead><tr><th>#</th><th></th><th>선수</th><th class="r">래더</th><th class="r hide-m">전체순위</th><th class="r hide-m">시즌</th><th class="r">클랜 ELO</th></tr></thead><tbody>
    ${L.map((p, n) => `<tr data-k="${esc(p.k)}"><td class="rk num ${n < 3 ? "t3" : ""}">${n + 1}</td><td class="stripe" style="--tc:${tc(p.tier)}"></td>
      <td class="nm">${esc(p.id)} ${raceB(p.lad.race || p.race)}<span class="sub">${esc(p.lad.toon)}</span></td>
      <td class="r rt num">${p.lad.rating || "—"}</td><td class="r hide-m num">${p.lad.standing ? "#" + p.lad.standing.toLocaleString() : "—"}</td>
      <td class="r hide-m num">${p.lad.w}-${p.lad.l}</td><td class="r num" style="font-size:16px">${r0(p.r)}${rankAll[p.i] ? `<span style="color:var(--ink3);font-size:11px"> #${rankAll[p.i]}</span>` : ""}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="legend">기존 kS 클랜 래더(lupi20000.github.io/ks-clan-ladder)의 매일 밤 수집 결과를 그대로 합칩니다. 등록되지 않은 계정은 래더 페이지의 '직접 등록'으로 추가하세요.</p>`;
  $(".tbl tbody").onclick = e => { const k = e.target.closest("tr[data-k]")?.dataset.k; if (k) location.hash = `#/p/${encodeURIComponent(k)}`; };
}

/* ---------- 관리자: 등급조정 ---------- */
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };
async function sha256(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
function viewAdmin() {
  app.onclick = null;
  if (D.meta.adminHash && sessionStorage.getItem("ksAdm") !== D.meta.adminHash) {
    app.innerHTML = `<div class="gate"><div class="kicker">ADMIN</div><h2 style="font:800 34px var(--disp);margin:8px 0">관리자 모드</h2>
      <input id="pw" type="password" placeholder="••••••"><button class="btn pri" id="go" style="width:100%;justify-content:center">입장</button><p id="msg" style="color:var(--down);font-size:12px"></p></div>`;
    const go = async () => { const h = await sha256($("#pw").value); if (h === D.meta.adminHash) { sessionStorage.setItem("ksAdm", h); viewAdmin(); } else $("#msg").textContent = "암호가 다릅니다"; };
    $("#go").onclick = go; $("#pw").onkeydown = e => e.key === "Enter" && go(); return;
  }
  const S = Object.assign({}, D.promo, { name: "4-5차" }, LS.get("ksAdmS", {}));
  const OV = LS.get("ksAdmOv", {});
  app.innerHTML = `${D.meta.adminHash ? "" : `<div class="notice red"><b>!</b><div>관리자 암호가 설정되지 않은 빌드입니다. 공개 배포 전 <code>KS_ADMIN_HASH</code>를 넣고 다시 빌드하세요. (지금은 누구나 이 화면을 볼 수 있음 — 데이터를 바꾸진 못합니다)</div></div>`}
    <div class="h"><h2><small>후보 자동 산출 → 관리자 확정 → 공지문·CSV 출력</small>등급조정</h2></div>
    <div class="card"><div class="form-grid">
      <div class="fld"><label>차수</label><input id="f_name" value="${esc(S.name)}"></div>
      <div class="fld"><label>방식</label><select id="f_method"><option value="boundary">경계선(레이팅)</option><option value="quota">정원(티어 내 순위)</option></select></div>
      <div class="fld"><label>평가 시작일</label><input id="f_ws" type="date" value="${esc(S.window_start)}"></div>
      <div class="fld"><label>최소 경기(기간)</label><input id="f_min" type="number" min="0" value="${S.min_window_games}"></div>
      <div class="fld"><label id="l_m">경계 여유(점)</label><input id="f_margin" type="number" value="${S.margin}"></div>
      <div class="fld"><label id="l_q">티어당 최대(%)</label><input id="f_quota" type="number" min="0" value="${S.quota_pct}"></div>
      <div class="fld" id="w_qn"><label>정원(명)</label><input id="f_qn" type="number" min="0" value="${S.quota_n}"></div>
    </div>
    <div class="btns"><button class="btn pri" id="calc">다시 계산</button><button class="btn" id="reset">수동 지정 초기화</button>
      <span style="color:var(--ink3);font-size:12px;align-self:center">직전 조정: ${esc(D.adjustments.at(-1).name)} (${esc(D.adjustments.at(-1).date)}) · 설정과 수동 지정은 이 브라우저에 저장됩니다</span></div></div>
    <div id="res"></div>
    <div class="h"><h2><small>카페 글에 그대로 붙여넣기</small>Output</h2></div>
    <div class="seg" id="oseg"><button class="on" data-o="up">승격자 발표</button><button data-o="dn">강등자 발표</button><button data-o="rank">각 티어별 순위</button></div>
    <textarea class="out" id="out" readonly></textarea>
    <div class="btns"><button class="btn pri" id="copy">복사</button><button class="btn" id="csv">CSV 저장</button><button class="btn" id="json">결정 JSON 저장</button></div>
    <div class="h"><h2><small>수집 상태</small>Data Health</h2></div>
    <div class="panel scroll"><table class="tbl"><thead><tr><th>출처</th><th>상태</th><th class="r">행</th></tr></thead><tbody>
      ${D.meta.sources.map(s => `<tr style="cursor:default"><td>${esc(s.label)}</td><td style="color:${/불가|실패/.test(s.status) ? "var(--down)" : "var(--ink2)"}">${esc(s.status)}</td><td class="r num">${s.rows}</td></tr>`).join("")}</tbody></table></div>`;
  $("#f_method").value = S.method;
  let outMode = "up", result = null;
  const read = () => ({ name: $("#f_name").value.trim(), method: $("#f_method").value, window_start: $("#f_ws").value, min_window_games: +$("#f_min").value,
    margin: +$("#f_margin").value, quota_pct: +$("#f_quota").value, quota_n: +$("#f_qn").value });
  const sync = () => { const q = $("#f_method").value === "quota"; $("#w_qn").style.display = q ? "" : "none"; $("#l_m").parentElement.style.display = q ? "none" : ""; $("#l_q").parentElement.style.display = q ? "none" : ""; };
  const run = () => { const s = read(); LS.set("ksAdmS", s); sync(); result = promote(s, LS.get("ksAdmOv", {})); drawRes(s); drawOut(s); };
  const drawRes = s => {
    $("#res").innerHTML = T.map((t, ti) => { const L = result.rows.filter(r => r.ti === ti); if (!L.length) return "";
      const up = L.filter(r => r.dec === "up").length, dn = L.filter(r => r.dec === "down").length;
      const b1 = result.bound[ti - 1], b2 = result.bound[ti];
      return `<section class="tier-block" style="--tc:${tc(t)}"><header><b>${t}</b><span>${L.length}명${b1 != null ? ` · 승격선 ${r0(b1 + (s.method === "boundary" ? s.margin : 0))}` : ""}${b2 != null ? ` · 강등선 ${r0(b2 - (s.method === "boundary" ? s.margin : 0))}` : ""}</span>
        <span class="cnt"><span style="color:var(--up)">▲${up}</span><span style="color:var(--down)">▼${dn}</span></span></header>
        <div class="scroll"><table class="mini"><tr><th>#</th><th>선수</th><th class="r">ELO</th><th class="r">기간</th><th>판정</th><th>근거</th><th>수동</th></tr>
        ${L.map(r => `<tr><td class="num">${r.tr}</td><td><a href="${pLink(r.i)}"><b>${esc(P[r.i].id)}</b></a> ${raceB(P[r.i].race)}</td><td class="r num" style="font-size:14px">${r0(P[r.i].r)}</td>
          <td class="r num">${r.wg}전 ${r.ww}-${r.wg - r.ww}</td>
          <td>${r.dec === "up" ? `<span class="dec up">▲ ${T[ti - 1]}</span>` : r.dec === "down" ? `<span class="dec dn">▼ ${T[ti + 1]}</span>` : `<span class="dec hold">유지</span>`}</td>
          <td style="color:var(--ink3);font-size:11.5px">${esc(r.why)}</td>
          <td><select class="ovr" data-k="${esc(P[r.i].k)}">${[["", "자동"], ["up", "승격"], ["hold", "유지"], ["down", "강등"]].map(([v, l]) => `<option value="${v}" ${OVc()[P[r.i].k] === v ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`).join("")}
        </table></div></section>`; }).join("");
    $("#res").onchange = e => { const k = e.target.dataset.k; if (!k) return; const o = LS.get("ksAdmOv", {}); if (e.target.value) o[k] = e.target.value; else delete o[k]; LS.set("ksAdmOv", o); run(); };
  };
  const OVc = () => LS.get("ksAdmOv", {});
  const drawOut = s => {
    const today = D.meta.today;
    const head = `[kS] ${s.name} 등급조정`;
    const basis = `기준: ${today} 클랜 ELO · 평가기간 ${s.window_start} ~ · 기간 내 최소 ${s.min_window_games}경기 · 방식 ${s.method === "boundary" ? `경계선(여유 ${s.margin}점, 티어당 최대 ${s.quota_pct}%)` : `정원(티어당 ${s.quota_n}명)`}`;
    let txt = "";
    if (outMode === "up" || outMode === "dn") {
      const dir = outMode === "up" ? "up" : "down";
      txt = `${head} ${dir === "up" ? "승격자" : "강등자"} 발표\n${basis}\n`;
      T.forEach((t, ti) => { const L = result.rows.filter(r => r.ti === ti && r.dec === dir); if (!L.length) return;
        txt += `\n■ ${t} → ${dir === "up" ? T[ti - 1] : T[ti + 1]} (${L.length}명)\n` + L.map(r => ` - ${P[r.i].id} (${P[r.i].race}) ELO ${r0(P[r.i].r)} · ${t} ${r.tr}위 · 기간 ${r.ww}승 ${r.wg - r.ww}패`).join("\n") + "\n"; });
      if (!result.rows.some(r => r.dec === dir)) txt += "\n해당자 없음\n";
    } else {
      txt = `${head} 각 티어별 순위\n${basis}\n`;
      T.forEach((t, ti) => { const L = result.rows.filter(r => r.ti === ti); if (!L.length) return;
        txt += `\n■ ${t}\n` + L.map(r => ` ${String(r.tr).padStart(2)}. ${P[r.i].id} ${r0(P[r.i].r)} (${r.wg}전)${r.dec === "up" ? " ▲" : r.dec === "down" ? " ▼" : ""}`).join("\n") + "\n"; });
    }
    $("#out").value = txt;
  };
  $("#oseg").onclick = e => { const o = e.target.dataset.o; if (!o) return; outMode = o; [...$("#oseg").children].forEach(b => b.classList.toggle("on", b.dataset.o === o)); drawOut(read()); };
  $("#calc").onclick = run;
  ["f_method", "f_ws", "f_min", "f_margin", "f_quota", "f_qn"].forEach(id => $("#" + id).onchange = run);
  $("#reset").onclick = () => { LS.set("ksAdmOv", {}); run(); };
  $("#copy").onclick = async () => { try { await navigator.clipboard.writeText($("#out").value); $("#copy").textContent = "복사됨"; } catch { $("#out").select(); document.execCommand("copy"); } setTimeout(() => $("#copy").textContent = "복사", 1200); };
  const dl = (name, body, type) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name; a.click(); };
  $("#csv").onclick = () => dl(`등급조정_${read().name}.csv`, "﻿티어,티어내순위,아이디,종족,ELO,기간경기,기간승,판정,근거,수동\n" +
    result.rows.map(r => [T[r.ti], r.tr, P[r.i].id, P[r.i].race, r0(P[r.i].r), r.wg, r.ww, { up: "승격", down: "강등", hold: "유지" }[r.dec], r.why, r.ov ? "Y" : ""].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
  $("#json").onclick = () => dl(`등급조정_${read().name}.json`, JSON.stringify({ settings: read(), built: D.meta.updated,
    decisions: result.rows.filter(r => r.dec !== "hold").map(r => ({ id: P[r.i].id, from: T[r.ti], to: T[r.dec === "up" ? r.ti - 1 : r.ti + 1], elo: r0(P[r.i].r), manual: !!r.ov })) }, null, 1), "application/json");
  run();
}
function promote(s, OV) {
  const wsd = dateDay(s.window_start || "2000-01-01");
  const rows = [];
  const pool = P.filter(p => p.st === "A" && !p.off && p.tier && T.includes(p.tier));
  const med = T.map(t => { const rs = ranked.filter(p => p.tier === t).map(p => p.r).sort((a, b) => a - b); return rs.length ? rs[Math.floor(rs.length / 2)] : null; });
  const bound = T.slice(0, -1).map((t, k) => (med[k] != null && med[k + 1] != null) ? (med[k] + med[k + 1]) / 2 : (D.seeds[T[k]] + D.seeds[T[k + 1]]) / 2);
  T.forEach((t, ti) => {
    const L = pool.filter(p => p.tier === t).sort((a, b) => b.r - a.r);
    const R = L.map((p, n) => { let wg = 0, ww = 0; for (const j of byP[p.i]) if (G[j][0] >= wsd) { wg++; if (G[j][3] === p.i) ww++; }
      return { i: p.i, ti, tr: n + 1, wg, ww, dec: "hold", why: "" }; });
    const enough = r => r.wg >= s.min_window_games;
    if (s.method === "quota") {
      const el = R.filter(enough);
      const ups = ti > 0 ? el.slice(0, s.quota_n) : [];
      const dns = ti < T.length - 1 ? el.slice().reverse().filter(r => !ups.includes(r)).slice(0, s.quota_n) : [];
      ups.forEach(r => { r.dec = "up"; r.why = `티어 내 상위 ${s.quota_n}명`; });
      dns.forEach(r => { r.dec = "down"; r.why = `티어 내 하위 ${s.quota_n}명`; });
      R.filter(r => !enough(r)).forEach(r => r.why = `경기 부족(${r.wg}/${s.min_window_games})`);
    } else {
      const cap = Math.max(1, Math.ceil(L.length * s.quota_pct / 100));
      const upC = [], dnC = [];
      R.forEach(r => { const v = P[r.i].r;
        if (ti > 0 && v >= bound[ti - 1] + s.margin) (enough(r) ? upC : (r.why = `승격권이나 경기 부족(${r.wg}/${s.min_window_games})`, null))?.push(r);
        else if (ti < T.length - 1 && v <= bound[ti] - s.margin) (enough(r) ? dnC : (r.why = `강등권이나 경기 부족(${r.wg}/${s.min_window_games})`, null))?.push(r); });
      upC.forEach((r, n) => { if (n < cap) { r.dec = "up"; r.why = `상위 경계 ${r0(bound[ti - 1])}+${s.margin} 초과 (+${r0(P[r.i].r - bound[ti - 1])})`; } else r.why = "승격권이나 정원 초과"; });
      dnC.slice().reverse().forEach((r, n) => { if (n < cap) { r.dec = "down"; r.why = `하위 경계 ${r0(bound[ti])}−${s.margin} 미달 (${r0(P[r.i].r - bound[ti])})`; } else r.why = "강등권이나 정원 초과"; });
    }
    R.forEach(r => { const o = OV[P[r.i].k]; if (o) { if ((o === "up" && ti === 0) || (o === "down" && ti === T.length - 1)) return; r.dec = o; r.ov = true; r.why = "관리자 지정"; } });
    rows.push(...R);
  });
  return { rows, bound };
}

/* ---------- 기준 ---------- */
function viewAbout() {
  app.onclick = null;
  const lw = D.leagues.slice().sort((a, b) => b.w - a.w);
  app.innerHTML = `<div class="h"><h2><small>이 보드가 순위를 매기는 방법</small>How it works</h2></div><div class="prose">
  <h3>1. 무엇을 모으나</h3><p>ELO V5 시트(2022.09~2025.07), KPL S10 경기결과, 클랜멤버및티어표(현재 명단·휴면·부종), kS 클랜 래더(cwal.gg)를 매일 모아 한 장의 세트 기록으로 합칩니다. 시트에는 쓰지 않고 읽기만 합니다.</p>
  <h3>2. 레이팅</h3><p>모든 세트를 한꺼번에 놓고 <b>가장 그럴듯한 실력값</b>을 찾는 방식(브래들리-테리, ELO와 같은 400점 척도)입니다. A가 B를 이길 확률 = <code>1 / (1 + 10^((B−A)/400))</code>. 경기 순서에 따라 점수가 흔들리는 일반 ELO와 달리, 같은 기록이면 언제 계산해도 같은 값이 나옵니다.</p>
  <p><b>오래된 경기일수록 가볍게</b>: 가중치 = <code>0.5^(경과일/${D.meta.halfLife})</code> — ${D.meta.halfLife}일 지난 경기는 절반, 2년이면 1/4. 재가입자도 예전 기록이 그대로 남아 이어서 계산됩니다.</p>
  <p><b>대회 가중치</b>: 큰 무대일수록 더 무겁게 (기존 V5 가중치의 제곱근 적용).</p>
  <table><tr><th>리그</th><th>V5 가중치</th><th>적용</th></tr>${lw.map(l => `<tr><td>${esc(l.name)}</td><td>×${l.w}</td><td>×${Math.sqrt(l.w).toFixed(2)}</td></tr>`).join("")}</table>
  <p><b>출발점(시드)</b>: 현재 티어 기준 Black ${D.seeds.Black} · Gold ${D.seeds.Gold} · Yellow ${D.seeds.Yellow} · Red ${D.seeds.Red} · Violet ${D.seeds.Violet} · Blue ${D.seeds.Blue} · Sky ${D.seeds.Sky} · White ${D.seeds.White}. 시드는 가상 ${D.meta.prior}경기로만 작용해서, 경기가 쌓이면 실제 성적이 이깁니다.</p>
  <p><b>정식 순위</b>: 통산 ${D.meta.rankedMinGames || 5}세트 이상 + 감쇠 반영 유효경기 ${D.meta.rankedMinEff} 이상. 미달은 '잠정'(순위표에는 보이지만 번호와 등급조정에서 빠짐).</p>
  <h3>3. 신원</h3><p>[kS] 표기·대소문자는 무시합니다. 닉네임 변경(V5 DB 특이사항, 래더 명단 old)은 같은 사람으로 합칩니다. 주종족이 아닌 종족으로 치른 세트는 <b>부종 프로필</b>로 따로 계산합니다. 현재 명단에 있으면 활동, '휴면'이면 휴면, 명단에 없으면 탈퇴·외부로 표시하되 기록은 지우지 않습니다.</p>
  <h3>4. 등급조정</h3><p>관리 탭에서 후보를 자동으로 뽑고 관리자가 확정합니다. <b>경계선 방식</b>: 이웃한 두 티어의 레이팅 중앙값 사이를 경계로 삼아, 경계+여유를 넘으면 승격·경계−여유에 못 미치면 강등 후보. 평가기간 최소 경기 미달은 보류, 티어당 최대 비율로 한 번에 너무 많이 움직이지 않게 막습니다. <b>정원 방식</b>: 티어마다 상위 N명 승격, 하위 N명 강등. 한 번에 한 단계만.</p>
  <h3>5. 데이터 상태</h3><ul>${D.meta.sources.map(s => `<li>${esc(s.label)} — ${esc(s.status)} (${s.rows}행)</li>`).join("")}</ul>
  ${D.meta.gaps.length ? `<p style="color:#ffb3c0">${D.meta.gaps.map(esc).join("<br>")}</p>` : ""}
  </div>`;
}

/* ---------- 시작 ---------- */
fetch("data.json", { cache: "no-cache" }).then(r => r.json()).then(d => { prep(d); route(); })
  .catch(e => { app.innerHTML = `<div class="empty">데이터를 불러오지 못했습니다 (${esc(e.message)})</div>`; });
})();
