/* kS ELO — 클라이언트 (프레임워크 없음) */
(() => {
"use strict";
const API = "https://ks-elo-api.afterworkting.workers.dev";
// 래더 등록요청·래더 계정 관리도 이 서버로 (매일 아침 갱신 때 반영)
const PACK_KEY = "kS-ELO::clan-rating";

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RN = ["P", "T", "Z"], RACE_KO = { P: "프로토스", T: "테란", Z: "저그" };
const ST_KO = { A: "활동", D: "휴면", X: "탈퇴·외부" };
const TEAM_COLORS = ["#ff6b4a", "#4aa3ff", "#f2c14e", "#a27aff", "#3fd6a3", "#ff5fa2", "#7fd1ff", "#c7f05a"];
let D, P, G, T, byP, EPOCH, rankAll = {}, rankTier = {}, ranked = [], keyIdx = {}, K = null, teamColor = {};

/* ---------- 복제 방지 (가벼운 장치) ---------- */
const editable = t => t && t.closest && t.closest("input,textarea,select,.selectable");
document.addEventListener("contextmenu", e => { if (!editable(e.target)) e.preventDefault(); });
["copy", "cut"].forEach(ev => document.addEventListener(ev, e => { if (!editable(e.target)) e.preventDefault(); }));
document.addEventListener("dragstart", e => e.preventDefault());
document.addEventListener("keydown", e => {
  const k = (e.key || "").toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (e.key === "F12" || (mod && ["s", "u", "p"].includes(k)) || (mod && e.shiftKey && ["i", "j", "c"].includes(k))) e.preventDefault();
});
try { console.log("%ckS CLAN ELO", "font:900 28px sans-serif;color:#e2a24a", "\n이 사이트의 디자인·코드·데이터는 kS 클랜 소유입니다. 무단 복제·AI 학습·재현을 금지합니다."); } catch { }

/* ---------- 흰색 / 어두운 화면 ---------- */
$("#theme").addEventListener("click", () => {
  const light = document.documentElement.getAttribute("data-ks") !== "light";  // 지금 어두우면 → 흰색으로
  if (light) document.documentElement.setAttribute("data-ks", "light"); else document.documentElement.removeAttribute("data-ks");
  try { localStorage.setItem("ksTheme", light ? "light" : "dark"); } catch { }
});

/* ---------- 첫 접속 인트로 ---------- */
(function intro() {
  let seen = false;
  try { seen = sessionStorage.getItem("ksIntro") === "1"; sessionStorage.setItem("ksIntro", "1"); } catch { }
  if (seen || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const el = document.createElement("div");
  el.className = "intro";
  el.innerHTML = `<div class="bars"><i></i><i></i><i></i></div><div class="core"><div class="glyph">kS</div><div class="word">CLAN ELO</div><div class="line"></div><div class="sub">STARCRAFT : REMASTERED</div></div>`;
  document.body.appendChild(el);
  const done = () => el.remove();
  el.addEventListener("click", done);
  setTimeout(done, 4000);
})();

/* ---------- 공통 ---------- */
const tc = t => (t && T.includes(t)) ? `var(--${t})` : "var(--none)";
const tierB = t => t ? `<span class="tier ${esc(t)}" style="--tc:${tc(t)}">${esc(t)}</span>` : `<span class="tier none">미배정</span>`;
const raceB = r => r && RACE_KO[r] ? `<span class="race" style="--rc:var(--${r})" title="${RACE_KO[r]}">${r}</span>` : "";
const stB = s => s === "A" ? "" : `<span class="st ${s}">${ST_KO[s]}</span>`;
const day2date = d => new Date(EPOCH.getTime() + d * 864e5);
const fmtD = d => { const x = day2date(d); return `${x.getFullYear()}.${String(x.getMonth() + 1).padStart(2, "0")}.${String(x.getDate()).padStart(2, "0")}`; };
const dateDay = s => Math.round((new Date(s + "T00:00:00Z") - EPOCH) / 864e5);
const pct = (w, n) => n ? (100 * w / n) : NaN;
const pctS = (w, n) => n ? (100 * w / n).toFixed(1) + "%" : "—";
const r0 = x => Math.round(x);
const isRanked = p => p.eff >= D.meta.rankedMinEff && p.w + p.l >= D.meta.rankedMinGames;
const pLink = i => `#/p/${encodeURIComponent(P[i].k)}`;
const pName = (id, k) => k && keyIdx[k] != null ? `<a href="${pLink(keyIdx[k])}"><b>${esc(id)}</b></a>` : `<b>${esc(id)}</b>`;
const delta = p => {
  const m = D.months.length - 2; if (!p.h.length) return null;
  const prev = p.h.filter(x => x[0] <= m).pop(); if (!prev) return null;
  return p.r - prev[1];
};
const dl = v => v == null ? `<span class="dl z">NEW</span>` : Math.abs(v) < 0.5 ? `<span class="dl z">—</span>` :
  `<span class="dl ${v > 0 ? "up" : "dn"}">${v > 0 ? "▲" : "▼"}${Math.abs(r0(v))}</span>`;
const isoD = d => day2date(d).toISOString().slice(0, 10);
const sig = g => `${isoD(g[0])}|${D.leagues[g[1]].name}|${P[g[3]].k}|${P[g[4]].k}|${g[2] >= 0 ? D.maps[g[2]] : ""}#${g[10] || 0}`;
const mapN = g => g[2] >= 0 && D.maps[g[2]] ? D.maps[g[2]] : "확인불가";
const ME = { get: () => { try { return localStorage.getItem("ksMe") || ""; } catch { return ""; } },
  set: k => { try { k ? localStorage.setItem("ksMe", k) : localStorage.removeItem("ksMe"); } catch { } } };
const monthOf = d => { const x = day2date(d); return D.months.indexOf(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`); };
const ratingAt = (i, m) => { const h = P[i].h; let r = null; for (const x of h) { if (x[0] <= m) r = x[1]; else break; } return r; };
const expect = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
const tmC = n => "var(--brass2)";
const teamB = n => n ? `<span class="team" style="--tm:${tmC(n)}">${esc(n)}</span>` : "";
const enter = () => { app.classList.remove("enter"); void app.offsetWidth; app.classList.add("enter"); };

/* ---------- 데이터 준비 ---------- */
function prep(data) {
  D = data; P = D.players; G = D.g; T = D.tiers; K = D.kpl || null;
  EPOCH = new Date(D.meta.epoch + "T00:00:00Z");
  byP = P.map(() => []);
  G.forEach((g, j) => { byP[g[3]].push(j); byP[g[4]].push(j); });
  P.forEach((p, i) => { p.i = i; keyIdx[p.k] = i; });
  ranked = P.filter(p => p.st === "A" && !p.off && isRanked(p)).sort((a, b) => b.r - a.r);
  ranked.forEach((p, n) => rankAll[p.i] = n + 1);
  T.forEach(t => ranked.filter(p => p.tier === t).forEach((p, n) => rankTier[p.i] = n + 1));
  if (K) (K.teams || K.standings || []).forEach((t, n) => teamColor[t.name || t.team] = TEAM_COLORS[n % TEAM_COLORS.length]);
  $("#stamp").innerHTML = `마지막 갱신<b>${esc(D.meta.updated)}</b>`;
  $("#foot").innerHTML = `kS CLAN ELO · 세트 ${G.length.toLocaleString()} · 선수 ${P.filter(p => !p.off).length.toLocaleString()} · 시간감쇠 반감기 ${D.meta.halfLife}일 · <a href="#/about">계산 기준</a> · <a href="#/admin">운영진</a>
    <span class="cr">© kS CLAN. 이 사이트의 디자인·코드·데이터의 무단 복제, AI 학습·재현을 금지합니다.</span>`;
  const tk = tickerItems();
  if (tk) $("#ticker").innerHTML = `<span class="tag">LIVE 결과</span><div class="rail"><div class="run">${tk}${tk}</div></div>`;
}

/* ---------- 라우터 ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [r, ...rest] = h.split("/");
  const name = r || "rank";
  const tab = name === "p" ? "rank" : name;
  document.querySelectorAll("[data-r]").forEach(a => a.classList.toggle("on", a.dataset.r === tab));
  window.scrollTo(0, 0);
  app.style.removeProperty("--tc");
  app.onclick = null;
  ({ rank: viewRank, p: () => viewPlayer(decodeURIComponent(rest.join("/"))), kpl: () => viewKPL(rest.map(decodeURIComponent)),
     stats: () => viewStats(rest[0]), vs: () => viewVs(rest.map(decodeURIComponent)), ladder: () => viewLadder(decodeURIComponent(rest.join("/"))),
     admin: () => viewAdmin(rest[0]), about: viewAbout }[name] || viewRank)();
  enter();
}
window.addEventListener("hashchange", route);

/* ---------- 랭킹 ---------- */
const RS = { tier: "all", race: "all", st: "A", q: "", sort: "r", dir: -1, limit: 60 };
const TROPHY = `<svg class="trophy" viewBox="0 0 120 140" aria-hidden="true"><defs>
  <linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".35" stop-color="#f3c654"/><stop offset=".7" stop-color="#c9871c"/><stop offset="1" stop-color="#8a4d0e"/></linearGradient>
  <linearGradient id="tg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9a93a"/><stop offset="1" stop-color="#7a3e0c"/></linearGradient>
  <linearGradient id="ts" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <clipPath id="tc"><path d="M30 10h60v28c0 22-13 38-30 40-17-2-30-18-30-40z"/></clipPath></defs>
  <path d="M30 18H14c0 20 8 30 22 32M90 18h16c0 20-8 30-22 32" fill="none" stroke="url(#tg2)" stroke-width="7" stroke-linecap="round"/>
  <path d="M30 10h60v28c0 22-13 38-30 40-17-2-30-18-30-40z" fill="url(#tg)"/>
  <g clip-path="url(#tc)"><rect class="shine" x="-60" y="0" width="34" height="90" fill="url(#ts)" transform="skewX(-20)"/></g>
  <path d="M60 22l5 10 11 1.5-8 7.6 2 11-10-5.3-10 5.3 2-11-8-7.6 11-1.5z" fill="#fff8dc" opacity=".9"/>
  <rect x="53" y="78" width="14" height="18" fill="url(#tg2)"/><path d="M40 96h40l6 14H34z" fill="url(#tg)"/>
  <rect x="30" y="110" width="60" height="16" rx="2" fill="url(#tg2)"/><rect x="44" y="114" width="32" height="7" rx="1" fill="#fff3c4" opacity=".55"/>
  <circle class="spark s1" cx="20" cy="70" r="2.2" fill="#fff3c4"/><circle class="spark s2" cx="104" cy="60" r="1.8" fill="#fff3c4"/><circle class="spark s3" cx="96" cy="10" r="2.4" fill="#fff3c4"/></svg>`;
function countUp(el) {
  const to = +el.dataset.to, t0 = performance.now(), dur = 1400;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = to; return; }
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function viewRank() {
  const top = ranked.slice(0, 3);
  const pod = top.map((p, n) => `
    <a class="pod ${n ? "" : "first"}" style="--tc:${tc(p.tier)}" href="${pLink(p.i)}">
      <div class="pos">${n + 1}</div>
      ${n ? "" : TROPHY}
      <div class="kicker">${n ? `${n + 1}위` : "클랜 1위"} · ${esc(p.tier || "미배정")} #${rankTier[p.i] || "–"}</div>
      <div class="who"><span class="nm">${esc(p.id)}</span> ${raceB(p.race)} ${tierB(p.tier)}</div>
      <div class="rt num"><span class="cu" data-to="${r0(p.r)}">${r0(p.r)}</span><small>ELO</small></div>
      <div class="sub"><span>${p.w}승 ${p.l}패</span><span>${pctS(p.w, p.w + p.l)}</span><span>${dl(delta(p))}</span></div>
    </a>`).join("");
  app.innerHTML = `
    <div class="h ptitle"><h2><small>현재 클랜원 · 전 리그 통합 · 최근 경기일수록 무겁게</small><span class="w1"><span class="gold">ELO</span></span> <span class="w2">Power</span> <span class="w3">Ranking</span></h2>
      <div class="aside"><b class="num gold">${ranked.length}</b>정식 순위 선수</div></div>
    ${meCard()}
    <div class="podium">${pod}</div>
    <div class="bar">
      <label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
        <input id="q" placeholder="아이디 검색" value="${esc(RS.q)}" autocomplete="off"></label>
      <select class="sel" id="st" aria-label="선수 범위">
        <option value="A">활동 클랜원</option><option value="D">휴면</option><option value="X">탈퇴·외부</option><option value="all">전체 DB</option>
      </select>
    </div>
    <div class="bar" style="margin-top:0">
      <div class="chips wrap" id="tchips">${["all", ...T].map(t => `<span class="chip ${RS.tier === t ? "on" : ""}" data-t="${t}" style="--tc:${tc(t)}">${t === "all" ? "전체 티어" : `<i></i>${t}`}</span>`).join("")}</div>
    </div>
    <div class="bar" style="margin-top:0">
      <div class="chips wrap" id="rchips">${["all", ...RN].map(r => `<span class="chip ${RS.race === r ? "on" : ""}" data-race="${r}">${r === "all" ? "전 종족" : RACE_KO[r]}</span>`).join("")}</div>
    </div>
    <div class="panel scroll"><table class="tbl" id="rt"></table></div>
    <button class="more" id="more">더 보기</button>`;
  $("#st").value = RS.st;
  $("#q").oninput = e => { RS.q = e.target.value; RS.limit = 60; drawRank(); };
  $("#st").onchange = e => { RS.st = e.target.value; RS.limit = 60; drawRank(); };
  $("#tchips").onclick = e => { const c = e.target.closest("[data-t]"); if (!c) return; RS.tier = c.dataset.t; RS.limit = 60; viewRank(); };
  $("#rchips").onclick = e => {
    const c = e.target.closest(".chip"); if (!c) return;
    RS.race = c.dataset.race;
    RS.limit = 60; viewRank();
  };
  $("#more").onclick = () => { RS.limit += 100; drawRank(); };
  app.onclick = e => { if (e.target.closest("[data-unpin]")) { e.preventDefault(); ME.set(""); viewRank(); } };
  drawRank();
  app.querySelectorAll(".cu").forEach(countUp);
}
function drawRank() {
  const q = RS.q.trim().toLowerCase();
  let L = P.filter(p => (RS.st === "all" || p.st === RS.st) && (isRanked(p) || q)
    && (RS.tier === "all" || p.tier === RS.tier) && (RS.race === "all" || p.race === RS.race)
    && (!q || p.id.toLowerCase().includes(q)) && (p.w + p.l > 0 || RS.st === "A"));
  const key = { r: p => p.r, n: p => p.w + p.l, wr: p => pct(p.w, p.w + p.l) || 0, last: p => p.last || "", lad: p => p.lad?.rating || 0, d: p => delta(p) ?? -999 }[RS.sort];
  L.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * RS.dir || b.r - a.r);
  const th = (k, t, cls = "") => `<th class="${cls} ${RS.sort === k ? "sorted" : ""}" data-s="${k}">${t}${RS.sort === k ? (RS.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  const rows = L.slice(0, RS.limit).map(p => {
    const rk = rankAll[p.i], n = p.w + p.l;
    return `<tr data-k="${esc(p.k)}">
      <td class="rk num ${rk && rk <= 3 ? "t3" : ""}">${rk || "–"}</td>
      <td class="stripe" style="--tc:${tc(p.tier)}"></td>
      <td class="nm">${esc(p.off ? p.id.replace(/\s*\((\w)부종\)$/, "") : p.id)}${p.off ? ` <span class="prov">부종 ${esc(p.race || "")}</span>` : ""} ${stB(p.st)} ${isRanked(p) ? "" : `<span class="prov">기록 부족</span>`}
        <span class="sub">${p.tier ? esc(p.tier) : "미배정"}${rankTier[p.i] ? ` #${rankTier[p.i]}` : ""} · ${RACE_KO[p.race] || "—"}</span></td>
      <td class="r rt num">${r0(p.r)}</td>
      <td class="r">${dl(delta(p))}</td>
      <td class="r hide-m num" style="font-size:16px">${p.w}-${p.l}</td>
      <td class="r hide-m"><span class="wr">${pctS(p.w, n)}<span class="b"><i style="width:${pct(p.w, n) || 0}%"></i></span></span></td>
      <td class="r hide-m num" style="color:var(--ink2);font-size:16px">${p.lad?.rating ? p.lad.rating : "—"}</td>
      <td class="r hide-m" style="color:var(--ink3);font-size:12px">${p.last ? p.last.replaceAll("-", ".") : "—"}</td></tr>`;
  }).join("");
  $("#rt").innerHTML = `<thead><tr><th class="r">#</th><th></th><th>선수</th>${th("r", "ELO", "r")}${th("d", "월간", "r")}${th("n", "전적", "r hide-m")}${th("wr", "승률", "r hide-m")}${th("lad", "래더", "r hide-m")}${th("last", "최근", "r hide-m")}</tr></thead>
    <tbody>${rows || `<tr class="static"><td colspan="9" class="empty">조건에 맞는 선수가 없습니다</td></tr>`}</tbody>`;
  $("#more").style.display = L.length > RS.limit ? "" : "none";
  $("#rt thead").onclick = e => { const s = e.target.closest("[data-s]")?.dataset.s; if (!s) return; RS.dir = RS.sort === s ? -RS.dir : -1; RS.sort = s; drawRank(); };
  $("#rt tbody").onclick = e => { const k = e.target.closest("tr[data-k]")?.dataset.k; if (k) location.hash = `#/p/${encodeURIComponent(k)}`; };
}

function meCard() {
  const i = keyIdx[ME.get()]; if (i == null) return "";
  const p = P[i], d = delta(p);
  return `<a class="mecard" href="${pLink(i)}" style="--tc:${tc(p.tier)}"><span class="mk">MY</span><b>${esc(p.id)}</b> ${raceB(p.race)} ${tierB(p.tier)}
    <span class="mv num">${r0(p.r)}</span><span class="mr">${rankAll[i] ? `클랜 #${rankAll[i]}` : "기록 부족"}${rankTier[i] ? ` · ${esc(p.tier)} #${rankTier[i]}` : ""}</span>${dl(d)}<span class="mx" data-unpin="1" title="고정 해제">×</span></a>`;
}
function hotData() {
  const up = ranked.map(p => ({ p, d: delta(p) })).filter(x => x.d != null && x.d > 0.5).sort((a, b) => b.d - a.d);
  const last = G.length ? G[G.length - 1][0] : 0, ups = [];
  for (let j = G.length - 1; j >= 0 && G[j][0] >= last - 60; j--) {
    const g = G[j], m = monthOf(g[0]) - 1, wr = ratingAt(g[3], m), lr = ratingAt(g[4], m);
    if (wr != null && lr != null && lr - wr >= 100) ups.push({ g, wr, lr, d: lr - wr });
  }
  ups.sort((a, b) => b.d - a.d);
  return { up, ups };
}
// 뉴스 자막: 최근 12세트 + 최근 급상승 3명 + 최근 큰 이변 5경기
function tickerItems() {
  const { up, ups } = hotData();
  const sets = G.slice(-12).reverse().map(g => `<span class="it"><span class="when">${fmtD(g[0]).slice(5)}</span><span class="lg">${esc(D.leagues[g[1]].name)}</span><span class="won">${esc(P[g[3]].id)}</span> 승 <span>(vs <b>${esc(P[g[4]].id)}</b>)</span></span>`);
  const rise = up.slice(0, 3).map(x => `<span class="it"><span class="ntag up">급상승</span><b>${esc(x.p.id)}</b> <span class="won">▲${r0(x.d)}</span> <span class="when">${r0(x.p.r)}점</span></span>`);
  const upset = ups.slice(0, 5).map(x => `<span class="it"><span class="ntag ups">이변</span><span class="won">${esc(P[x.g[3]].id)}</span><span class="when">${r0(x.wr)}</span> 승 <span>(vs <b>${esc(P[x.g[4]].id)}</b> <span class="when">${r0(x.lr)}</span>)</span></span>`);
  return [...sets, ...rise, ...upset].join("");
}
function risersAndUpsets() {
  const up = ranked.map(p => ({ p, d: delta(p) })).filter(x => x.d != null && x.d > 0.5).sort((a, b) => b.d - a.d).slice(0, 5);
  const last = G.length ? G[G.length - 1][0] : 0, ups = [];
  for (let j = G.length - 1; j >= 0 && G[j][0] >= last - 60; j--) {
    const g = G[j], m = monthOf(g[0]) - 1, wr = ratingAt(g[3], m), lr = ratingAt(g[4], m);
    if (wr != null && lr != null && lr - wr >= 100) ups.push({ g, wr, lr, d: lr - wr });
  }
  ups.sort((a, b) => b.d - a.d);
  if (!up.length && !ups.length) return "";
  return `<div class="grid c2 hot">
    ${up.length ? `<div class="card"><h3>이달의 급상승<em>지난달 말 대비 ELO</em></h3><div class="risers">${up.map((x, n) => `<a class="riser" href="${pLink(x.p.i)}" style="--tc:${tc(x.p.tier)}">
      <span class="rn num">${n + 1}</span><span class="rid"><b>${esc(x.p.id)}</b> ${raceB(x.p.race)}<i>${esc(x.p.tier || "")} · ${r0(x.p.r)}</i></span><span class="dl up num">▲${r0(x.d)}</span></a>`).join("")}</div></div>` : ""}
    ${ups.length ? `<div class="card"><h3>최근 이변<em>최근 60일 · 경기 당시 점수 차이 100점 이상</em></h3><div class="upsets">${ups.slice(0, 5).map(x => `<a class="upset" href="#/vs/${encodeURIComponent(P[x.g[3]].k)}/${encodeURIComponent(P[x.g[4]].k)}">
      <span class="ud num">+${r0(x.d)}</span><span class="ut"><b>${esc(P[x.g[3]].id)}</b> <i class="num">${r0(x.wr)}</i> 승 <span>vs ${esc(P[x.g[4]].id)} <i class="num">${r0(x.lr)}</i></span></span><span class="uw">${fmtD(x.g[0]).slice(5)} · ${esc(D.leagues[x.g[1]].name)}</span></a>`).join("")}</div></div>` : ""}
  </div>`;
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
function chart(lines, opts = {}) {
  const hs = lines.filter(h => h && h.length);
  if (!hs.length) return `<div class="empty">그래프를 그릴 기록이 없습니다</div>`;
  const W = Math.max(300, Math.min(780, (app.clientWidth || 720) - 40)), H = opts.h || (W < 500 ? 190 : 230), pl = 40, pr = 12, pt = 14, pb = 24;
  const m0 = Math.min(...hs.map(h => h[0][0])), m1 = Math.max(D.months.length - 1, ...hs.map(h => h[h.length - 1][0]));
  const vs = hs.flat().map(x => x[1]); let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = Math.max(30, (hi - lo) * .12); lo -= pad; hi += pad;
  const X = m => pl + (m1 === m0 ? (W - pl - pr) / 2 : (m - m0) / (m1 - m0) * (W - pl - pr));
  const Y = v => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
  const step = Math.ceil((hi - lo) / 4 / 50) * 50;
  let grid = "";
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
  let xl = "";
  D.months.forEach((mm, k) => { if (k >= m0 && k <= m1 && mm.endsWith("-01")) xl += `<text x="${X(k)}" y="${H - 6}" text-anchor="middle">${mm.slice(0, 4)}</text>`; });
  let adj = "";
  if (opts.adj !== false) D.adjustments.forEach(a => { const k = D.months.indexOf(a.date.slice(0, 7)); if (k >= m0 && k <= m1) adj += `<line class="adj" x1="${X(k)}" x2="${X(k)}" y1="${pt}" y2="${H - pb}"/>`; });
  const draw = (h, cls) => {
    const pts = h.map(x => `${X(x[0]).toFixed(1)},${Y(x[1]).toFixed(1)}`), last = h[h.length - 1];
    const area = cls ? "" : `<path class="ar" d="M${X(h[0][0])},${H - pb}L${pts.join("L")}L${X(last[0])},${H - pb}Z"/>`;
    return `${area}<polyline class="ln ${cls}" points="${pts.join(" ")}"/><circle class="dot ${cls}" cx="${X(last[0])}" cy="${Y(last[1])}" r="4"/>`;
  };
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="aspect-ratio:${W}/${H}">
    <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-opacity=".28"/><stop offset="1" stop-opacity="0"/></linearGradient></defs>
    <g class="grid">${grid}</g>${adj}${xl}${lines[0]?.length ? draw(lines[0], "") : ""}${lines[1]?.length ? draw(lines[1], "b") : ""}</svg>`;
}
function muRows(rows, labelFn, color) {
  return rows.map(o => `<div class="row"><span class="lbl">${labelFn(o.k)}</span>
    <div class="track" style="--c:${color ? color(o.k) : (o.n && o.w / o.n >= .5 ? "var(--brass)" : "var(--down)")}"><i style="width:${pct(o.w, o.n)}%"></i></div>
    <span class="v"><b>${pctS(o.w, o.n)}</b> ${o.w}-${o.l}</span></div>`).join("");
}
const kplRow = p => K?.ranking?.find(r => (r.k && r.k === p.k) || r.id?.toLowerCase() === p.id.toLowerCase());
const kplTeamOf = p => K?.teams?.find(t => t.members.some(m => (m.k && m.k === p.k) || m.id.toLowerCase() === p.id.toLowerCase()));
function viewPlayer(k) {
  const i = keyIdx[k];
  if (i == null) { app.innerHTML = `<div class="empty">선수를 찾을 수 없습니다</div>`; return; }
  const p = P[i], idxs = byP[i], n = p.w + p.l;
  const vsRace = agg(idxs, i, (g, win) => RN[win ? g[6] : g[5]] ?? null).sort((a, b) => RN.indexOf(a.k) - RN.indexOf(b.k));
  const byLg = agg(idxs, i, g => g[1]).sort((a, b) => b.n - a.n);
  const byMap = agg(idxs, i, g => g[2] >= 0 ? g[2] : null).sort((a, b) => b.n - a.n).slice(0, 10);
  const byOpp = agg(idxs, i, (g, win) => win ? g[4] : g[3]).sort((a, b) => b.n - a.n).slice(0, 10);
  const byYear = agg(idxs, i, g => day2date(g[0]).getFullYear()).sort((a, b) => a.k - b.k);
  const recent = idxs.slice(-15).reverse();
  const form = idxs.slice(-10).map(j => G[j][3] === i ? `<span class="res W">W</span>` : `<span class="res L">L</span>`).join("");
  const sibs = P.filter(q => q.base === p.base && q.k !== p.k);
  const peak = p.h.length ? Math.max(...p.h.map(x => x[1])) : null;
  const lad = p.lad, kr = kplRow(p), kt = kplTeamOf(p);
  app.style.setProperty("--tc", tc(p.tier));
  app.innerHTML = `<a class="back" onclick="history.length>1?history.back():location.hash='#/'">← 목록으로</a>
  <section class="hero">
    <div class="wm" aria-hidden="true">${esc(p.tier || "kS")}</div>
    <div>
      <div class="kicker">${p.off ? "부종 프로필" : "선수"} · 기록 ${p.first ? p.first.slice(0, 4) : "—"}–${p.last ? p.last.slice(0, 4) : "—"}</div>
      <div class="id">${esc(p.id)}</div>
      <div class="meta">${tierB(p.tier)} ${raceB(p.race)} <span class="st ${p.st}">${ST_KO[p.st]}</span> ${kt ? teamB(kt.name) : ""}
        ${isRanked(p) ? "" : `<span class="prov">잠정 — 유효경기 ${p.eff.toFixed(1)}</span>`}
        ${sibs.map(s => `<a class="chip" href="${pLink(s.i)}">${esc(s.id)}</a>`).join("")}</div>
      <div class="prow"><div class="form">${form}</div><button class="btn sm pin" id="pin">${ME.get() === p.k ? "★ 내 아이디로 고정됨" : "☆ 내 아이디로 고정"}</button></div>
    </div>
    <div class="big">
      <div class="kv acc"><b class="num">${r0(p.r)}</b><span>ELO</span></div>
      <div class="kv"><b class="num">${rankAll[i] ? "#" + rankAll[i] : "—"}</b><span>클랜 순위</span></div>
      <div class="kv"><b class="num">${rankTier[i] ? "#" + rankTier[i] : "—"}</b><span>${esc(p.tier || "티어")} 내</span></div>
    </div>
  </section>
  <div class="stats" style="margin-top:10px">
    <div class="fk" data-f="all"><b class="num">${p.w}-${p.l}</b><span>통산 전적 · 전체 경기 ›</span></div>
    <div><b class="num">${pctS(p.w, n)}</b><span>승률</span></div>
    <div><b class="num">${peak ?? "—"}</b><span>최고 레이팅(월말)</span></div>
    <div><b class="num">${dl(delta(p))}</b><span>지난달 대비</span></div>
  </div>
  ${kr ? `<div class="card hl" style="margin-top:10px"><h3>${esc(K.season)}<em>${kt ? esc(kt.name) : ""} · <a href="#/kpl">KPL 보기 →</a></em></h3>
    <div class="stats c6"><div><b class="num">${kr.apps}</b><span>출전</span></div><div><b class="num">${kr.w}-${kr.l}</b><span>전체</span></div>
    <div><b class="num">${kr.indW}-${kr.indL}</b><span>개인전</span></div><div><b class="num">${kr.aceW}-${kr.aceL}</b><span>에결</span></div>
    <div><b class="num">${kr.mvp}</b><span>MVP</span></div><div><b class="num">#${kr.rank}</b><span>KPL 개인순위</span></div></div></div>` : ""}
  <div class="grid c21">
    <div class="card"><h3>Rating Trend<em>월말 기준 · 점선 = 등급조정일</em></h3>${chart([p.h])}</div>
    <div class="card"><h3>vs Race<em>누르면 해당 경기</em></h3><div class="mu" data-fl="race">${muRows(vsRace, r => `vs ${r}`, r => `var(--${r})`) || `<div class="empty">—</div>`}</div>
      <h3 style="margin-top:18px">By Year</h3><div class="mu" data-fl="year">${muRows(byYear, y => y)}</div></div>
  </div>
  <div class="grid c3">
    <div class="card"><h3>리그별<em>누르면 해당 경기</em></h3><table class="mini"><tr><th>리그</th><th class="r">전적</th><th class="r">승률</th></tr>
      ${byLg.map(o => `<tr class="clk" data-f="lg:${o.k}"><td>${esc(D.leagues[o.k].name)}</td><td class="r num">${o.w}-${o.l}</td><td class="r num">${pctS(o.w, o.n)}</td></tr>`).join("")}</table></div>
    <div class="card"><h3>맵별<em>상위 10 · 누르면 해당 경기</em></h3><table class="mini"><tr><th>맵</th><th class="r">전적</th><th class="r">승률</th></tr>
      ${byMap.map(o => `<tr class="clk" data-f="map:${o.k}"><td>${esc(D.maps[o.k])}</td><td class="r num">${o.w}-${o.l}</td><td class="r num">${pctS(o.w, o.n)}</td></tr>`).join("") || `<tr><td colspan=3 class="empty">—</td></tr>`}</table></div>
    <div class="card"><h3>자주 만난 상대<em>누르면 맞대결</em></h3><table class="mini"><tr><th>상대</th><th class="r">전적</th><th class="r">ELO</th></tr>
      ${byOpp.map(o => `<tr class="clk" data-vs="${esc(P[o.k].k)}"><td>${esc(P[o.k].id)} ${raceB(P[o.k].race)}</td><td class="r num">${o.w}-${o.l}</td><td class="r num">${r0(P[o.k].r)}</td></tr>`).join("")}</table></div>
  </div>
  <div class="grid ${lad ? "c21" : ""}">
    <div class="card" id="glog"></div>
    ${lad ? `<div class="card"><h3>Ladder<em>cwal.gg</em></h3>
      <div class="stats" style="grid-template-columns:1fr 1fr">
        <div><b class="num">${lad.rating || "—"}</b><span>래더 점수${lad.est ? " (추정)" : ""}</span></div>
        <div><b class="num">${lad.standing ? "#" + lad.standing.toLocaleString() : "—"}</b><span>전체 순위</span></div>
        <div><b class="num">${lad.w}-${lad.l}</b><span>시즌 전적</span></div>
        <div><b class="num" style="font-size:18px">${esc(lad.toon)}</b><span>계정</span></div></div>
      <div class="mu" style="margin-top:12px">${muRows(Object.entries(lad.mu || {}).map(([k, v]) => ({ k, w: v[0], l: v[1], n: v[0] + v[1] })), x => x)}</div></div>` : ""}
  </div>
  <p style="color:var(--ink3);font-size:12px;margin-top:14px">기록 기간 ${p.first ? p.first.replaceAll("-", ".") : "—"} ~ ${p.last ? p.last.replaceAll("-", ".") : "—"} · 감쇠 유효경기 ${p.eff.toFixed(1)}</p>`;
  const rows = { race: vsRace, year: byYear };
  app.querySelectorAll(".mu[data-fl]").forEach(m => m.querySelectorAll(".row").forEach((r, n) => { r.classList.add("clk"); r.dataset.f = m.dataset.fl + ":" + rows[m.dataset.fl][n].k; }));
  // 경기 목록: 기본은 최근 15경기, 위 항목을 누르면 그 조건의 경기 전부
  const FL = {
    all: () => [() => true, "전체 경기"],
    race: v => [(g, win) => RN[win ? g[6] : g[5]] === v, `vs ${v}`],
    year: v => [g => day2date(g[0]).getFullYear() === +v, `${v}년`],
    lg: v => [g => g[1] === +v, D.leagues[+v]?.name || ""],
    map: v => [g => g[2] === +v, D.maps[+v] || ""],
  };
  const logTable = list => `<table class="mini">
      <tr><th></th><th>날짜</th><th>리그</th><th>상대</th><th>맵</th></tr>
      ${list.map(j => { const g = G[j], win = g[3] === i, o = win ? g[4] : g[3];
        return `<tr class="clk" data-vs="${esc(P[o].k)}"><td><span class="res ${win ? "W" : "L"}">${win ? "W" : "L"}</span></td><td class="num">${fmtD(g[0])}</td>
        <td>${esc(D.leagues[g[1]].name)}</td><td>${esc(P[o].id)} ${raceB(RN[win ? g[6] : g[5]])}</td><td style="color:var(--ink3)">${esc(mapN(g))}</td></tr>`; }).join("") || `<tr><td colspan=5 class="empty">경기가 없습니다</td></tr>`}
    </table>`;
  $("#glog").innerHTML = `<h3>최근 경기<em>${recent.length}경기</em></h3><div class="scroll">${logTable(recent)}</div>`;
  const goVs = v => location.hash = `#/vs/${encodeURIComponent(p.k)}/${encodeURIComponent(v)}`;
  app.onclick = e => {
    const f = e.target.closest("[data-f]");
    if (f) { // 그 자리에서 팝업으로 해당 경기 목록
      const [t, v] = f.dataset.f.split(":"), [ok, nm] = FL[t](v), list = idxs.filter(j => ok(G[j], G[j][3] === i)).reverse(), w = list.filter(j => G[j][3] === i).length;
      popup(`${esc(p.id)} · ${esc(nm)}`, `${list.length}경기 · ${w}승 ${list.length - w}패 · ${pctS(w, list.length)}`, logTable(list), goVs);
      return; }
    const v = e.target.closest("[data-vs]")?.dataset.vs; if (v) goVs(v); };
  $("#pin").onclick = () => { const on = ME.get() === p.k; ME.set(on ? "" : p.k); $("#pin").textContent = on ? "☆ 내 아이디로 고정" : "★ 내 아이디로 고정됨"; };
}

/* ---------- 팝업 (그 자리에서 열고 닫기) ---------- */
function popup(title, sub, body, onVs) {
  document.querySelector(".pop")?.remove();
  const el = document.createElement("div");
  el.className = "pop";
  el.innerHTML = `<div class="pbox" role="dialog" aria-modal="true"><div class="phd"><div><b>${title}</b><span>${sub}</span></div><button class="btn sm" data-x="1" aria-label="닫기">✕</button></div><div class="pbd">${body}</div></div>`;
  const close = () => { el.remove(); document.removeEventListener("keydown", key); window.removeEventListener("hashchange", close); document.body.classList.remove("noscroll"); };
  const key = e => { if (e.key === "Escape") close(); };
  el.onclick = e => { if (e.target === el || e.target.closest("[data-x]")) return close();
    const v = e.target.closest("[data-vs]")?.dataset.vs; if (v && onVs) { close(); onVs(v); } };
  document.addEventListener("keydown", key); window.addEventListener("hashchange", close);
  document.body.appendChild(el); document.body.classList.add("noscroll");
}

/* ---------- KPL ---------- */
function viewKPL([sub, arg] = []) {
  if (sub === "lg") return viewLive(+arg);
  if (!K) {
    app.innerHTML = `${lgTabs("kpl")}<div class="kpl-head"><div class="season">KPL <em>S10</em></div><div class="meta">KPL 시즌 데이터를 준비하고 있습니다. 다음 자동 갱신 때 채워집니다.</div><div class="wm">KPL</div></div>`;
    return;
  }
  if (sub === "team") return viewKPLTeam(arg);
  const M = K.matches || [], played = M.filter(m => m.played), next = M.filter(m => !m.played)[0];
  const sets = played.flatMap(m => m.sets || []);
  const RK = { sort: "rank", dir: 1 };
  app.innerHTML = `${lgTabs("kpl")}<div class="kpl-head"><div class="kicker" style="color:#ffb38a">kS CLAN PRO LEAGUE</div>
      <div class="season">${esc(K.season.replace(/S(\d+)$/, ""))}<em>${esc((K.season.match(/S\d+$/) || [""])[0])}</em></div>
      <div class="meta"><span>경기 <b>${played.length}</b> / ${M.length}</span><span>세트 <b>${sets.length}</b></span><span>팀 <b>${(K.standings || []).length}</b></span>
      ${next ? `<span>다음 경기 <b>${esc(next.date.slice(5).replace("-", "."))} ${esc(next.time || "")}</b> ${esc(next.home)} vs ${esc(next.away)}</span>` : ""}</div>
      <div class="wm">KPL</div></div>
    <div class="h3">팀 순위<em>시트 기준 · ${esc(K.updated || D.meta.updated)}</em></div>
    <div class="panel scroll"><table class="tbl stand"><thead><tr><th class="r">#</th><th>팀</th><th class="r">승</th><th class="r">패</th><th class="r">득실</th><th class="r hide-m">개인전</th><th class="r hide-m">에결</th><th class="r hide-m">팀 평균 ELO</th></tr></thead><tbody>
      ${(K.standings || []).map((s, n) => { const tm = K.teams?.find(t => t.name === s.team); const els = (tm?.members || []).map(m => m.k != null && keyIdx[m.k] != null ? P[keyIdx[m.k]].r : null).filter(Boolean);
        return `<tr class="${n === 0 ? "lead" : ""}" data-team="${esc(s.team)}"><td class="rk r">${s.rank}</td><td class="tm">${teamB(s.team)}</td><td class="r bigw">${s.w}</td><td class="r num" style="font-size:20px;color:var(--ink2)">${s.l}</td>
        <td class="r num" style="font-size:18px;color:${s.diff > 0 ? "var(--up)" : s.diff < 0 ? "var(--down)" : "var(--ink3)"}">${s.diff > 0 ? "+" : ""}${s.diff}</td>
        <td class="r hide-m num" style="font-size:16px">${s.setW}-${s.setL}</td><td class="r hide-m num" style="font-size:16px">${s.aceW}-${s.aceL}</td>
        <td class="r hide-m num" style="font-size:16px;color:var(--ink2)">${els.length ? r0(els.reduce((a, b) => a + b, 0) / els.length) : "—"}</td></tr>`; }).join("")}
    </tbody></table></div>
    <div class="h3">팀<em>누르면 팀원 분석</em></div>
    <div class="teams">${(K.teams || []).map(t => { const s = K.standings?.find(x => x.team === t.name);
      const cap = t.members.find(m => m.role === "팀장"), vice = t.members.find(m => m.role === "부팀장");
      const byT = T.map(tt => ({ tt, L: t.members.filter(m => m.tier === tt) })).concat([{ tt: "기타", L: t.members.filter(m => !T.includes(m.tier)) }]).filter(x => x.L.length);
      return `<div class="tcard"><a class="tlink" href="#/kpl/team/${encodeURIComponent(t.name)}"><div class="big">${s ? s.rank : ""}</div>
        <div class="tn">${esc(t.name)}</div><div class="rec">${s ? `<b>${s.w}</b>승 <b>${s.l}</b>패 · 세트 ${s.setW}-${s.setL}` : ""}</div></a>
        <div class="lead2"><span>팀장 <b>${esc(cap?.id || "—")}</b></span><span>부팀장 <b>${esc(vice?.id || "—")}</b></span></div>
        <button class="btn sm memb" type="button">팀원 ${t.members.length}명 보기</button>
        <div class="mems" hidden>${byT.map(x => `<div class="mt2"><span class="tier ${x.tt}" style="--tc:${tc(x.tt)}">${x.tt}</span><span>${x.L.map(m => m.k != null && keyIdx[m.k] != null ? `<a href="${pLink(keyIdx[m.k])}">${esc(m.id)}</a>` : esc(m.id)).join(" · ")}</span></div>`).join("")}</div></div>`; }).join("")}</div>
    <div class="h3">개인 순위<em>KPL 시트 전적랭킹</em></div>
    <div class="panel scroll"><table class="tbl" id="kr"></table></div>
    <button class="more" id="krm">더 보기</button>
    <div class="h3">경기 결과<em>최근 순 · 누르면 세트 결과</em></div>
    <div class="panel" id="km">${played.slice().reverse().map(matchRow).join("") || `<div class="empty">아직 치른 경기가 없습니다</div>`}</div>
    ${M.some(m => !m.played) ? `<div class="h3">남은 일정</div><div class="panel">${M.filter(m => !m.played).slice(0, 12).map(matchRow).join("")}</div>` : ""}`;
  let lim = 30;
  const drawKR = () => {
    const key = { rank: r => r.rank, w: r => -r.w, wr: r => -(r.w / Math.max(1, r.w + r.l)), mvp: r => -r.mvp, elo: r => -(r.k != null && keyIdx[r.k] != null ? P[keyIdx[r.k]].r : 0), pt: r => -r.pt }[RK.sort];
    const L = (K.ranking || []).slice().sort((a, b) => (key(a) - key(b)) * RK.dir || a.rank - b.rank);
    const th = (k, t, c = "") => `<th class="${c} ${RK.sort === k ? "sorted" : ""}" data-s="${k}">${t}</th>`;
    $("#kr").innerHTML = `<thead><tr>${th("rank", "#", "r")}<th>선수</th><th class="hide-m">팀</th>${th("w", "전적", "r")}${th("wr", "승률", "r")}<th class="r hide-m">개인</th><th class="r hide-m">에결</th>${th("mvp", "MVP", "r")}${th("elo", "ELO", "r hide-m")}</tr></thead><tbody>
      ${L.slice(0, lim).map(r => { const tm = K.teams?.find(t => t.members.some(m => m.id === r.id)); const pi = r.k != null ? keyIdx[r.k] : null;
        return `<tr ${pi != null ? `data-k="${esc(r.k)}"` : `class="static"`}><td class="rk r num ${r.rank <= 3 ? "t3" : ""}" style="font-size:24px">${r.rank}</td>
        <td class="nm">${esc(r.id)} ${raceB(r.race)}<span class="sub">${esc(r.tier || "")} · 출전 ${r.apps}</span></td><td class="hide-m">${tm ? teamB(tm.name) : ""}</td>
        <td class="r num" style="font-size:18px">${r.w}-${r.l}</td><td class="r"><span class="wr">${pctS(r.w, r.w + r.l)}</span></td>
        <td class="r hide-m num" style="font-size:15px">${r.indW}-${r.indL}</td><td class="r hide-m num" style="font-size:15px">${r.aceW}-${r.aceL}</td>
        <td class="r num" style="font-size:18px;color:${r.mvp ? "var(--brass1)" : "var(--ink3)"}">${r.mvp}</td>
        <td class="r hide-m num" style="font-size:16px;color:var(--ink2)">${pi != null ? r0(P[pi].r) : "—"}</td></tr>`; }).join("")}</tbody>`;
    $("#krm").style.display = L.length > lim ? "" : "none";
  };
  drawKR();
  $("#kr").onclick = e => { const s = e.target.closest("[data-s]")?.dataset.s; if (s) { RK.dir = RK.sort === s ? -RK.dir : 1; RK.sort = s; drawKR(); return; }
    const k = e.target.closest("tr[data-k]")?.dataset.k; if (k) location.hash = `#/p/${encodeURIComponent(k)}`; };
  $("#krm").onclick = () => { lim += 60; drawKR(); };
  app.querySelector(".stand tbody").onclick = e => { const t = e.target.closest("tr[data-team]")?.dataset.team; if (t) location.hash = `#/kpl/team/${encodeURIComponent(t)}`; };
  app.querySelectorAll(".memb").forEach(b => b.onclick = () => { const m = b.nextElementSibling; m.hidden = !m.hidden; b.textContent = m.hidden ? b.textContent.replace("접기", "보기") : b.textContent.replace("보기", "접기"); });
  bindMatches();
}
// 리그 화면 위 탭: KPL + 운영진이 '리그 시트 등록'에 넣은 진행 중 리그들
function lgTabs(on) {
  const L = D.live || [];
  if (!L.length) return "";
  return `<div class="seg lgtabs"><a class="${on === "kpl" ? "on" : ""}" href="#/kpl">${esc(K?.season || "KPL")}</a>${L.map((l, n) => `<a class="${on === n ? "on" : ""}" href="#/kpl/lg/${n}">${esc(l.name)}</a>`).join("")}</div>`;
}
// 같은 두 선수의 세트를 한 매치로 묶는다 (다전제) — js: 경기 번호(시간 순)
function toMatches(js) {
  const M = [], open = new Map();
  js.forEach(j => { const g = G[j], a = Math.min(g[3], g[4]), b = Math.max(g[3], g[4]), key = a + ":" + b;
    let m = open.get(key);
    if (!m) { m = { a, b, sa: 0, sb: 0, d0: g[0], d1: g[0], js: [] }; M.push(m); open.set(key, m); }
    m[g[3] === a ? "sa" : "sb"]++; m.d1 = g[0]; m.js.push(j); });
  M.forEach(m => { m.w = m.sa > m.sb ? m.a : m.sb > m.sa ? m.b : null; m.l = m.w == null ? null : m.w === m.a ? m.b : m.a; });
  return M;
}
// 토너먼트: 선수마다 몇 번째 매치인지로 라운드를 정한다
function bracket(M, size) {
  const cnt = new Map(); M.sort((x, y) => x.d0 - y.d0);
  M.forEach(m => { const r = Math.max(cnt.get(m.a) || 0, cnt.get(m.b) || 0) + 1; m.r = r; cnt.set(m.a, r); cnt.set(m.b, r); });
  const R = Math.max(0, ...M.map(m => m.r));
  const lab = r => { const n = size ? size / 2 ** (r - 1) : 2 ** (R - r + 1); return n <= 2 ? "결승" : n + "강"; };
  const cols = []; for (let r = 1; r <= R; r++) cols.push({ r, name: lab(r), M: M.filter(m => m.r === r) });
  if (size) for (let r = R + 1; size / 2 ** (r - 1) >= 2; r++) cols.push({ r, name: lab(r), M: [], tbd: size / 2 ** r });   // 아직 안 치른 라운드는 빈 칸
  const last = cols.at(-1);
  if (last && last.name === "결승" && last.M.length > 1 && cols.length > 1) {      // 결승 라운드에 매치가 둘이면 하나는 3·4위전
    const semiW = new Set(cols.at(-2).M.map(m => m.w));
    last.M.forEach(m => { if (!(semiW.has(m.a) && semiW.has(m.b))) m.third = true; });
  }
  const fin = last?.name === "결승" ? last.M.find(m => !m.third && m.w != null) : null;
  return { cols, champ: fin ? fin.w : null };
}
function bracketHTML(B) {
  const side = (m, i, s) => `<a class="bp ${m.w === i ? "win" : m.w != null ? "lose" : ""}" href="${pLink(i)}"><span>${esc(P[i].id)} ${raceB(P[i].race)}</span><b class="num">${s}</b></a>`;
  return `<div class="brk">${B.cols.map(c => `<div class="bcol"><div class="bh">${c.name}</div><div class="bms">${c.M.map(m => `<div class="bm ${m.third ? "third" : ""}">${m.third ? `<i>3·4위전</i>` : ""}${side(m, m.a, m.sa)}${side(m, m.b, m.sb)}<em>${fmtD(m.d1).slice(5)}</em></div>`).join("")}${Array.from({ length: c.tbd || 0 }, () => `<div class="bm tbd"><span class="bp">미정</span><span class="bp">미정</span></div>`).join("")}</div></div>`).join("")}
    ${B.champ != null ? `<div class="bcol champ"><div class="bh">우승</div><div class="bms"><a class="bwin" href="${pLink(B.champ)}">${TROPHY}<b>${esc(P[B.champ].id)}</b>${raceB(P[B.champ].race)}</a></div></div>` : ""}</div>`;
}
// 조별리그: 서로 붙은 선수끼리 한 조로 묶는다
function groupsOf(M) {
  const par = new Map(), f = x => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  M.forEach(m => [m.a, m.b].forEach(x => par.has(x) || par.set(x, x)));
  M.forEach(m => par.set(f(m.a), f(m.b)));
  const gs = new Map();
  M.forEach(m => { const k = f(m.a); if (!gs.has(k)) gs.set(k, []); gs.get(k).push(m); });
  return [...gs.values()].sort((x, y) => x[0].d0 - y[0].d0).map((ms, n) => {
    const t = new Map(), row = i => t.get(i) || (t.set(i, { i, mw: 0, ml: 0, sw: 0, sl: 0 }), t.get(i));
    ms.forEach(m => { const A = row(m.a), B = row(m.b); A.sw += m.sa; A.sl += m.sb; B.sw += m.sb; B.sl += m.sa;
      if (m.w === m.a) { A.mw++; B.ml++; } else if (m.w === m.b) { B.mw++; A.ml++; } });
    return { name: String.fromCharCode(65 + n) + "조", rows: [...t.values()].sort((x, y) => y.mw - x.mw || (y.sw - y.sl) - (x.sw - x.sl) || y.sw - x.sw), ms };
  });
}
function viewLive(n) {
  const L = (D.live || [])[n];
  if (!L) { location.hash = "#/kpl"; return; }
  const fm = L.format || "league", js = []; G.forEach((g, j) => { if (g[9] === L.src) js.push(j); });
  const st = new Map(), add = (i, w) => { const o = st.get(i) || { i, w: 0, l: 0 }; o[w ? "w" : "l"]++; st.set(i, o); };
  js.forEach(j => { add(G[j][3], 1); add(G[j][4], 0); });
  const rank = [...st.values()].sort((a, b) => b.w - a.w || (b.w / (b.w + b.l)) - (a.w / (a.w + a.l)) || P[b.i].r - P[a.i].r);
  const mu = { PT: { w: 0, n: 0 }, PZ: { w: 0, n: 0 }, TZ: { w: 0, n: 0 } }, mp = {};
  js.forEach(j => { const g = G[j], a = RN[g[5]], b = RN[g[6]]; if (a && b && a !== b) { const [x, y] = [a, b].sort(); mu[x + y].n++; if (a === x) mu[x + y].w++; }
    if (g[2] >= 0) mp[g[2]] = (mp[g[2]] || 0) + 1; });
  const d0 = js.length ? G[js[0]][0] : null, d1 = js.length ? G[js.at(-1)][0] : null;
  // 방식별 본문
  const cut = fm === "group" && L.tourStart ? dateDay(L.tourStart) : null;
  const jsG = fm === "group" ? js.filter(j => cut == null || G[j][0] < cut) : [], jsT = fm === "tour" ? js : fm === "group" && cut != null ? js.filter(j => G[j][0] >= cut) : [];
  const groups = fm === "group" ? groupsOf(toMatches(jsG)) : [];
  const B = jsT.length ? bracket(toMatches(jsT), +L.tourSize || 0) : null;
  const fmName = { league: "풀리그", group: "조별리그 → 토너먼트", tour: "토너먼트" }[fm];
  const groupHTML = groups.length ? `<div class="h3">조별리그<em>${groups.length}개 조 · 매치 승수 → 세트 득실 순 · 누르면 그 조 경기</em></div>
    <div class="grps">${groups.map((g, k) => `<div class="card grp" data-g="${k}"><h3>${g.name}<em>${g.ms.length}매치</em></h3><table class="mini"><tr><th>#</th><th>선수</th><th class="r">매치</th><th class="r">세트</th><th class="r">득실</th></tr>
      ${g.rows.map((r, q) => `<tr><td class="num">${q + 1}</td><td><b>${esc(P[r.i].id)}</b> ${raceB(P[r.i].race)}</td><td class="r num">${r.mw}-${r.ml}</td><td class="r num">${r.sw}-${r.sl}</td><td class="r num" style="color:${r.sw - r.sl > 0 ? "var(--up)" : r.sw - r.sl < 0 ? "var(--down)" : "var(--ink3)"}">${r.sw - r.sl > 0 ? "+" : ""}${r.sw - r.sl}</td></tr>`).join("")}</table></div>`).join("")}</div>` : "";
  const tourHTML = B ? `<div class="h3">토너먼트<em>${fm === "group" ? `${esc(L.tourStart)}부터 · ` : ""}매치 = 같은 두 선수의 세트를 묶음</em></div><div class="panel scroll">${bracketHTML(B)}</div>`
    : fm === "group" ? `<div class="h3">토너먼트</div><div class="empty">${L.tourStart ? "아직 토너먼트 경기가 없습니다" : "운영진이 토너먼트 시작일을 넣으면 대진표가 나옵니다"}</div>` : "";
  let lim = 40;
  app.innerHTML = `${lgTabs(n)}<div class="kpl-head"><div class="kicker" style="color:#ffb38a">진행 중 리그 · ${esc(L.league)} · ${fmName}</div>
      <div class="season">${esc(L.name)}</div>
      <div class="meta"><span>세트 <b>${js.length}</b></span><span>선수 <b>${st.size}</b></span>${d0 != null ? `<span>기간 <b>${fmtD(d0).slice(2)} ~ ${fmtD(d1).slice(5)}</b></span>` : ""}${B?.champ != null ? `<span>우승 <b style="color:var(--brass1)">${esc(P[B.champ].id)}</b></span>` : ""}</div>
      <div class="wm">LIVE</div></div>
    ${js.length ? `${fm === "league" ? "" : tourHTML}${groupHTML}
    <div class="h3">${fm === "league" ? "순위" : "개인 성적"}<em>이 리그 세트 기준 · 승수 순</em></div>
    <div class="panel scroll"><table class="tbl" id="lvr"><thead><tr><th class="r">#</th><th></th><th>선수</th><th class="r">전적</th><th class="r">승률</th><th class="r">ELO</th></tr></thead><tbody>
      ${rank.map((o, k) => { const p = P[o.i]; return `<tr data-k="${esc(p.k)}" ${k >= 30 ? "hidden" : ""}><td class="rk r num ${k < 3 ? "t3" : ""}" style="font-size:22px">${k + 1}</td><td class="stripe" style="--tc:${tc(p.tier)}"></td>
        <td class="nm">${esc(p.id)} ${raceB(p.race)}<span class="sub">${esc(p.tier || "")}</span></td><td class="r num" style="font-size:18px">${o.w}-${o.l}</td>
        <td class="r"><span class="wr">${pctS(o.w, o.w + o.l)}</span></td><td class="r num" style="font-size:16px;color:var(--ink2)">${r0(p.r)}</td></tr>`; }).join("")}
    </tbody></table></div>${rank.length > 30 ? `<button class="more" id="lvrm">전체 ${rank.length}명 보기</button>` : ""}
    <div class="grid c2">
      <div class="card"><h3>종족전<em>앞 종족 승률</em></h3><div class="mu">${muRows(Object.entries(mu).filter(([, v]) => v.n).map(([k, v]) => ({ k, w: v.w, l: v.n - v.w, n: v.n })), k => `<span style="color:var(--${k[0]})">${k[0]}</span>v<span style="color:var(--${k[1]})">${k[1]}</span>`) || `<div class="empty">—</div>`}</div></div>
      <div class="card"><h3>맵<em>많이 쓴 순</em></h3><table class="mini">${Object.entries(mp).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => `<tr><td>${esc(D.maps[k])}</td><td class="r num">${c}세트</td></tr>`).join("") || `<tr><td class="empty">맵 기록 없음</td></tr>`}</table></div>
    </div>
    <div class="h3">경기 결과<em>최근 순 · 누르면 맞대결</em></div>
    <div class="panel scroll"><table class="mini" id="lvg"></table></div><button class="more" id="lvm">더 보기</button>`
    : `<div class="empty" style="margin-top:20px">아직 들어온 경기가 없습니다. 다음 아침 갱신 때 시트에서 가져옵니다.</div>`}`;
  if (!js.length) return;
  const rowsOf = list => `<tr><th>날짜</th><th>승자</th><th></th><th>패자</th><th>맵</th></tr>` + list.map(j => { const g = G[j];
      return `<tr class="clk" data-vs="${esc(P[g[3]].k)}" data-b="${esc(P[g[4]].k)}"><td class="num">${fmtD(g[0]).slice(5)}</td><td><b>${esc(P[g[3]].id)}</b> ${raceB(RN[g[5]])}</td><td style="color:var(--ink3)">승</td><td>${esc(P[g[4]].id)} ${raceB(RN[g[6]])}</td><td style="color:var(--ink3)">${esc(mapN(g))}</td></tr>`; }).join("");
  const drawG = () => { $("#lvg").innerHTML = rowsOf(js.slice().reverse().slice(0, lim)); $("#lvm").style.display = js.length > lim ? "" : "none"; };
  drawG();
  $("#lvm").onclick = () => { lim += 80; drawG(); };
  if ($("#lvrm")) $("#lvrm").onclick = () => { app.querySelectorAll("#lvr tr[hidden]").forEach(t => t.hidden = false); $("#lvrm").remove(); };
  let vsB = null; const goVs = a => location.hash = `#/vs/${encodeURIComponent(a)}/${encodeURIComponent(vsB)}`;
  app.onclick = e => {
    const k = e.target.closest("#lvr tr[data-k]")?.dataset.k; if (k) { location.hash = `#/p/${encodeURIComponent(k)}`; return; }
    const t = e.target.closest("tr[data-vs]"); if (t && t.closest("#lvg")) { vsB = t.dataset.b; goVs(t.dataset.vs); return; }
    const gp = e.target.closest(".grp[data-g]"); if (gp && !e.target.closest("a")) { const g = groups[+gp.dataset.g];
      popup(`${esc(L.name)} · ${g.name}`, `${g.ms.length}매치 · ${g.ms.reduce((a, m) => a + m.js.length, 0)}세트`, `<table class="mini">${rowsOf(g.ms.flatMap(m => m.js).sort((x, y) => y - x))}</table>`, null); }
  };
}
function matchRow(m) {
  const hw = m.played && m.hs > m.as, aw = m.played && m.as > m.hs;
  return `<div class="mt" data-no="${esc(m.no)}"><div class="match ${m.played ? "" : "up"}" style="cursor:${m.played ? "pointer" : "default"}">
    <div class="t h ${m.played ? (hw ? "win" : "lose") : ""}">${teamB(m.home)}</div>
    <div class="sc">${m.played ? `${m.hs}<i>:</i>${m.as}` : "vs"}</div>
    <div class="t ${m.played ? (aw ? "win" : "lose") : ""}">${teamB(m.away)}</div>
    <div class="when">${esc(m.stage || "")} ${esc(m.no || "")} · ${esc((m.date || "").replaceAll("-", "."))} ${esc(m.time || "")}${m.mvp ? ` · MVP <b style="color:var(--brass1)">${esc(m.mvp)}</b>` : ""}${m.caster ? ` · 중계 ${esc(m.caster)}` : ""}</div></div>
    <div class="sets" hidden>${(m.sets || []).map(s => { const wHome = s.wteam === m.home;
      const W = `<span class="w">${pName(s.w, s.wk)} ${raceB(s.wrace)}</span>`, L = `<span class="l">${esc(s.l)} ${raceB(s.lrace)}</span>`;
      return `<div class="s"><span class="n">${s.kind === "ACE" ? "ACE" : s.n + "SET"}</span><span class="a">${wHome ? W : L}</span><span class="x">${wHome ? "◀" : "▶"}</span><span>${wHome ? L : W}</span><span class="mp">${esc(s.map || "")}</span></div>`; }).join("")}</div></div>`;
}
function bindMatches() {
  app.querySelectorAll(".mt").forEach(el => el.querySelector(".match").addEventListener("click", e => {
    if (e.target.closest("a")) return; const s = el.querySelector(".sets"); if (s.innerHTML.trim()) s.hidden = !s.hidden; }));
}
function viewKPLTeam(name) {
  const t = K.teams?.find(x => x.name === name);
  if (!t) { app.innerHTML = `<div class="empty">팀을 찾을 수 없습니다</div>`; return; }
  const s = K.standings?.find(x => x.team === name) || {};
  const played = (K.matches || []).filter(m => m.played && (m.home === name || m.away === name));
  const sets = played.flatMap(m => m.sets.map(x => ({ ...x, m })));
  const my = sets.filter(x => x.wteam === name || x.lteam === name);
  const won = x => x.wteam === name;
  const byMap = {}, byRace = {}, byKind = { 개인: { w: 0, l: 0 }, ACE: { w: 0, l: 0 } }, byOpp = {};
  my.forEach(x => {
    const w = won(x), mr = w ? x.wrace : x.lrace, or = w ? x.lrace : x.wrace, ot = w ? x.lteam : x.wteam;
    (byMap[x.map] = byMap[x.map] || { w: 0, l: 0 })[w ? "w" : "l"]++;
    if (mr && or) (byRace[mr + "v" + or] = byRace[mr + "v" + or] || { w: 0, l: 0 })[w ? "w" : "l"]++;
    (byKind[x.kind === "ACE" ? "ACE" : "개인"])[w ? "w" : "l"]++;
    (byOpp[ot] = byOpp[ot] || { w: 0, l: 0 })[w ? "w" : "l"]++;
  });
  const rows = o => Object.entries(o).map(([k, v]) => ({ k, ...v, n: v.w + v.l })).sort((a, b) => b.n - a.n);
  const mem = t.members.map(m => {
    const pi = m.k != null ? keyIdx[m.k] : null, r = K.ranking?.find(x => x.id === m.id);
    const ms = my.filter(x => x.w === m.id || x.l === m.id);
    return { ...m, pi, r, elo: pi != null ? P[pi].r : null, sw: ms.filter(x => x.w === m.id).length, sl: ms.filter(x => x.l === m.id).length };
  }).sort((a, b) => (b.r?.apps || 0) - (a.r?.apps || 0) || (b.elo || 0) - (a.elo || 0));
  const elos = mem.map(m => m.elo).filter(Boolean);
  const bestElo = mem.filter(m => m.elo).sort((a, b) => b.elo - a.elo)[0];
  const mvpTop = mem.filter(m => m.r?.mvp).sort((a, b) => b.r.mvp - a.r.mvp)[0];
  const ace = mem.filter(m => m.r && (m.r.aceW + m.r.aceL)).sort((a, b) => b.r.aceW - a.r.aceW)[0];
  const tierCnt = T.map(tt => ({ tt, n: mem.filter(m => m.tier === tt).length })).filter(x => x.n);
  app.innerHTML = `<a class="back" href="#/kpl">← KPL</a>
    <div class="kpl-head" style="background:radial-gradient(600px 300px at 0% 0%,color-mix(in srgb,${tmC(name)} 45%,transparent),transparent 70%),radial-gradient(700px 380px at 100% 100%,rgba(28,52,120,.55),transparent 70%),linear-gradient(160deg,var(--heroA),var(--heroB))">
      <div class="kicker" style="color:${tmC(name)}">${esc(K.season)} · ${s.rank ? s.rank + "위" : ""}</div>
      <div class="season">${esc(name)}</div>
      <div class="meta"><span>팀 전적 <b>${s.w ?? 0}승 ${s.l ?? 0}패</b></span><span>세트 <b>${s.setW ?? 0}-${s.setL ?? 0}</b></span><span>득실 <b>${s.diff > 0 ? "+" : ""}${s.diff ?? 0}</b></span>
        <span>팀장 <b>${esc(t.members.find(m => m.role === "팀장")?.id || "—")}</b></span><span>부팀장 <b>${esc(t.members.find(m => m.role === "부팀장")?.id || "—")}</b></span></div>
      <div class="wm">${s.rank || ""}</div></div>
    <div class="stats c3">
      <div><b class="num">${elos.length ? r0(elos.reduce((a, b) => a + b, 0) / elos.length) : "—"}</b><span>팀원 평균 ELO</span></div>
      <div><b class="num" style="font-size:22px">${mvpTop ? esc(mvpTop.id) + " ×" + mvpTop.r.mvp : "—"}</b><span>최다 MVP</span></div>
      <div><b class="num" style="font-size:22px">${ace ? esc(ace.id) + " " + ace.r.aceW + "-" + ace.r.aceL : "—"}</b><span>에결 해결사</span></div>
    </div>
    <div class="h3">티어별 최고 ELO<em>티어마다 팀 안에서 ELO가 가장 높은 선수</em></div>
    <div class="aces">${T.map(tt => { const top = mem.filter(m => m.tier === tt && m.elo).sort((a, b) => b.elo - a.elo)[0];
      return top ? `<a class="ace" style="--tc:${tc(tt)}" href="${pLink(top.pi)}"><span class="tier ${tt}" style="--tc:${tc(tt)}">${tt}</span><b>${esc(top.id)}</b> ${raceB(top.race)}<i class="num">${r0(top.elo)}</i></a>` : ""; }).join("")}</div>
    <div class="h3">팀원 분석<em>${mem.length}명 · KPL 출전 순</em></div>
    <div class="panel scroll"><table class="tbl" id="tm"><thead><tr><th></th><th>선수</th><th class="r">KPL 전적</th><th class="r">승률</th><th class="r hide-m">개인</th><th class="r hide-m">에결</th><th class="r hide-m">MVP</th><th class="r">ELO</th><th class="r hide-m">ELO 통산</th></tr></thead><tbody>
      ${mem.map(m => { const p = m.pi != null ? P[m.pi] : null;
        return `<tr ${p ? `data-k="${esc(p.k)}"` : `class="static"`}><td class="stripe" style="--tc:${tc(m.tier)}"></td>
          <td class="nm">${esc(m.id)} ${raceB(m.race)} ${m.role ? `<span class="st">${esc(m.role)}</span>` : ""}<span class="sub">${esc(m.tier || "")}${p && rankAll[p.i] ? ` · 클랜 #${rankAll[p.i]}` : ""}</span></td>
          <td class="r num" style="font-size:18px">${m.r ? `${m.r.w}-${m.r.l}` : "—"}</td><td class="r"><span class="wr">${m.r ? pctS(m.r.w, m.r.w + m.r.l) : "—"}</span></td>
          <td class="r hide-m num" style="font-size:15px">${m.r ? `${m.r.indW}-${m.r.indL}` : "—"}</td><td class="r hide-m num" style="font-size:15px">${m.r ? `${m.r.aceW}-${m.r.aceL}` : "—"}</td>
          <td class="r hide-m num" style="font-size:15px;color:${m.r?.mvp ? "var(--brass1)" : "var(--ink3)"}">${m.r?.mvp || 0}</td>
          <td class="r num" style="font-size:20px">${m.elo ? r0(m.elo) : "—"}</td><td class="r hide-m num" style="font-size:15px;color:var(--ink2)">${p ? `${p.w}-${p.l}` : "—"}</td></tr>`; }).join("")}
    </tbody></table></div>
    <div class="grid c3">
      <div class="card"><h3>맵별<em>이번 시즌 세트</em></h3><div class="mu">${muRows(rows(byMap).slice(0, 10), k => esc(k.slice(0, 7))) || `<div class="empty">—</div>`}</div></div>
      <div class="card"><h3>종족 상성<em>우리 종족 v 상대</em></h3><div class="mu">${muRows(rows(byRace), k => `<span style="color:var(--${k[0]})">${k[0]}</span>v<span style="color:var(--${k[2]})">${k[2]}</span>`) || `<div class="empty">—</div>`}</div>
        <h3 style="margin-top:18px">개인전 · 에결</h3><div class="mu">${muRows(rows(byKind).filter(o => o.n), k => k === "ACE" ? "에결" : "개인전")}</div></div>
      <div class="card"><h3>상대 팀별<em>세트 기준</em></h3><div class="mu">${muRows(rows(byOpp), k => esc(k.slice(0, 6)), k => tmC(k)) || `<div class="empty">—</div>`}</div>
        <h3 style="margin-top:18px">티어 구성</h3><div class="mu">${tierCnt.map(x => `<div class="row"><span class="lbl" style="color:${tc(x.tt)}">${x.tt}</span><div class="track" style="--c:${tc(x.tt)}"><i style="width:${100 * x.n / mem.length}%"></i></div><span class="v"><b>${x.n}</b>명</span></div>`).join("")}</div></div>
    </div>
    <div class="h3">경기<em>누르면 세트 결과</em></div>
    <div class="panel">${(K.matches || []).filter(m => m.home === name || m.away === name).slice().reverse().map(matchRow).join("")}</div>`;
  $("#tm tbody").onclick = e => { const k = e.target.closest("tr[data-k]")?.dataset.k; if (k) location.hash = `#/p/${encodeURIComponent(k)}`; };
  bindMatches();
}

/* ---------- 분석 ---------- */
function viewStats(tab = "league") {
  const tabs = { league: "리그", tier: "티어", race: "종족", map: "맵", rec: "기록실" };
  app.innerHTML = `<div class="h"><h2><small>${G.length.toLocaleString()}세트 · ${fmtD(G[0][0])} ~ ${fmtD(G[G.length - 1][0])}</small><span class="gold">Analytics</span></h2></div>
    <div class="seg">${Object.entries(tabs).map(([k, v]) => `<button class="${k === tab ? "on" : ""}" data-tab="${k}">${v}</button>`).join("")}</div><div id="sv"></div>`;
  $(".seg").onclick = e => { const t = e.target.dataset.tab; if (t) location.hash = `#/stats/${t}`; };
  const sv = $("#sv");
  if (tab === "league") {
    const L = D.leagues.map((l, k) => ({ ...l, k, n: 0, ps: new Set(), d0: 1e9, d1: -1, wins: new Map() }));
    G.forEach(g => { const o = L[g[1]]; o.n++; o.ps.add(g[3]); o.ps.add(g[4]); o.d0 = Math.min(o.d0, g[0]); o.d1 = Math.max(o.d1, g[0]); o.wins.set(g[3], (o.wins.get(g[3]) || 0) + 1); });
    const max = Math.max(...L.map(o => o.n));
    sv.innerHTML = `<div class="panel scroll"><table class="tbl"><thead><tr><th>리그</th><th class="r">가중치</th><th class="r">세트</th><th class="r hide-m">선수</th><th class="hide-m">기간</th><th class="hide-m">최다승</th></tr></thead><tbody>
      ${L.filter(o => o.n).sort((a, b) => b.n - a.n).map(o => { const top = [...o.wins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        return `<tr class="static"><td class="nm">${esc(o.name)}<span class="sub"><span class="wr"><span class="b" style="width:120px"><i style="width:${100 * o.n / max}%"></i></span></span></span></td>
        <td class="r num" style="font-size:16px">×${o.w}</td><td class="r num rt">${o.n.toLocaleString()}</td><td class="r hide-m num" style="font-size:16px">${o.ps.size}</td>
        <td class="hide-m" style="color:var(--ink3);font-size:12px">${fmtD(o.d0)} ~ ${fmtD(o.d1)}</td>
        <td class="hide-m">${top.map(([pi, c]) => `<a href="${pLink(pi)}">${esc(P[pi].id)}</a> <span style="color:var(--ink3)">${c}</span>`).join(" · ")}</td></tr>`; }).join("")}
      </tbody></table></div><p class="legend">큰 대회일수록 가중치가 높습니다. 레이팅 계산에는 가중치의 제곱근을 씁니다.</p>`;
  }
  if (tab === "tier") {
    const M = T.map(() => T.map(() => ({ w: 0, n: 0 })));
    G.forEach(g => { const a = g[7], b = g[8]; if (a < 0 || b < 0 || a >= T.length || b >= T.length || a === b) return; M[a][b].w++; M[a][b].n++; M[b][a].n++; });
    const cell = o => { if (o.n < 5) return `<td style="background:rgba(255,255,255,.03);color:var(--ink3)">${o.n ? "·" : ""}</td>`;
      const v = o.w / o.n, c = v >= .5 ? `rgba(94,220,154,${(v - .5) * 1.5})` : `rgba(255,99,120,${(.5 - v) * 1.5})`;
      return `<td style="background:${c}" title="${o.w}승 ${o.n - o.w}패">${(v * 100).toFixed(0)}<small>${o.n}</small></td>`; };
    const cnt = T.map(t => ({ t, n: ranked.filter(p => p.tier === t).length }));
    sv.innerHTML = `<div class="grid" style="margin-top:0">
      <div class="card"><h3>티어 상성<em>행 티어의 승률 % · 작은 숫자 = 세트 수</em></h3><div><table class="heat">
        <tr><th></th>${T.map(t => `<th style="color:${tc(t)}">${t.slice(0, 3)}</th>`).join("")}</tr>
        ${T.map((t, a) => `<tr><th style="color:${tc(t)};text-align:right">${t.slice(0, 3)}</th>${T.map((_, b) => a === b ? `<td style="background:rgba(0,0,0,.25)"></td>` : cell(M[a][b])).join("")}</tr>`).join("")}
      </table></div><p class="legend">시트에 기록된 '경기 당시' 티어 기준. 5세트 미만 칸은 생략.</p></div>
      <div class="card"><h3>티어별 인원<em>정식 순위 선수 ${cnt.reduce((a, c) => a + c.n, 0)}명</em></h3>${tierBell(cnt)}</div></div>
      <div class="card" style="margin-top:14px"><h3>티어별 ELO 분포<em>점 = 선수 · 상자 = 가운데 절반 · 선 = 중앙값</em></h3>${tierSpread()}</div>`;
  }
  if (tab === "rec") sv.innerHTML = records();
  if (tab === "race" || tab === "map") {
    const pairs = [["P", "T"], ["P", "Z"], ["T", "Z"]];
    const mk = () => ({ PT: { w: 0, n: 0 }, PZ: { w: 0, n: 0 }, TZ: { w: 0, n: 0 }, mirror: 0, n: 0 });
    const add = (o, g) => { const a = RN[g[5]], b = RN[g[6]]; if (!a || !b) return; o.n++; if (a === b) { o.mirror++; return; }
      const [x, y] = [a, b].sort(), key = x + y; o[key].n++; if (a === x) o[key].w++; };
    if (tab === "race") {
      const tot = mk(), years = {};
      G.forEach(g => { add(tot, g); const y = day2date(g[0]).getFullYear(); add(years[y] = years[y] || mk(), g); });
      const card = (o, title) => `<div class="card"><h3>${title}<em>${o.n.toLocaleString()}세트</em></h3><div class="mu">
        ${pairs.map(([a, b]) => { const s = o[a + b]; return `<div class="row"><span class="lbl"><span style="color:var(--${a})">${a}</span>v<span style="color:var(--${b})">${b}</span></span>
        <div class="track" style="--c:var(--${a});background:color-mix(in srgb,var(--${b}) 55%,var(--slab3))"><i style="width:${pct(s.w, s.n) || 50}%"></i></div>
        <span class="v"><b>${pctS(s.w, s.n)}</b> ${s.n}</span></div>`; }).join("")}</div></div>`;
      const pop = { P: 0, T: 0, Z: 0 }; ranked.forEach(p => p.race && pop[p.race]++);
      const avg = r => { const L = ranked.filter(p => p.race === r); return L.length ? r0(L.reduce((s, p) => s + p.r, 0) / L.length) : "—"; };
      sv.innerHTML = `<div class="stats" style="margin-bottom:10px">${RN.map(r => `<div><b class="num" style="color:var(--${r})">${pop[r]}명</b><span>${RACE_KO[r]} · 평균 ELO ${avg(r)}</span></div>`).join("")}
        <div><b class="num">${pctS(tot.mirror, tot.n)}</b><span>동족전 비율</span></div></div>
        <div class="grid c2" style="margin-top:0">${card(tot, "전체 종족 상성")}${Object.keys(years).sort().reverse().map(y => card(years[y], y + "년")).join("")}</div>
        <p class="legend">막대 왼쪽 색 = 앞 종족 승률. 각 세트 기록의 종족 기준(부종 포함).</p>`;
    } else {
      const mp = D.maps.map(() => mk());
      G.forEach(g => g[2] >= 0 && add(mp[g[2]], g));
      sv.innerHTML = `<div class="panel scroll"><table class="tbl"><thead><tr><th>맵</th><th class="r">세트</th><th class="r">PvT</th><th class="r">PvZ</th><th class="r">TvZ</th></tr></thead><tbody>
        ${mp.map((o, k) => ({ o, k })).filter(x => x.o.n >= 20).sort((a, b) => b.o.n - a.o.n).map(({ o, k }) => `<tr class="static"><td class="nm">${esc(D.maps[k])}</td><td class="r num rt">${o.n}</td>
          ${pairs.map(([a, b]) => { const s = o[a + b], v = pct(s.w, s.n); return `<td class="r num" style="font-size:16px;color:${!s.n ? "var(--ink3)" : v >= 55 ? `var(--${a})` : v <= 45 ? `var(--${b})` : "var(--ink)"}">${pctS(s.w, s.n)} <span style="color:var(--ink3);font-size:11px">${s.n}</span></td>`; }).join("")}</tr>`).join("")}
        </tbody></table></div><p class="legend">20세트 이상 맵 · 수치는 앞 종족 승률 · 55% 이상/45% 이하는 유리 종족 색</p>`;
    }
  }
}

function tierSpread() {
  const rows = T.map(t => ({ t, v: ranked.filter(p => p.tier === t).map(p => p.r).sort((a, b) => a - b) })).filter(x => x.v.length);
  if (!rows.length) return `<div class="empty">자료가 없습니다</div>`;
  const all = rows.flatMap(x => x.v), lo = Math.floor(Math.min(...all) / 50) * 50, hi = Math.ceil(Math.max(...all) / 50) * 50;
  const W = 640, pl = 84, pr = 16, rh = 44, pt = 14, H = pt + rows.length * rh + 30, X = v => pl + (v - lo) / (hi - lo || 1) * (W - pl - pr);
  const q = (v, f) => { const k = (v.length - 1) * f, a = Math.floor(k); return v[a] + (v[Math.ceil(k)] - v[a]) * (k - a); };
  const ticks = []; for (let v = lo; v <= hi; v += (hi - lo > 600 ? 200 : 100)) ticks.push(v);
  return `<svg class="chart spread" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}">
    ${ticks.map(v => `<line x1="${X(v)}" x2="${X(v)}" y1="${pt}" y2="${H - 22}" style="stroke:var(--rule)"/><text x="${X(v)}" y="${H - 4}" text-anchor="middle" class="sx">${v}</text>`).join("")}
    ${rows.map((x, k) => { const y = pt + k * rh + rh / 2, q1 = q(x.v, .25), md = q(x.v, .5), q3 = q(x.v, .75);
      return `<g style="--tc:${tc(x.t)}"><text x="${pl - 10}" y="${y + 6}" text-anchor="end" class="st">${x.t}</text>
        <line x1="${X(x.v[0])}" x2="${X(x.v.at(-1))}" y1="${y}" y2="${y}" style="stroke:var(--tc);stroke-width:1.5;opacity:.6"/>
        <rect x="${X(q1)}" y="${y - 10}" width="${Math.max(2, X(q3) - X(q1))}" height="20" rx="4" style="fill:var(--tc);fill-opacity:.22;stroke:var(--tc);stroke-width:1.5"><title>${x.t} ${x.v.length}명 · 가운데 절반 ${r0(q1)}~${r0(q3)} · 중앙값 ${r0(md)} · 최저 ${r0(x.v[0])} · 최고 ${r0(x.v.at(-1))}</title></rect>
        ${x.v.map((v, n) => `<circle cx="${X(v)}" cy="${y + ((n * 7) % 13) - 6}" r="2.2" style="fill:var(--tc);opacity:.75"/>`).join("")}
        <line x1="${X(md)}" x2="${X(md)}" y1="${y - 12}" y2="${y + 12}" style="stroke:var(--ink);stroke-width:2.5"/>
        <text x="${X(md)}" y="${y - 15}" text-anchor="middle" class="sm">${r0(md)}</text></g>`; }).join("")}</svg>`;
}

/* ---------- 기록실 ---------- */
function records() {
  const nm = i => `<a href="${pLink(i)}">${esc(P[i].id)}</a> ${raceB(P[i].race)}`;
  const box = (title, sub, list) => `<div class="card"><h3>${title}<em>${sub}</em></h3>${list.length ? `<ol class="rec">${list.map((x, n) =>
    `<li class="${n ? "" : "top"}"><span class="rn num">${n + 1}</span><span class="rw">${x.who}<i>${x.sub || ""}</i></span><span class="rv num">${x.v}</span></li>`).join("")}</ol>` : `<div class="empty">자료가 없습니다</div>`}</div>`;
  const ym = m => (D.months[m] || "").replace("-", ".");
  // 역대 최고 ELO (월말 기준, 선수마다 가장 높았던 때)
  const peak = P.map(p => { let b = null; p.h.forEach(h => { if (!b || h[1] > b[1]) b = h; }); return b && { i: p.i, r: b[1], m: b[0] }; })
    .filter(Boolean).sort((a, b) => b.r - a.r).slice(0, 5).map(x => ({ who: nm(x.i), sub: `${ym(x.m)} 월말`, v: r0(x.r) }));
  // 최장 연승 · 최다 상대
  const cur = {}, best = {}, opp = {};
  G.forEach(g => { const w = g[3], l = g[4];
    const c = cur[w] && cur[w].end === null ? cur[w] : (cur[w] = { n: 0, d0: g[0], end: null }); c.n++; c.d1 = g[0];
    if (!best[w] || c.n > best[w].n) best[w] = { n: c.n, d0: c.d0, d1: c.d1 };
    if (cur[l]) cur[l].end = g[0];
    (opp[w] = opp[w] || new Set()).add(l); (opp[l] = opp[l] || new Set()).add(w); });
  const strk = Object.entries(best).map(([i, b]) => ({ i: +i, ...b })).sort((a, b) => b.n - a.n || a.d1 - b.d1).slice(0, 5)
    .map(x => ({ who: nm(x.i), sub: `${fmtD(x.d0)} ~ ${fmtD(x.d1).slice(5)}`, v: `${x.n}연승` }));
  const many = (f, n = 5) => P.filter(p => p.w + p.l > 0).sort((a, b) => f(b) - f(a)).slice(0, n);
  const wins = many(p => p.w).map(p => ({ who: nm(p.i), sub: `${p.w}승 ${p.l}패 · ${pctS(p.w, p.w + p.l)}`, v: `${p.w}승` }));
  const games = many(p => p.w + p.l).map(p => ({ who: nm(p.i), sub: `${p.first.slice(0, 7).replace("-", ".")}부터`, v: `${(p.w + p.l).toLocaleString()}` }));
  const wr = P.filter(p => p.w + p.l >= 100).sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l)).slice(0, 5)
    .map(p => ({ who: nm(p.i), sub: `${p.w}승 ${p.l}패`, v: pctS(p.w, p.w + p.l) }));
  const foes = Object.entries(opp).map(([i, s]) => ({ i: +i, n: s.size })).sort((a, b) => b.n - a.n).slice(0, 5)
    .map(x => ({ who: nm(x.i), sub: `서로 다른 상대`, v: `${x.n}명` }));
  // 역대 최대 이변 (경기 직전 달 말 점수 기준)
  const ups = [];
  G.forEach(g => { const m = monthOf(g[0]) - 1; if (m < 0) return; const a = ratingAt(g[3], m), b = ratingAt(g[4], m); if (a != null && b != null && b - a >= 150) ups.push({ g, a, b }); });
  const upset = ups.sort((x, y) => (y.b - y.a) - (x.b - x.a)).slice(0, 5).map(x => ({
    who: `${nm(x.g[3])} <span style="color:var(--ink3)">승 vs</span> ${nm(x.g[4])}`, sub: `${fmtD(x.g[0])} · ${esc(D.leagues[x.g[1]].name)} · ${r0(x.a)} vs ${r0(x.b)}`, v: `+${r0(x.b - x.a)}` }));
  return `<div class="grid c2 recs" style="margin-top:0">
    ${box("역대 최고 ELO", "선수마다 가장 높았던 달", peak)}
    ${box("최장 연승", "모든 리그 합산", strk)}
    ${box("최대 이변", "경기 당시 점수 차이", upset)}
    ${box("최다승", "모든 리그 합산", wins)}
    ${box("최다 경기", "세트 수", games)}
    ${box("최고 승률", "100세트 이상", wr)}
    ${box("가장 많은 상대", "붙어 본 선수 수", foes)}
  </div><p class="legend">기록된 모든 세트 기준 · 점수는 그 달 말 ELO</p>`;
}

function tierBell(cnt) {
  const W = 640, H = 260, pl = 10, pr = 10, pt = 28, pb = 40, n = cnt.length, bw = (W - pl - pr) / n, max = Math.max(1, ...cnt.map(c => c.n));
  const X = k => pl + bw * k + bw / 2, Y = v => pt + (1 - v / max) * (H - pt - pb);
  const pts = cnt.map((c, k) => [X(k), Y(c.n)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;           // 막대 꼭대기를 잇는 부드러운 곡선(카트멀-롬 → 베지어)
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[k - 1] || pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] || p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  const area = `${d} L${pts.at(-1)[0]},${H - pb} L${pts[0][0]},${H - pb} Z`;
  return `<svg class="chart bell" viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}"><defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--brass2);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--brass2);stop-opacity:0"/></linearGradient></defs>
    <line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" style="stroke:var(--rule2)"/>
    ${cnt.map((c, k) => { const h = (H - pt - pb) * c.n / max; return `<rect class="bb" x="${X(k) - bw * .32}" y="${H - pb - h}" width="${bw * .64}" height="${h}" style="fill:${tc(c.t)};animation-delay:${k * 60}ms"><title>${c.t} ${c.n}명</title></rect>
      <text x="${X(k)}" y="${H - pb - h - 8}" text-anchor="middle" class="bv">${c.n}</text><text x="${X(k)}" y="${H - pb + 18}" text-anchor="middle" class="bt">${c.t}</text>`; }).join("")}
    <path d="${area}" fill="url(#bg1)"/><path d="${d}" class="bc" style="fill:none;stroke:var(--brass2);stroke-width:2.5;stroke-linecap:round"/></svg>`;
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
function streaks(seq) { // seq: true=A승
  let best = { a: 0, b: 0 }, cur = 0, who = null;
  seq.forEach(w => { if (w === who) cur++; else { who = w; cur = 1; } if (w) best.a = Math.max(best.a, cur); else best.b = Math.max(best.b, cur); });
  return { best, cur, who };
}
function viewVs([a, b] = []) {
  app.innerHTML = `<div class="h"><h2><small>상대 전적 · 리그 · 연도 · 종족 · 맵 · 공통 상대까지</small>Head <span class="gold">to</span> Head</h2></div>
    <div class="vsbox"><div class="side">${picker("pa", a)}</div><div class="x">VS</div><div class="side">${picker("pb", b)}</div></div><div id="vr"></div>`;
  bindPick("pa", k => location.hash = `#/vs/${encodeURIComponent(k)}/${encodeURIComponent(b || "")}`);
  bindPick("pb", k => location.hash = `#/vs/${encodeURIComponent(a || "")}/${encodeURIComponent(k)}`);
  const ia = keyIdx[a], ib = keyIdx[b];
  if (ia == null || ib == null) {
    const pool = ranked.filter(p => p.w + p.l >= 10).slice();
    for (let n = pool.length - 1; n > 0; n--) { const j = Math.floor(Math.random() * (n + 1)); [pool[n], pool[j]] = [pool[j], pool[n]]; }
    const picks = [];
    for (let n = 0; n + 1 < pool.length && picks.length < 6; n += 2) picks.push({ x: pool[n], y: pool[n + 1] });
    $("#vr").innerHTML = `<div class="empty" style="padding:22px">두 선수를 고르거나, 아래 추천 매치업을 눌러 보세요</div>
      <div class="h3">추천 매치업<em>들어올 때마다 무작위로 바뀝니다</em></div><div class="mups">${picks.map(m => `<a class="mup" href="#/vs/${encodeURIComponent(m.x.k)}/${encodeURIComponent(m.y.k)}">
        <div class="pp"><span style="--tc:${tc(m.x.tier)}"><b>${esc(m.x.id)}</b> ${raceB(m.x.race)}<i class="num">${r0(m.x.r)}</i></span><em>VS</em><span style="--tc:${tc(m.y.tier)}"><b>${esc(m.y.id)}</b> ${raceB(m.y.race)}<i class="num">${r0(m.y.r)}</i></span></div>
        <div class="ep">예상 승률 ${(expect(m.x.r, m.y.r) * 100).toFixed(0)} : ${(100 - expect(m.x.r, m.y.r) * 100).toFixed(0)}</div></a>`).join("")}</div>`;
    return;
  }
  const A = P[ia], B = P[ib];
  app.style.setProperty("--tc", tc(A.tier)); app.style.setProperty("--tc2", tc(B.tier) === tc(A.tier) ? "var(--Sky)" : tc(B.tier));
  const js = byP[ia].filter(j => G[j][3] === ib || G[j][4] === ib);
  const aw = js.filter(j => G[j][3] === ia).length, bw = js.length - aw;
  const e = expect(A.r, B.r);
  const seq = js.map(j => G[j][3] === ia);
  const st = streaks(seq);
  const byLg = agg(js, ia, g => g[1]).sort((x, y) => y.n - x.n);
  const byYr = agg(js, ia, g => day2date(g[0]).getFullYear()).sort((x, y) => y.k - x.k);
  const byMu = agg(js, ia, (g, win) => { const ar = RN[win ? g[5] : g[6]], br = RN[win ? g[6] : g[5]]; return ar && br ? ar + "v" + br : null; }).sort((x, y) => y.n - x.n);
  const maps = agg(js, ia, g => g[2] >= 0 ? g[2] : null).sort((x, y) => y.n - x.n);
  // 공통 상대
  const oa = new Map(agg(byP[ia], ia, (g, win) => win ? g[4] : g[3]).map(o => [o.k, o]));
  const common = agg(byP[ib], ib, (g, win) => win ? g[4] : g[3]).filter(o => oa.has(o.k) && o.k !== ia && o.k !== ib)
    .map(o => ({ k: o.k, b: o, a: oa.get(o.k) })).sort((x, y) => (y.a.n + y.b.n) - (x.a.n + x.b.n)).slice(0, 12);
  const ca = common.reduce((s, c) => [s[0] + c.a.w, s[1] + c.a.n], [0, 0]), cb = common.reduce((s, c) => [s[0] + c.b.w, s[1] + c.b.n], [0, 0]);
  const last5 = seq.slice(-8).map(w => `<span class="res ${w ? "W" : "L"}">${w ? "W" : "L"}</span>`).join("");
  const side = (p, r) => `<div class="side ${r ? "r" : ""}"><a class="pid" href="${pLink(p.i)}">${esc(p.id)}</a>
    <div class="pm">${tierB(p.tier)} ${raceB(p.race)} ${stB(p.st)}</div><div class="elo">ELO ${r0(p.r)}${rankAll[p.i] ? ` · #${rankAll[p.i]}` : ""} · 통산 ${p.w}-${p.l}</div></div>`;
  $("#vr").innerHTML = `<div class="duel">${side(A)}<div class="score"><b class="num ${aw > bw ? "lead" : ""}">${aw}</b><span>${js.length}<br>SETS</span><b class="num ${bw > aw ? "lead" : ""}">${bw}</b></div>${side(B, 1)}</div>
    <div class="card hl" style="margin-top:12px"><h3>현재 예상 승률<em>ELO ${r0(A.r)} vs ${r0(B.r)} · 차이 ${Math.abs(r0(A.r - B.r))}점</em></h3>
      <div class="split"><i style="width:${e * 100}%;background:var(--tc)"></i><i style="flex:1;background:var(--tc2)"></i></div>
      <div class="split-l"><span>${esc(A.id)} ${(e * 100).toFixed(1)}%</span><span>${((1 - e) * 100).toFixed(1)}% ${esc(B.id)}</span></div>
      ${js.length ? `<div style="margin-top:14px"><div class="split"><i style="width:${100 * aw / js.length}%;background:var(--tc)"></i><i style="flex:1;background:var(--tc2)"></i></div>
      <div class="split-l" style="color:var(--ink3);font-weight:500;font-size:12px"><span>실제 상대전적 ${pctS(aw, js.length)}</span><span>${pctS(bw, js.length)}</span></div></div>` : ""}</div>
    ${js.length ? `<div class="facts" style="margin-top:10px">
      <div><b>${fmtD(G[js[0]][0])}</b><span>첫 대결 · ${esc(D.leagues[G[js[0]][1]].name)}</span></div>
      <div><b>${fmtD(G[js[js.length - 1]][0])}</b><span>마지막 대결 · ${esc(P[G[js[js.length - 1]][3]].id)} 승</span></div>
      <div><b>${esc(st.who ? A.id : B.id)} ${st.cur}연승 중</b><span>현재 흐름</span></div>
      <div><b>${st.best.a} : ${st.best.b}</b><span>최장 연승 (${esc(A.id)} : ${esc(B.id)})</span></div></div>
      <div class="card" style="margin-top:10px"><h3>최근 흐름<em>${esc(A.id)} 기준 · 오른쪽이 최근</em></h3><div class="form">${last5}</div></div>` : `<div class="empty">맞대결 기록이 없습니다. 아래 공통 상대 비교와 레이팅 흐름을 참고하세요.</div>`}
    <div class="card" style="margin-top:10px"><h3>레이팅 흐름<em><span class="legend" style="display:inline;margin:0"><i style="--c:var(--tc)"></i>${esc(A.id)} <i style="--c:var(--tc2);margin-left:8px"></i>${esc(B.id)}</span></em></h3>${chart([A.h, B.h], { adj: false })}</div>
    ${js.length ? `<div class="grid c3">
      <div class="card"><h3>리그별<em>${esc(A.id)} 기준</em></h3><div class="mu">${muRows(byLg, k => esc(D.leagues[k].name.slice(0, 7)))}</div></div>
      <div class="card"><h3>연도별</h3><div class="mu">${muRows(byYr, k => k)}</div></div>
      <div class="card"><h3>종족 매치업<em>${esc(A.id)} 종족 v ${esc(B.id)} 종족</em></h3><div class="mu">${muRows(byMu, k => `<span style="color:var(--${k[0]})">${k[0]}</span>v<span style="color:var(--${k[2]})">${k[2]}</span>`)}</div></div>
    </div>
    <div class="grid c12">
      <div class="card"><h3>맵별</h3><div class="mu">${muRows(maps, k => esc((D.maps[k] || "").slice(0, 7)))}</div></div>
      <div class="card"><h3>전체 기록<em>${js.length}세트</em></h3><div class="scroll"><table class="mini"><tr><th>날짜</th><th>리그</th><th>승자</th><th class="c">종족</th><th>맵</th></tr>
        ${js.slice().reverse().map(j => { const g = G[j], aWin = g[3] === ia; return `<tr><td class="num">${fmtD(g[0])}</td><td>${esc(D.leagues[g[1]].name)}</td>
          <td><b style="color:${aWin ? "var(--tc)" : "var(--tc2)"}">${esc(P[g[3]].id)}</b></td><td class="c">${raceB(RN[aWin ? g[5] : g[6]])}<span style="color:var(--ink3);margin:0 3px">v</span>${raceB(RN[aWin ? g[6] : g[5]])}</td><td style="color:var(--ink3)">${esc(mapN(g))}</td></tr>`; }).join("")}
      </table></div></div></div>` : ""}
    ${common.length ? `<div class="h3">공통 상대<em>둘 다 상대해 본 선수 · ${esc(A.id)} ${pctS(ca[0], ca[1])} vs ${esc(B.id)} ${pctS(cb[0], cb[1])}</em></div>
      <div class="panel scroll"><table class="tbl"><thead><tr><th>상대</th><th class="r">${esc(A.id)}</th><th class="r">승률</th><th class="r">${esc(B.id)}</th><th class="r">승률</th></tr></thead><tbody>
      ${common.map(c => { const pa = pct(c.a.w, c.a.n), pb = pct(c.b.w, c.b.n); return `<tr data-k="${esc(P[c.k].k)}"><td class="nm">${esc(P[c.k].id)} ${raceB(P[c.k].race)}<span class="sub">${esc(P[c.k].tier || "")} · ELO ${r0(P[c.k].r)}</span></td>
        <td class="r num" style="font-size:17px">${c.a.w}-${c.a.l}</td><td class="r" style="color:${pa > pb ? "var(--up)" : "var(--ink3)"}">${pctS(c.a.w, c.a.n)}</td>
        <td class="r num" style="font-size:17px">${c.b.w}-${c.b.l}</td><td class="r" style="color:${pb > pa ? "var(--up)" : "var(--ink3)"}">${pctS(c.b.w, c.b.n)}</td></tr>`; }).join("")}</tbody></table></div>` : ""}`;
  $("#vr").onclick = e => { const k = e.target.closest("tr[data-k]")?.dataset.k; if (k) location.hash = `#/p/${encodeURIComponent(k)}`; };
}

/* ---------- 래더 ---------- */
function viewLadderOne(k) {
  const i = keyIdx[k], p = i != null ? P[i] : null, L = p?.lad;
  if (!L) { app.innerHTML = `<div class="empty">래더 기록이 없습니다</div>`; return; }
  const race = L.race || p.race, rec = L.recent || [], n = L.w + L.l;
  const mu = Object.entries(L.mu || {}).map(([m, v]) => ({ k: m, w: v[0], l: v[1], n: v[0] + v[1] })).sort((a, b) => b.n - a.n);
  const rw = rec.filter(x => x.w).length;
  app.style.setProperty("--tc", tc(p.tier));
  app.innerHTML = `<a class="back" href="#/ladder">← 래더</a>
    <section class="hero"><div><div class="kicker">LADDER · cwal.gg ${L.gw === 30 ? "한국 서버" : L.gw === 20 ? "아시아 서버" : ""}</div>
      <div class="id">${esc(L.toon)}</div><div class="meta">${raceB(race)} <span class="st">${esc(p.id)}</span>${L.est ? ` <span class="prov">점수 추정</span>` : ""}</div>
      <div class="form" style="margin-top:12px">${rec.slice().reverse().map(x => `<span class="res ${x.w ? "W" : "L"}">${x.w ? "W" : "L"}</span>`).join("")}</div></div>
      <div class="big"><div class="kv acc"><b class="num">${L.rating || "—"}</b><span>래더 점수</span></div>
        <div class="kv"><b class="num">${L.standing ? L.standing.toLocaleString() : "—"}</b><span>전체 순위</span></div></div></section>
    <div class="stats" style="margin-top:10px">
      <div><b class="num">${L.w}-${L.l}</b><span>이번 시즌 전적</span></div><div><b class="num">${pctS(L.w, n)}</b><span>시즌 승률</span></div>
      <div><b class="num">${rw}-${rec.length - rw}</b><span>최근 ${rec.length}경기</span></div><div><b class="num">${RACE_KO[race] || "—"}</b><span>종족</span></div></div>
    <div class="grid c2">
      <div class="card"><h3>종족별<em>이번 시즌</em></h3><div class="mu">${muRows(mu, m => `<span style="color:var(--${m[0]})">${m[0]}</span>v<span style="color:var(--${m[2]})">${m[2]}</span>`, m => `var(--${m[2]})`) || `<div class="empty">—</div>`}</div></div>
      <div class="card"><h3>최근 10경기</h3>${rec.length ? `<table class="mini"><tr><th></th><th>상대</th><th class="c">종족</th><th class="r">날짜</th></tr>
        ${rec.map(x => `<tr><td><span class="res ${x.w ? "W" : "L"}">${x.w ? "W" : "L"}</span></td><td>${esc(x.o || "")}</td><td class="c">${raceB((x.m || "")[0])}<span style="color:var(--ink3);margin:0 3px">v</span>${raceB((x.m || "")[2])}</td>
          <td class="r num">${x.t ? new Date(x.t).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) : ""}</td></tr>`).join("")}</table>` : `<div class="empty">다음 래더 갱신 때 채워집니다</div>`}</div></div>`;
}
function viewLadder(k) {
  if (k) return viewLadderOne(k);
  const L = P.filter(p => p.lad && !p.off).sort((a, b) => (b.lad.rating || 0) - (a.lad.rating || 0));
  const lu = D.meta.sources.find(s => s.name === "ladder");
  app.innerHTML = `<div class="h"><h2><small>cwal.gg 래더 점수 × 클랜 ELO · 계정 ${L.length}개 연결</small><span class="gold">Ladder</span></h2><div class="aside">래더 갱신 ${esc(lu?.updated || "—")}</div></div>
    <details class="regbox"><summary><span>순위에 안 보이나요? <b>래더 아이디 등록</b></span><i>+</i></summary>
      <div class="reg"><div class="fld"><label for="r_id">클랜 아이디</label><input id="r_id" placeholder="예: rox" autocomplete="off"></div>
        <div class="fld"><label for="r_toon">래더 계정 이름</label><input id="r_toon" placeholder="예: rox[kS]" autocomplete="off"></div>
        <div class="fld"><label for="r_tier">클랜 티어</label><select id="r_tier"><option value="">선택</option>${T.map(t => `<option>${t}</option>`).join("")}</select></div>
        <button class="btn pri" id="r_go">등록하기</button></div>
      <p class="msg" id="r_msg" style="margin:10px 0 0">cwal.gg에 있는 계정만 올라갑니다. 매일 아침 반영 · 잘못 넣은 계정은 운영진이 지울 수 있습니다.</p></details>
    <div class="panel scroll"><table class="tbl"><thead><tr><th class="r">#</th><th></th><th>선수</th><th class="r">래더</th><th class="r hide-m">전체순위</th><th class="r hide-m">시즌</th><th class="r">클랜 ELO</th></tr></thead><tbody>
    ${L.map((p, n) => `<tr data-k="${esc(p.k)}"><td class="rk r num ${n < 3 ? "t3" : ""}">${n + 1}</td><td class="stripe" style="--tc:${tc(p.tier)}"></td>
      <td class="nm">${esc(p.id)} ${raceB(p.lad.race || p.race)}<span class="sub">${esc(p.lad.toon)}</span></td>
      <td class="r rt num">${p.lad.rating || "—"}</td><td class="r hide-m num" style="font-size:16px">${p.lad.standing ? p.lad.standing.toLocaleString() + "위" : "—"}</td>
      <td class="r hide-m num" style="font-size:16px">${p.lad.w}-${p.lad.l}</td><td class="r num" style="font-size:18px;color:var(--ink2)">${r0(p.r)}</td></tr>`).join("")}
    </tbody></table></div>`;
  $(".tbl tbody").onclick = e => { const k = e.target.closest("tr[data-k]")?.dataset.k; if (k) location.hash = `#/ladder/${encodeURIComponent(k)}`; };
  $("#r_go").onclick = async () => {
    const id = $("#r_id").value.trim(), toon = $("#r_toon").value.trim(), tier = $("#r_tier").value, msg = $("#r_msg");
    if (!id || !toon || !tier) { msg.className = "msg no"; msg.textContent = "세 칸을 모두 채워 주세요."; return; }
    if (!/^[A-Za-z0-9_.\-\[\]()]{2,30}$/.test(id) || !/^[A-Za-z0-9_.\-\[\]()]{2,40}$/.test(toon)) { msg.className = "msg no"; msg.textContent = "아이디와 계정 이름은 영어·숫자로만 적어 주세요."; return; }
    $("#r_go").disabled = true; msg.className = "msg"; msg.innerHTML = `<span class="spin"></span> 보내는 중…`;
    const r = await api("/ladder/request", { id, toon, tier });
    if (r.ok) { msg.className = "msg ok"; msg.textContent = r.msg; $("#r_id").value = $("#r_toon").value = ""; $("#r_tier").value = ""; }
    else { msg.className = "msg no"; msg.textContent = r.msg || "지금은 접수가 안 됩니다. 잠시 뒤 다시 눌러 주세요."; }
    $("#r_go").disabled = false;
  };
}

/* ---------- 관리자 ---------- */
const TOK = { get: () => { try { return sessionStorage.getItem("ksEloTok") || localStorage.getItem("ksEloTok") || ""; } catch { return ""; } },
  set: (t, keep) => { try { (keep ? localStorage : sessionStorage).setItem("ksEloTok", t); } catch { } },
  clear: () => { try { sessionStorage.removeItem("ksEloTok"); localStorage.removeItem("ksEloTok"); } catch { } } };
async function api(path, body) {
  const opt = { method: body ? "POST" : "GET", headers: { "x-token": TOK.get() } };
  if (body) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
  try { const r = await fetch(API + path, opt); const j = await r.json().catch(() => ({ ok: false, msg: "응답을 읽지 못했습니다." })); if (r.status === 401 && path !== "/login") j.auth = false; return j; }
  catch (e) { return { ok: false, msg: "관리자 서버에 연결하지 못했습니다. (아직 배포 전이거나 인터넷 문제)" }; }
}
async function viewAdmin(tab) {
  if (!TOK.get() || !(await api("/me")).ok) return adminGate();
  tab = tab || "src";
  const tabs = { src: "ELO 시트 등록", league: "리그 시트 등록", games: "ELO 입력값", promo: "등급조정", lad: "래더 관리", health: "데이터" };
  app.innerHTML = `<div class="h"><h2><small>운영진 전용 · 이 화면의 내용은 공개 화면에 나오지 않습니다</small><span class="gold">운영진</span> <span class="kr">관리</span></h2>
    <div class="aside"><button class="btn sm" id="logout">로그아웃</button></div></div>
    ${D.meta.gaps.length ? `<div class="notice red"><b>!</b><div>${D.meta.gaps.map(esc).join("<br>")}</div></div>` : ""}
    <div class="seg">${Object.entries(tabs).map(([k, v]) => `<button class="${k === tab ? "on" : ""}" data-tab="${k}">${v}</button>`).join("")}</div><div id="av"></div>`;
  $(".seg").onclick = e => { const t = e.target.dataset.tab; if (t) location.hash = `#/admin/${t}`; };
  $("#logout").onclick = async () => { await api("/logout", {}); TOK.clear(); location.hash = "#/"; };
  ({ src: el => adminSources(el, false), league: el => adminSources(el, true), games: adminGames, promo: adminPromo, lad: adminLadder, health: adminHealth }[tab] || (el => adminSources(el, false)))($("#av"));
}
function adminGate() {
  app.innerHTML = `<div class="gate"><div class="kicker">ADMIN</div><h2>운영진</h2><p>관리자 아이디와 비밀번호를 넣어 주세요.</p>
    <input id="u" placeholder="아이디" autocomplete="username"><input id="pw" type="password" placeholder="비밀번호" autocomplete="current-password">
    <label class="keep"><input type="checkbox" id="keep"> 이 기기에서 로그인 유지 (30일)</label>
    <button class="btn pri" id="go" style="width:100%">들어가기</button><p id="msg" class="msg no" style="margin-top:12px"></p></div>`;
  const go = async () => {
    $("#go").disabled = true; $("#msg").className = "msg"; $("#msg").innerHTML = `<span class="spin"></span> 확인 중…`;
    const r = await api("/login", { u: $("#u").value.trim(), p: $("#pw").value, keep: $("#keep").checked });
    $("#go").disabled = false;
    if (r.ok) { TOK.set(r.token, $("#keep").checked); route(); } else { $("#msg").className = "msg no"; $("#msg").textContent = r.msg || "들어가지 못했습니다."; }
  };
  $("#go").onclick = go; $("#pw").onkeydown = e => e.key === "Enter" && go();
}
const COLS = [["date", "날짜"], ["winner", "승자"], ["loser", "패자"], ["map", "맵"], ["league", "리그(열)"], ["wrace", "승자 종족"], ["lrace", "패자 종족"], ["year", "연"], ["month", "월"], ["day", "일"]];
// live=false: ELO 데이터 시트 · live=true: 진행 중 리그 시트(사이트 '리그' 화면에 따로 나옴, 완료 → ELO 시트로 이동)
async function adminSources(el, live) {
  el.innerHTML = `<div class="loading"><span></span>불러오는 중</div>`;
  const r = await api("/sources");
  if (!r.ok) { el.innerHTML = `<div class="notice red"><b>!</b><div>${esc(r.msg)}</div></div>`; return; }
  const stat = r.stat || {};
  const pill = s => { const st = stat[s.id]; if (!s.enabled) return `<span class="pill">꺼짐</span>`;
    if (!st) return `<span class="pill wait">다음 갱신 때 반영 (매일 아침)</span>`;
    return st.ok ? `<span class="pill ok">반영됨 · ${st.games}경기</span>` : `<span class="pill no">문제: ${esc(st.msg || "확인 필요")}</span>`; };
  const all = r.sources || [], list = all.filter(x => (x.stage === "live") === !!live);
  el.innerHTML = `${live ? `<div class="notice"><b>!</b><div>지금 <b>진행 중인 리그</b>의 시트를 넣는 곳입니다. 넣으면 사이트 <b>리그</b> 화면에 KPL처럼 따로 나오고, 경기는 ELO에도 바로 반영됩니다. 리그마다 <b>방식</b>(풀리그 / 조별리그→토너먼트 / 토너먼트)을 고르면 그 방식에 맞는 표·대진표로 보여 줍니다. 리그가 끝나면 <b>완료</b>를 누르세요 — 리그 화면에서 빠지고 ELO 시트 목록으로 옮겨집니다.</div></div>` : ""}
    <div class="card hl"><h3>${live ? "진행 중 리그 시트 추가" : "ELO 시트 추가"}<em>시트 링크를 붙이면 바로 구조를 분석합니다</em></h3>
      <div class="form-grid"><div class="fld wide"><label for="s_url">구글 시트 링크</label><input id="s_url" placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=…"></div></div>
      <div class="btns"><button class="btn pri" id="s_an">시트 분석</button><span class="msg" id="s_msg">시트 공유가 「링크가 있는 모든 사용자 — 뷰어」여야 읽을 수 있습니다.</span></div>
      <div id="s_res"></div></div>
    <div class="h3">${live ? "진행 중 리그" : "등록된 ELO 시트"}<em>${list.length}개 · 매일 아침 자동 수집</em></div>
    <div class="panel srcs">${list.map(s => `<div class="src" data-id="${esc(s.id)}"><div><b>${esc(s.name)}</b>
        <div class="meta"><span>리그 <b style="font:inherit;color:var(--ink)">${esc(s.league)}</b> · 가중치 ×${s.weight}</span><span class="selectable">${esc(s.url || s.sheet)}</span>${pill(s)}</div></div>
        ${live ? `<div class="lfmt"><select class="sel" data-k="format" aria-label="방식">${[["league", "풀리그 (순위표)"], ["group", "조별리그 → 토너먼트"], ["tour", "토너먼트"]].map(([v, l]) => `<option value="${v}" ${(s.format || "league") === v ? "selected" : ""}>${l}</option>`).join("")}</select>
          <label class="tsw" ${(s.format || "league") === "group" ? "" : "hidden"}>토너먼트 시작일 <input type="date" data-k="tourStart" value="${esc(s.tourStart || "")}"></label>
          <label class="tsz" ${(s.format || "league") === "league" ? "hidden" : ""}>본선 <select class="sel" data-k="tourSize"><option value="0">자동</option>${[64, 32, 16, 8, 4].map(n => `<option value="${n}" ${+s.tourSize === n ? "selected" : ""}>${n}강</option>`).join("")}</select></label>
          <button class="btn sm" data-act="fmt">방식 저장</button></div>` : ""}
        <div class="btns" style="margin:0">${live ? `<button class="btn sm pri" data-act="done">완료</button>` : ""}<button class="btn sm" data-act="tog">${s.enabled ? "끄기" : "켜기"}</button><button class="btn sm del" data-act="del">삭제</button></div></div>`).join("") || `<div class="empty">아직 없습니다. 위에서 시트 링크를 넣어 주세요.</div>`}</div>`;
  el.querySelector(".srcs").onchange = e => { const f = e.target.closest('[data-k="format"]'); if (!f) return; const box = f.closest("[data-id]");
    box.querySelector(".tsw").hidden = f.value !== "group"; box.querySelector(".tsz").hidden = f.value === "league"; };
  el.querySelector(".srcs").onclick = async e => {
    const b = e.target.closest("[data-act]"); if (!b) return; const id = b.closest("[data-id]").dataset.id; const s = all.find(x => x.id === id);
    if (b.dataset.act === "del") { if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "정말 삭제"; return; } await api("/sources/del", { id }); }
    else if (b.dataset.act === "fmt") { const box = b.closest("[data-id]"), v = k => box.querySelector(`[data-k="${k}"]`).value;
      await api("/sources/save", { source: { ...s, format: v("format"), tourStart: v("tourStart"), tourSize: +v("tourSize") } }); }
    else if (b.dataset.act === "done") { if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "리그 끝남 — 확정"; return; } await api("/sources/save", { source: { ...s, stage: "" } }); }
    else await api("/sources/save", { source: { ...s, enabled: !s.enabled } });
    adminSources(el, live);
  };
  $("#s_an").onclick = async () => {
    const url = $("#s_url").value.trim(); if (!url) return;
    $("#s_an").disabled = true; $("#s_msg").className = "msg"; $("#s_msg").innerHTML = `<span class="spin"></span> 시트 분석 중… 탭마다 승자·패자·날짜 열을 찾고 있습니다`;
    const a = await api("/sources/analyze", { url });
    $("#s_an").disabled = false;
    if (!a.ok) { $("#s_msg").className = "msg no"; $("#s_msg").textContent = a.msg; return; }
    const good = a.tabs.filter(t => t.ok);
    $("#s_msg").className = good.length ? "msg ok" : "msg no";
    $("#s_msg").textContent = good.length ? `분석 완료: 경기 기록으로 보이는 탭 ${good.length}개를 찾았습니다.` : "경기 기록 형식을 자동으로 못 찾았습니다. 아래에서 열을 직접 골라 주세요.";
    sourceEditor($("#s_res"), a, url, () => adminSources(el, live), live ? "live" : "");
  };
}
function sourceEditor(box, a, url, done, stage = "") {
  let cur = a.tabs[0];
  const draw = () => {
    const mp = cur.mapping || { headerRow: 1, fillDown: [], cols: {} };
    const head = cur.head || [];
    const opt = v => `<option value="">없음</option>` + head.map((h, j) => `<option value="${j}" ${v === j ? "selected" : ""}>${String.fromCharCode(65 + (j % 26))}${j >= 26 ? j - 25 : ""} · ${esc(h || "(빈칸)")}</option>`).join("");
    box.innerHTML = `<div class="h3" style="margin-top:20px">분석 결과</div>
      <div class="chips" id="tabsel" style="margin-bottom:12px">${a.tabs.map(t => `<span class="chip ${t === cur ? "on" : ""}" data-gid="${esc(t.gid)}">${esc(t.name)} ${t.ok ? `· ${t.games}경기` : "· ?"}</span>`).join("")}</div>
      <div class="form-grid"><div class="fld"><label for="e_name">이름</label><input id="e_name" value="${esc(cur.name)}"></div>
        <div class="fld"><label for="e_lg">리그 이름</label><input id="e_lg" placeholder="예: KTL, KPL, 하믹팀리그" value=""></div>
        <div class="fld"><label for="e_w">가중치 (1~5)</label><input id="e_w" type="number" step="0.5" min="0" max="10" value="2"></div>
        <div class="fld"><label for="e_hr">머리줄 번호</label><input id="e_hr" type="number" min="1" value="${mp.headerRow}"></div></div>
      <div class="h3" style="font-size:16px">열 지정<em>자동으로 찾은 값 · 틀리면 고쳐 주세요</em></div>
      <div class="colmap">${COLS.map(([k, l]) => `<div class="fld"><label>${l}</label><select data-col="${k}">${opt(mp.cols?.[k] ?? null)}</select></div>`).join("")}</div>
      <label class="keep" style="display:flex;gap:8px;margin:12px 0;font-size:12.5px;color:var(--ink2)"><input type="checkbox" id="e_fill" ${mp.fillDown?.length ? "checked" : ""}> 날짜·리그가 경기 묶음 첫 줄에만 적혀 있음 (아래 줄로 채우기)</label>
      <div class="btns"><button class="btn" id="e_pv">미리보기</button><button class="btn pri" id="e_save">이대로 등록</button><span class="msg" id="e_msg"></span></div>
      <div id="e_sample">${sampleTable(cur.sample)}</div>`;
    $("#tabsel").onclick = e => { const g = e.target.closest("[data-gid]")?.dataset.gid; if (g != null) { cur = a.tabs.find(t => t.gid === g); draw(); } };
    const readMp = () => {
      const cols = {}; box.querySelectorAll("[data-col]").forEach(s => cols[s.dataset.col] = s.value === "" ? null : +s.value);
      const fill = $("#e_fill").checked ? [cols.date, cols.year, cols.month, cols.day, cols.league].filter(x => x != null) : [];
      return { headerRow: Math.max(1, +$("#e_hr").value || 1), fillDown: fill, cols };
    };
    $("#e_pv").onclick = async () => {
      $("#e_msg").innerHTML = `<span class="spin"></span> 읽는 중…`;
      const p = await api("/sources/preview", { sheet: a.sheet, gid: cur.gid, mapping: readMp() });
      if (!p.ok) { $("#e_msg").className = "msg no"; $("#e_msg").textContent = p.msg; return; }
      $("#e_msg").className = p.games ? "msg ok" : "msg no"; $("#e_msg").textContent = `${p.games}경기 인식 · 건너뜀 ${p.skipped}줄`; $("#e_sample").innerHTML = sampleTable(p.sample);
    };
    $("#e_save").onclick = async () => {
      const mp2 = readMp();
      if (mp2.cols.winner == null || mp2.cols.loser == null) { $("#e_msg").className = "msg no"; $("#e_msg").textContent = "승자·패자 열은 꼭 골라야 합니다."; return; }
      const lg = $("#e_lg").value.trim(); if (!lg) { $("#e_msg").className = "msg no"; $("#e_msg").textContent = "리그 이름을 적어 주세요."; return; }
      const s = await api("/sources/save", { source: { name: $("#e_name").value.trim(), league: lg, weight: +$("#e_w").value || 1, url, sheet: a.sheet, gid: cur.gid, mapping: mp2, enabled: true, stage } });
      if (s.ok) done(); else { $("#e_msg").className = "msg no"; $("#e_msg").textContent = s.msg; }
    };
  };
  draw();
}
const sampleTable = S => S && S.length ? `<div class="scroll" style="margin-top:12px"><table class="mini"><tr><th>날짜</th><th>승자</th><th>패자</th><th>맵</th><th>리그</th><th>종족</th></tr>
  ${S.map(g => `<tr><td class="num">${esc(g.date)}</td><td><b>${esc(g.winner)}</b></td><td>${esc(g.loser)}</td><td>${esc(g.map)}</td><td>${esc(g.league)}</td><td>${esc(g.wrace)} v ${esc(g.lrace)}</td></tr>`).join("")}</table></div>` : `<p class="msg" style="margin-top:10px">보여줄 경기가 없습니다.</p>`;
async function adminPromo(el) {
  el.innerHTML = `<div class="loading"><span></span>불러오는 중</div>`;
  const pr = await api("/promo");
  if (!pr.ok) { el.innerHTML = `<div class="notice red"><b>!</b><div>${esc(pr.msg)}</div></div>`; return; }
  let OV = pr.promo?.overrides || {};
  // 기본값: 직전 등급조정일부터 평가 · 차수는 직전 다음 번호 · 나머지는 지난번에 쓴 설정
  const last = D.adjustments.at(-1) || {}, nextName = String(last.name || "").replace(/(\d+)(차)?$/, (m0, n, c) => (+n + 1) + (c || "")) || "다음 차";
  const saved = pr.promo?.settings || {};
  const S = Object.assign({ strict: true }, D.promo, saved);
  if (!saved.window_start || (last.date && saved.window_start < last.date)) S.window_start = last.date || S.window_start;
  if (!saved.name || saved.name === last.name) S.name = nextName;
  el.innerHTML = `<div class="notice"><b>!</b><div>승격·강등 기준선과 후보는 <b>운영진만</b> 봅니다. 공개 화면에는 나오지 않습니다. 설정과 수동 지정은 서버에 저장되어 운영진끼리 같이 봅니다.</div></div>
    <div class="card"><div class="form-grid c7">
      <div class="fld"><label for="f_name">차수</label><input id="f_name" value="${esc(S.name)}"></div>
      <div class="fld"><label for="f_method">방식</label><select id="f_method"><option value="boundary">경계선(레이팅)</option><option value="quota">정원(티어 내 순위)</option></select></div>
      <div class="fld"><label for="f_ws">평가 시작일</label><input id="f_ws" type="date" value="${esc(S.window_start)}"></div>
      <div class="fld"><label for="f_min">최소 경기(기간)</label><input id="f_min" type="number" min="0" value="${S.min_window_games}"></div>
      <div class="fld"><label for="f_margin" id="l_m">경계 여유(점)</label><input id="f_margin" type="number" value="${S.margin}"></div>
      <div class="fld"><label for="f_quota" id="l_q">티어당 최대(%)</label><input id="f_quota" type="number" min="0" value="${S.quota_pct}"></div>
      <div class="fld" id="w_qn"><label for="f_qn">정원(명)</label><input id="f_qn" type="number" min="0" value="${S.quota_n}"></div>
    </div>
    <label class="keep" style="display:flex;gap:8px;margin:12px 0 0;font-size:12.5px;color:var(--ink2)"><input type="checkbox" id="f_strict" ${S.strict !== false ? "checked" : ""}> 순위 역전 막기 — 티어 안에서 ELO가 더 높은 사람이 승격 안 되면 그 아래는 승격 안 됨 (강등도 같은 방식)</label>
    <div class="btns"><button class="btn pri" id="calc">다시 계산</button><button class="btn" id="reset">수동 지정 초기화</button>
      <span class="msg" id="p_msg">직전 조정: ${esc(D.adjustments.at(-1).name)} (${esc(D.adjustments.at(-1).date)})</span></div></div>
    <div id="res"></div>
    <div class="h3">카페 공지문<em>그대로 붙여넣기</em></div>
    <div class="seg" id="oseg"><button class="on" data-o="up">승격자 발표</button><button data-o="dn">강등자 발표</button><button data-o="rank">각 티어별 순위</button></div>
    <textarea class="out" id="out" readonly></textarea>
    <div class="btns"><button class="btn pri" id="copy">복사</button></div>`;
  $("#f_method").value = S.method;
  let outMode = "up", result = null, saveT;
  const read = () => ({ name: $("#f_name").value.trim(), method: $("#f_method").value, window_start: $("#f_ws").value, min_window_games: +$("#f_min").value,
    margin: +$("#f_margin").value, quota_pct: +$("#f_quota").value, quota_n: +$("#f_qn").value, strict: $("#f_strict").checked });
  const sync = () => { const q = $("#f_method").value === "quota"; $("#w_qn").style.display = q ? "" : "none"; $("#l_m").parentElement.style.display = q ? "none" : ""; $("#l_q").parentElement.style.display = q ? "none" : ""; };
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(async () => { const s = await api("/promo", { settings: read(), overrides: OV }); $("#p_msg").className = s.ok ? "msg ok" : "msg no"; $("#p_msg").textContent = s.ok ? "서버에 저장했습니다" : s.msg; }, 500); };
  const run = save => { const s = read(); sync(); result = promote(s, OV); drawRes(s); drawOut(s); if (save) persist(); };
  const drawRes = s => {
    $("#res").innerHTML = T.map((t, ti) => { const L = result.rows.filter(r => r.ti === ti); if (!L.length) return "";
      const up = L.filter(r => r.dec === "up").length, dn = L.filter(r => r.dec === "down").length;
      const b1 = result.bound[ti - 1], b2 = result.bound[ti];
      return `<section class="tier-block" style="--tc:${tc(t)}"><header><b>${t}</b><span>${L.length}명${b1 != null ? ` · 승격선 ${r0(b1 + (s.method === "boundary" ? s.margin : 0))}` : ""}${b2 != null ? ` · 강등선 ${r0(b2 - (s.method === "boundary" ? s.margin : 0))}` : ""}</span>
        <span class="cnt"><span style="color:var(--up)">▲${up}</span><span style="color:var(--down)">▼${dn}</span></span></header>
        <div class="scroll"><table class="mini"><tr><th>#</th><th>선수</th><th class="r">ELO</th><th class="r">기간</th><th>판정</th><th>근거</th><th>수동</th></tr>
        ${L.map(r => `<tr><td class="num">${r.tr}</td><td><a href="${pLink(r.i)}"><b>${esc(P[r.i].id)}</b></a> ${raceB(P[r.i].race)}</td><td class="r num">${r0(P[r.i].r)}</td>
          <td class="r num">${r.wg}전 ${r.ww}-${r.wg - r.ww}</td>
          <td>${r.dec === "up" ? `<span class="dec up">▲ ${T[ti - 1]}</span>` : r.dec === "down" ? `<span class="dec dn">▼ ${T[ti + 1]}</span>` : `<span class="dec hold">유지</span>`}</td>
          <td style="color:var(--ink3);font-size:11.5px">${esc(r.why)}</td>
          <td><select class="ovr" data-k="${esc(P[r.i].k)}" aria-label="수동 지정">${[["", "자동"], ["up", "승격"], ["hold", "유지"], ["down", "강등"]].map(([v, l]) => `<option value="${v}" ${(OV[P[r.i].k] || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`).join("")}
        </table></div></section>`; }).join("");
  };
  $("#res").onchange = e => { const k = e.target.dataset.k; if (!k) return; if (e.target.value) OV[k] = e.target.value; else delete OV[k]; run(true); };
  const drawOut = s => {
    const head = `[kS] ${s.name} 등급조정`;
    let txt = "";
    if (outMode === "up" || outMode === "dn") {
      const dir = outMode === "up" ? "up" : "down";
      txt = `${head} ${dir === "up" ? "승격자" : "강등자"} 발표\n`;
      T.forEach((t, ti) => { const L = result.rows.filter(r => r.ti === ti && r.dec === dir); if (!L.length) return;
        txt += `\n■ ${t} → ${dir === "up" ? T[ti - 1] : T[ti + 1]} (${L.length}명)\n` + L.map(r => ` - ${P[r.i].id} (${P[r.i].race})`).join("\n") + "\n"; });
      if (!result.rows.some(r => r.dec === dir)) txt += "\n해당자 없음\n";
    } else {
      txt = `${head} 각 티어별 순위\n`;
      T.forEach((t, ti) => { const L = result.rows.filter(r => r.ti === ti); if (!L.length) return;
        txt += `\n■ ${t}\n` + L.map(r => ` ${String(r.tr).padStart(2)}. ${P[r.i].id}${r.dec === "up" ? " ▲" : r.dec === "down" ? " ▼" : ""}`).join("\n") + "\n"; });
    }
    $("#out").value = txt;
  };
  $("#oseg").onclick = e => { const o = e.target.dataset.o; if (!o) return; outMode = o; [...$("#oseg").children].forEach(b => b.classList.toggle("on", b.dataset.o === o)); drawOut(read()); };
  $("#calc").onclick = () => run(true);
  ["f_method", "f_ws", "f_min", "f_margin", "f_quota", "f_qn", "f_name", "f_strict"].forEach(id => $("#" + id).onchange = () => run(true));
  $("#reset").onclick = () => { OV = {}; run(true); };
  $("#copy").onclick = async () => { try { await navigator.clipboard.writeText($("#out").value); $("#copy").textContent = "복사됨"; } catch { $("#out").select(); document.execCommand("copy"); } setTimeout(() => $("#copy").textContent = "복사", 1200); };
  run(false);
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
    if (s.strict !== false) {          // 순위 역전 막기: 위에서부터 끊기지 않고 이어진 승격만, 아래에서부터 이어진 강등만 인정
      let go = true; R.forEach(r => { if (r.dec === "up" && !go) { r.dec = "hold"; r.why = "더 높은 순위가 승격 안 돼서 보류 (순위 역전 막기)"; } else if (r.dec !== "up") go = false; });
      go = true; R.slice().reverse().forEach(r => { if (r.dec === "down" && !go) { r.dec = "hold"; r.why = "더 낮은 순위가 강등 안 돼서 보류 (순위 역전 막기)"; } else if (r.dec !== "down") go = false; });
    }
    R.forEach(r => { const o = OV[P[r.i].k]; if (o) { if ((o === "up" && ti === 0) || (o === "down" && ti === T.length - 1)) return; r.dec = o; r.ov = true; r.why = "관리자 지정"; } });
    rows.push(...R);
  });
  return { rows, bound };
}
async function adminLadder(el) {
  el.innerHTML = `<div class="loading"><span></span>불러오는 중</div>`;
  const r = await api("/ladder");
  if (r.auth === false) return adminGate();
  const ops = r.ok ? r.ops : [], reqs = r.ok ? r.reqs : [], st = (r.ok && r.stat) || {};
  const okT = new Set((st.ok || []).map(x => (x.ladderId || "").toLowerCase())), noT = new Set((st.notfound || []).map(x => (x.ladderId || "").toLowerCase()));
  const L = P.filter(p => p.lad && !p.off).sort((a, b) => a.id.localeCompare(b.id));
  const when = t => new Date(t).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
  el.innerHTML = `${r.ok ? "" : `<div class="notice red"><b>!</b><div>${esc(r.msg || "래더 목록을 못 불러왔습니다.")}</div></div>`}
    <div class="card hl"><h3>지난 래더 갱신<em>${esc(st.updated || "아직 기록 없음")}</em></h3>
      <p class="msg">순위에 오른 계정 <b>${st.rows ?? "—"}</b>개 · 계정 못 찾은 클랜원 <b>${(st.missing || []).length}</b>명 · 등록요청 반영 <b>${(st.ok || []).length}</b> / 못 찾음 <b>${(st.notfound || []).length}</b>${(st.errors || []).length ? ` · 오류 ${st.errors.length}건` : ""}</p>
      ${(st.notfound || []).length ? `<details style="margin-top:8px"><summary class="msg">못 찾은 등록요청 보기</summary><p class="msg selectable">${st.notfound.map(x => esc(`${x.clanId} → ${x.ladderId}`)).join(" · ")}</p></details>` : ""}</div>
    <div class="h3">등록 요청<em>래더 화면에서 들어온 신청 · 매일 아침 갱신 때 cwal.gg에서 찾아 붙입니다</em></div>
    <div class="panel">${reqs.length ? `<table class="mini"><tr><th>클랜 아이디</th><th>래더 계정</th><th>티어</th><th>신청</th><th>결과</th><th></th></tr>
      ${reqs.slice().reverse().map(q => { const t = q.toon.toLowerCase();
        return `<tr><td>${esc(q.id)}</td><td class="selectable">${esc(q.toon)}</td><td>${esc(q.tier)}</td><td class="num">${when(q.t)}</td>
        <td>${okT.has(t) ? `<span class="dec up">반영됨</span>` : noT.has(t) ? `<span class="dec dn">못 찾음</span>` : `<span class="sub">대기</span>`}</td>
        <td><button class="btn sm" data-rq="${esc(q.k)}">지우기</button></td></tr>`; }).join("")}</table>` : `<div class="empty">들어온 신청이 없습니다</div>`}</div>
    <div class="card hl" style="margin-top:14px"><h3>래더 계정 직접 추가<em>[kS] 태그가 없어도 순위에 올림 · 다음 갱신에 반영</em></h3>
      <div class="reg"><div class="fld"><label for="a_id">클랜 아이디</label><input id="a_id"></div><div class="fld"><label for="a_toon">래더 계정</label><input id="a_toon" placeholder="예: rox[kS]"></div>
        <div class="fld"><label for="a_tier">티어</label><select id="a_tier"><option value="">선택</option>${T.map(t => `<option>${t}</option>`).join("")}</select></div><button class="btn pri" id="a_go">추가</button></div>
      <p class="msg" id="a_msg"></p></div>
    <div class="h3">관리자 변경 목록<em>매일 갱신 때마다 적용 · 취소하면 원래대로</em></div>
    <div class="panel">${ops.length ? `<table class="mini"><tr><th>구분</th><th>클랜 아이디</th><th>래더 계정</th><th>티어</th><th>넣은 때</th><th></th></tr>
      ${ops.slice().reverse().map(o => `<tr><td>${o.act === "del" ? `<span class="dec dn">빼기</span>` : `<span class="dec up">추가</span>`}</td><td>${esc(o.id)}</td><td class="selectable">${esc(o.toon)}</td><td>${esc(o.tier || "")}</td>
        <td class="num">${when(o.t)}</td><td><button class="btn sm" data-undo="${esc(o.k)}">취소</button></td></tr>`).join("")}</table>` : `<div class="empty">변경이 없습니다</div>`}</div>
    <div class="h3">현재 연결된 계정<em>${L.length}개 · 빼기를 누르면 다음 갱신 때 래더 순위에서 빠집니다</em></div>
    <div class="bar"><label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="lq" placeholder="아이디·계정 검색"></label></div>
    <div class="panel scroll"><table class="tbl" id="lt"><tbody></tbody></table></div>`;
  const draw = () => { const q = $("#lq").value.trim().toLowerCase();
    $("#lt tbody").innerHTML = L.filter(p => !q || p.id.toLowerCase().includes(q) || p.lad.toon.toLowerCase().includes(q)).map(p => {
      const pend = ops.find(o => o.toon.toLowerCase() === p.lad.toon.toLowerCase() && o.act === "del");
      return `<tr class="static"><td class="stripe" style="--tc:${tc(p.tier)}"></td><td class="nm">${esc(p.id)}<span class="sub selectable">${esc(p.lad.toon)}</span></td><td class="r num" style="font-size:18px">${p.lad.rating || "—"}</td>
        <td class="r">${pend ? `<span class="dec dn">빼기 대기</span>` : `<button class="btn sm del" data-del="${esc(p.lad.toon)}" data-id="${esc(p.id)}">빼기</button>`}</td></tr>`; }).join(""); };
  draw(); $("#lq").oninput = draw;
  const say = (t, ok) => { $("#a_msg").className = ok ? "msg ok" : "msg no"; $("#a_msg").textContent = t; };
  $("#a_go").onclick = async () => { const id = $("#a_id").value.trim(), toon = $("#a_toon").value.trim(), tier = $("#a_tier").value;
    if (!toon) return say("래더 계정 이름을 적어 주세요.");
    const s = await api("/ladder/save", { act: "add", id, toon, tier }); if (s.ok) adminLadder(el); else say(s.msg); };
  el.onclick = async e => {
    const u = e.target.closest("[data-undo]"); if (u) { await api("/ladder/undo", { k: u.dataset.undo }); return adminLadder(el); }
    const q = e.target.closest("[data-rq]"); if (q) { await api("/ladder/reqdel", { k: q.dataset.rq }); return adminLadder(el); }
    const d = e.target.closest("[data-del]"); if (d) { if (d.dataset.sure !== "1") { d.dataset.sure = "1"; d.textContent = "정말 빼기"; return; }
      const s = await api("/ladder/save", { act: "del", toon: d.dataset.del, id: d.dataset.id }); if (s.ok) adminLadder(el); else say(s.msg); }
  };
}
async function adminHealth(el) {
  el.innerHTML = `<div class="loading"><span></span>불러오는 중</div>`;
  const r = await api("/sources"), c = r.cafe || {}, st = (r.stat || {}).cafe;
  const cafe = `<div class="h3">카페 ELO 결과입력 게시판<em>매일 아침 자동 수집</em></div>
    <div class="card">${st ? `<p class="msg ${st.ok ? "ok" : "no"}">${esc(st.at || "")} · ${st.ok ? `${st.games}경기 인식` : esc(st.msg || "실패")}</p>
      ${st.unparsed?.length ? `<p class="msg">형식을 못 읽은 글 ${Math.max(st.skipped || 0, st.unparsed.length)}개${(st.skipped || 0) > st.unparsed.length ? ` 중 최근 ${st.unparsed.length}개` : ""} (줄을 누르면 카페 글이 열립니다)</p><table class="mini cafeun"><tr><th>날짜</th><th>경기 (글쓴이 vs 상대)</th></tr>${st.unparsed.map(u => {
        const t = String(u.title || "").trim(), w = String(u.writer || "").trim(), url = `https://cafe.naver.com/ca-fe/cafes/${encodeURIComponent(c.clubid || "30800617")}/articles/${encodeURIComponent(u.articleId)}`;
        return `<tr><td class="num">${esc((u.date || "").slice(5).replace("-", "."))}</td><td><a href="${url}" target="_blank" rel="noopener">${/^vs\b/i.test(t) ? `<b>${esc(w || "?")}</b> ${esc(t)}` : `${esc(t)} <span style="color:var(--ink3)">· 글쓴이 ${esc(w || "?")}</span>`}</a></td></tr>`; }).join("")}</table>` : ""}` : `<p class="msg">아직 수집한 적이 없습니다.</p>`}</div>`;
  el.innerHTML = `<div class="h3" style="margin-top:0">출처별 상태</div><div class="panel scroll"><table class="tbl"><thead><tr><th>출처</th><th>상태</th><th class="r">행</th></tr></thead><tbody>
    ${D.meta.sources.map(s => `<tr class="static"><td>${esc(s.label)}</td><td style="color:${/불가|실패/.test(s.status) ? "var(--down)" : "var(--ink2)"}">${esc(s.status)}</td><td class="r num" style="font-size:16px">${s.rows}</td></tr>`).join("")}</tbody></table></div>
    ${D.meta.gaps.length ? `<div class="notice red" style="margin-top:12px"><b>!</b><div>${D.meta.gaps.map(esc).join("<br>")}</div></div>` : ""}${cafe}`;
}

const LEAGUES = () => ["ELO", ...D.leagues.map(l => l.name).filter(n => n !== "ELO"), "KTL"].filter((x, i, a) => a.indexOf(x) === i);
function gameForm(v) {
  const races = sel => `<option value="">-</option>${RN.map(r => `<option ${sel === r ? "selected" : ""}>${r}</option>`).join("")}`;
  return `<div class="form-grid c7 gf" style="padding:10px 0">
    <div class="fld"><label>날짜</label><input data-f="date" type="date" value="${esc(v.date)}"></div>
    <div class="fld"><label>리그</label><select data-f="league">${LEAGUES().map(l => `<option ${l === v.league ? "selected" : ""}>${esc(l)}</option>`).join("")}${LEAGUES().includes(v.league) ? "" : `<option selected>${esc(v.league)}</option>`}</select></div>
    <div class="fld"><label>맵</label><select data-f="map"><option value="">확인불가</option>${D.maps.map(m => `<option ${m === v.map ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></div>
    <div class="fld"><label>승자</label><input data-f="winner" value="${esc(v.winner)}"></div>
    <div class="fld"><label>승자 종족</label><select data-f="wrace">${races(v.wrace)}</select></div>
    <div class="fld"><label>패자</label><input data-f="loser" value="${esc(v.loser)}"></div>
    <div class="fld"><label>패자 종족</label><select data-f="lrace">${races(v.lrace)}</select></div>
    <div class="btns" style="grid-column:1/-1;margin:0"><button class="btn pri sm" data-save="1">저장</button><button class="btn sm" data-cancel="1">취소</button><span class="msg gm"></span></div></div>`;
}
const readForm = el => { const o = {}; el.querySelectorAll("[data-f]").forEach(x => o[x.dataset.f] = x.value.trim()); return o; };
const validGame = o => !/^[A-Za-z0-9_.\-]{2,30}$/.test(o.winner) || !/^[A-Za-z0-9_.\-]{2,30}$/.test(o.loser) ? "아이디는 영어·숫자로만" : o.winner.toLowerCase() === o.loser.toLowerCase() ? "승자와 패자가 같습니다" : !o.date ? "날짜를 넣어 주세요" : "";
// ELO 입력값: 들어온 모든 경기를 최근 순으로, 년·월 필터 · 줄마다 수정/삭제 (다음 갱신 때 반영)
const AG = { ym: "", lg: "", q: "" };
async function adminGames(el) {
  el.innerHTML = `<div class="loading"><span></span>불러오는 중</div>`;
  const r = await api("/fix");
  if (!r.ok) { el.innerHTML = `<div class="notice red"><b>!</b><div>${esc(r.msg)}</div></div>`; return; }
  const fixes = r.list || [], fixed = new Map(fixes.map(f => [f.sig, f]));
  const yms = [...new Set(G.map(g => isoD(g[0]).slice(0, 7)))].sort().reverse();
  if (!AG.ym || !yms.includes(AG.ym)) AG.ym = yms[0] || "";
  const years = [...new Set(yms.map(x => x.slice(0, 4)))];
  el.innerHTML = `<div class="notice"><b>!</b><div>들어온 모든 경기(시트·카페 어디서 왔든)입니다. 잘못된 경기는 <b>수정</b>·<b>삭제</b>하세요. <b>다음 아침 갱신 때</b> 순위가 다시 계산됩니다.</div></div>
    <div class="bar" style="flex-wrap:wrap;gap:8px">
      <select class="sel" id="g_y" aria-label="년">${years.map(y => `<option ${AG.ym.startsWith(y) ? "selected" : ""}>${y}</option>`).join("")}<option value="all">전체 기간</option></select>
      <select class="sel" id="g_m" aria-label="월"></select>
      <select class="sel" id="g_l" aria-label="리그"><option value="">전체 리그</option>${D.leagues.map((l, k) => `<option value="${k}" ${AG.lg === String(k) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>
      <label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="g_q" placeholder="선수 아이디" value="${esc(AG.q)}" autocomplete="off"></label></div>
    <div class="h3" id="g_h"></div>
    <div class="panel scroll"><table class="mini" id="gl"><tbody></tbody></table></div>
    <button class="more" id="g_more">더 보기</button>
    ${fixes.length ? `<details class="regbox" style="margin-top:14px"><summary><span>고친 경기 <b>${fixes.length}건</b> · 되돌리기</span><i>+</i></summary><div class="scroll"><table class="mini"><tr><th>구분</th><th>원래 경기</th><th>바꾼 내용</th><th></th></tr>
      ${fixes.slice().reverse().map(f => `<tr><td>${f.act === "del" ? `<span class="dec dn">삭제</span>` : `<span class="dec up">수정</span>`}</td><td>${esc(f.view || f.sig.split("#")[0].replaceAll("|", " · "))}</td>
        <td>${f.data ? esc(`${f.data.date} ${f.data.league} ${f.data.winner} 승 (vs ${f.data.loser}) ${f.data.map || "확인불가"}`) : "—"}</td>
        <td><button class="btn sm" data-undo="${esc(f.sig)}">되돌리기</button></td></tr>`).join("")}</table></div></details>` : ""}`;
  const view = g => `${isoD(g[0])} ${D.leagues[g[1]].name} ${P[g[3]].id} 승 (vs ${P[g[4]].id}) ${mapN(g)}`;
  const months = () => { const y = $("#g_y").value; $("#g_m").disabled = y === "all";
    $("#g_m").innerHTML = `<option value="">${y === "all" ? "-" : "전체 월"}</option>` + yms.filter(x => x.startsWith(y)).map(x => `<option value="${x}" ${AG.ym === x ? "selected" : ""}>${+x.slice(5)}월</option>`).join(""); };
  let lim = 200;
  const draw = () => {
    const y = $("#g_y").value, m = $("#g_m").value; AG.ym = m || (y === "all" ? "" : y); AG.lg = $("#g_l").value; AG.q = $("#g_q").value.trim().toLowerCase();
    const ps = AG.q.length >= 2 ? new Set(P.filter(p => p.id.toLowerCase().includes(AG.q)).map(p => p.i)) : null;
    const js = [];
    for (let j = G.length - 1; j >= 0; j--) { const g = G[j];
      if (y !== "all" && !isoD(g[0]).startsWith(m || y)) continue;
      if (AG.lg !== "" && g[1] !== +AG.lg) continue;
      if (ps && !ps.has(g[3]) && !ps.has(g[4])) continue;
      js.push(j); }
    $("#g_h").innerHTML = `${y === "all" ? "전체 기간" : m ? `${m.slice(0, 4)}년 ${+m.slice(5)}월` : `${y}년`}<em>${js.length.toLocaleString()}경기 · 최근 순</em>`;
    $("#gl tbody").innerHTML = `<tr><th>날짜</th><th>리그</th><th>승자</th><th>패자</th><th>맵</th><th class="hide-m">출처</th><th></th></tr>` + js.slice(0, lim).map(j => { const g = G[j], f = fixed.get(sig(g));
      return `<tr data-j="${j}"><td class="num">${isoD(g[0]).slice(5)}</td><td>${esc(D.leagues[g[1]].name)}</td><td><b>${esc(P[g[3]].id)}</b> ${raceB(RN[g[5]])}</td><td>${esc(P[g[4]].id)} ${raceB(RN[g[6]])}</td><td style="color:var(--ink3)">${esc(mapN(g))}</td><td class="hide-m" style="color:var(--ink3);font-size:11px">${esc(D.srcs?.[g[9]] || "")}</td>
        <td style="white-space:nowrap">${f ? `<span class="pill wait">${f.act === "del" ? "삭제 예정" : "수정 예정"}</span>` : `<button class="btn sm" data-edit="1">수정</button> <button class="btn sm del" data-del="1">삭제</button>`}</td></tr><tr class="ed" hidden><td colspan="7"></td></tr>`; }).join("")
      + (js.length ? "" : `<tr><td colspan="7" class="empty">경기가 없습니다</td></tr>`);
    $("#g_more").style.display = js.length > lim ? "" : "none";
  };
  months(); draw();
  $("#g_y").onchange = () => { lim = 200; AG.ym = $("#g_y").value === "all" ? "" : (yms.find(x => x.startsWith($("#g_y").value)) || ""); months(); draw(); };
  $("#g_m").onchange = $("#g_l").onchange = () => { lim = 200; draw(); };
  $("#g_q").oninput = () => { lim = 200; draw(); };
  $("#g_more").onclick = () => { lim += 300; draw(); };
  el.onclick = async e => {
    const u = e.target.closest("[data-undo]"); if (u) { await api("/fix/del", { sig: u.dataset.undo }); return adminGames(el); }
    const row = e.target.closest("tr[data-j]") || e.target.closest("tr.ed")?.previousElementSibling; if (!row || !row.dataset.j) return;
    const g = G[+row.dataset.j], ed = row.nextElementSibling, sg = sig(g);
    if (e.target.closest("[data-del]")) { const b = e.target.closest("[data-del]"); if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "정말 삭제"; return; }
      const s2 = await api("/fix/save", { sig: sg, act: "del", view: view(g) }); if (s2.ok) adminGames(el); return; }
    if (e.target.closest("[data-edit]")) { ed.hidden = false; ed.firstElementChild.innerHTML = gameForm({ date: isoD(g[0]), league: D.leagues[g[1]].name, map: g[2] >= 0 ? D.maps[g[2]] : "", winner: P[g[3]].id, loser: P[g[4]].id, wrace: RN[g[5]] || "", lrace: RN[g[6]] || "" }); return; }
    if (e.target.closest("[data-cancel]")) { ed.hidden = true; return; }
    if (e.target.closest("[data-save]")) { const o = readForm(ed), bad = validGame(o); if (bad) { ed.querySelector(".gm").className = "msg no gm"; ed.querySelector(".gm").textContent = bad; return; }
      const s2 = await api("/fix/save", { sig: sg, act: "edit", data: o, view: view(g) }); if (s2.ok) adminGames(el); else ed.querySelector(".gm").textContent = s2.msg; }
  };
}

/* ---------- 기준 ---------- */
function viewAbout() {
  const lw = D.leagues.slice().sort((a, b) => b.w - a.w);
  app.innerHTML = `<div class="h"><h2><small>이 보드가 순위를 매기는 방법</small>How it <span class="gold">works</span></h2></div><div class="prose">
  <h3>1. 레이팅</h3><p>모든 세트를 한꺼번에 놓고 <b>가장 그럴듯한 실력값</b>을 찾는 방식(브래들리-테리, ELO와 같은 400점 척도)입니다. A가 B를 이길 확률 = <code>1 / (1 + 10^((B−A)/400))</code>. 경기 순서에 따라 점수가 흔들리는 일반 ELO와 달리, 같은 기록이면 언제 계산해도 같은 값이 나옵니다.</p>
  <p><b>오래된 경기일수록 가볍게</b>: 가중치 = <code>0.5^(경과일/${D.meta.halfLife})</code>. ${D.meta.halfLife}일 지난 경기는 절반, 2년이면 1/4입니다. 재가입자도 예전 기록이 그대로 남아 이어서 계산됩니다.</p>
  <p><b>대회 가중치</b>: 큰 무대일수록 더 무겁게 반영합니다 (기존 V5 가중치의 제곱근 적용).</p>
  <table><tr><th>리그</th><th>V5 가중치</th><th>적용</th></tr>${lw.map(l => `<tr><td>${esc(l.name)}</td><td>×${l.w}</td><td>×${Math.sqrt(l.w).toFixed(2)}</td></tr>`).join("")}</table>
  <p><b>출발점</b>: 처음 기록이 적은 선수는 현재 티어를 출발점으로 삼고, 경기가 쌓일수록 실제 성적이 그 자리를 대신합니다.</p>
  <p><b>정식 순위</b>: 통산 ${D.meta.rankedMinGames || 5}세트 이상, 최근 경기 기준 유효경기 ${D.meta.rankedMinEff} 이상. 미달이면 '잠정'으로 표시되고 순위 번호가 붙지 않습니다.</p>
  <h3>2. 신원</h3><p>[kS] 표기와 대소문자는 무시합니다. 닉네임 변경은 같은 사람으로 합칩니다. 주종족이 아닌 종족으로 치른 세트는 <b>부종 프로필</b>로 따로 계산합니다. 현재 명단에 있으면 활동, '휴면'이면 휴면, 명단에 없으면 탈퇴·외부로 표시하되 기록은 지우지 않습니다.</p>
  <h3>3. 등급조정</h3><p>승격·강등은 <b>운영진이 결정</b>합니다. 판단에 쓰는 기준선은 공개하지 않습니다. 순위에 맞춰 일부러 경기를 조절하는 일을 막기 위해서입니다.</p>
  <h3>4. 갱신</h3><p>매일 새벽 자동으로 모든 공식리그 시트와 네이버 카페 'ELO 결과입력' 게시판의 ELO 경기를 모아 다시 계산합니다. 맵이 기록되지 않은 경기는 '확인불가'로 표시합니다.</p>
  </div>`;
}

/* ---------- 시작 ---------- */
async function load() {
  try {
    const r = await fetch("d.bin", { cache: "no-cache" });
    if (!r.ok) throw 0;
    const b = Uint8Array.from(atob((await r.text()).trim()), c => c.charCodeAt(0)), k = new TextEncoder().encode(PACK_KEY);
    for (let i = 0; i < b.length; i++) b[i] ^= k[i % k.length] ^ (i * 31 & 255);
    return JSON.parse(new TextDecoder().decode(b));
  } catch { return (await fetch("data.json", { cache: "no-cache" })).json(); }
}
load().then(d => { prep(d); route(); })
  .catch(e => { app.innerHTML = `<div class="empty">데이터를 불러오지 못했습니다 (${esc(e.message)})</div>`; });
})();
