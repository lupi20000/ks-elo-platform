// kS ELO 관리자 서버
//
// 하는 일
//  1) 관리자 로그인 (아이디·비번 → 출입증)
//  2) 공식리그 시트 링크 보관 + 링크를 넣으면 바로 '시트 분석' (어느 열이 승자·패자·날짜인지 찾아냄)
//  3) 카페 ELO 결과입력 게시판 설정 보관
//  4) 등급조정 설정·수동 지정 보관 (관리자만 읽고 쓴다)
//  (래더 계정 추가/빼기는 사이트가 기존 래더 중계소 ks-replay 에 직접 보낸다)
//
// 매일 새벽 깃허브 자동실행이 이 보관함(KV)을 읽어 데이터를 다시 계산한다.

// 비밀번호는 원문 대신 '소금 친 해시'만 둔다 (PBKDF2-SHA256, 10만 번)
const 소금 = 'cf595fbf26afa545feac6ef46e9a494d';
// 카페 글 보내기용 열쇠(오라클 서버 .env 에만 원문이 있음)의 SHA-256
const 수집열쇠 = '38b5c6cb25af3bbe8f017f0840e22115272d2cf39e8f373174cfb7a84f92fac0';
const 정답 = '25999dda87e97b5b771f0965bf3a21d8e24604238973363e111e9815aef662f8';

const 머리 = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-token',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'cache-control': 'no-store',
};
const 답 = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: 머리 });
const 짧게 = (s, n) => String(s == null ? '' : s).trim().slice(0, n || 60);

async function 해시(u, p) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(u + '\n' + p), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(소금.match(/../g).map(h => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function 같나(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function 읽기(env, k, 기본) {
  try { const v = await env.KSDATA.get(k); return v == null ? 기본 : JSON.parse(v); } catch (e) { return 기본; }
}
const 쓰기 = (env, k, v) => env.KSDATA.put(k, JSON.stringify(v));

async function 관리자냐(env, req) {
  const t = req.headers.get('x-token');
  if (!t || !/^[0-9a-f]{32}$/.test(t)) return false;
  return (await env.KSDATA.get('elo:sess:' + t)) !== null;
}

// ───────── 시트 분석 ─────────

function 시트주소풀기(url) {
  const m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/) || String(url || '').match(/^([a-zA-Z0-9_-]{30,})$/);
  if (!m) return null;
  const g = String(url).match(/[#&?]gid=(\d+)/);
  return { sheet: m[1], gid: g ? g[1] : '' };
}

function csv읽기(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function 가져오기(u) {
  const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0' }, redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function 탭목록(sheet) {
  const h = await 가져오기(`https://docs.google.com/spreadsheets/d/${sheet}/htmlview`);
  const out = [];
  const re = /\{name:\s*"((?:[^"\\]|\\.)*)"[^}]*?gid:\s*"(\d+)"/g;
  let m;
  while ((m = re.exec(h))) out.push({ name: m[1].replace(/\\x26/g, '&').replace(/\\(.)/g, '$1'), gid: m[2] });
  return out;
}

// 날짜 글자를 YYYY-MM-DD 로 (2026-08-31 · 2026.8.31 · 26. 8. 31. (월) · 2026/8/31)
function 날짜(s) {
  s = String(s || '').trim();
  let m = s.match(/(\d{2,4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!m) return null;
  let y = +m[1]; if (y < 100) y += 2000;
  const mo = +m[2], d = +m[3];
  if (y < 2015 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const 열이름 = {
  winner: [/^승자$/, /승리\s*선수/, /^winner$/i, /^승리자$/, /^win$/i, /승자\s*아이디/],
  loser: [/^패자$/, /패배\s*선수/, /^loser$/i, /^패배자$/, /^lose$/i, /패자\s*아이디/],
  date: [/^날짜$/, /^일자$/, /^date$/i, /경기\s*일/, /^일시$/],
  year: [/^연$/, /^년$/, /^year$/i, /^연도$/],
  month: [/^월$/, /^month$/i],
  day: [/^일$/, /^day$/i],
  map: [/^맵$/, /^map$/i, /맵\s*이름/],
  league: [/^리그$/, /^대회$/, /리그\s*구분/, /^match$/i, /^league$/i, /^대회명$/],
};

function 열찾기(rows) {
  // 머리줄: 앞 15줄 중 열 이름이 가장 많이 맞는 줄
  let best = { score: 0, idx: -1, cols: {} };
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const r = rows[i].map(c => String(c || '').trim());
    const cols = {}; let score = 0;
    for (const [key, pats] of Object.entries(열이름)) {
      const j = r.findIndex(c => c && pats.some(p => p.test(c)));
      if (j >= 0) { cols[key] = j; score += key === 'winner' || key === 'loser' ? 3 : 1; }
    }
    if (score > best.score) best = { score, idx: i, cols };
  }
  if (best.idx < 0 || best.cols.winner == null || best.cols.loser == null) return null;
  const head = rows[best.idx].map(c => String(c || '').trim());
  const cols = best.cols;
  // 종족·티어 칸: 승자 뒤에 처음 나오는 것 = 승자 것, 패자 뒤 = 패자 것
  // '승자 종족' 처럼 이름에 승자/패자가 붙은 칸을 먼저 찾고, 없으면 선수 칸 바로 뒤에서 찾는다
  const 이름으로 = re => { const j = head.findIndex(c => re.test(c)); return j >= 0 ? j : null; };
  const 쓴칸 = new Set([cols.winner, cols.loser]);
  const 뒤에서2 = (from, re) => { for (let j = from + 1; j < Math.min(head.length, from + 5); j++) if (!쓴칸.has(j) && re.test(head[j]) && !/승자|패자|winner|loser/i.test(head[j])) return j; return null; };
  cols.wrace = 이름으로(/(승자|winner).*(종족|race)/i) ?? 뒤에서2(cols.winner, /종족|race/i);
  cols.lrace = 이름으로(/(패자|loser).*(종족|race)/i) ?? 뒤에서2(cols.loser, /종족|race/i);
  cols.wtier = 이름으로(/(승자|winner).*(티어|tier)/i) ?? 뒤에서2(cols.winner, /티어|tier|등급/i);
  cols.ltier = 이름으로(/(패자|loser).*(티어|tier)/i) ?? 뒤에서2(cols.loser, /티어|tier|등급/i);
  for (const k of ['date', 'year', 'month', 'day', 'map', 'league', 'wrace', 'lrace', 'wtier', 'ltier']) if (cols[k] === undefined) cols[k] = null;
  return { headerRow: best.idx + 1, cols, head };
}

function 적용(rows, mp, limit) {
  const c = mp.cols, out = [], fill = {};
  let rowsSeen = 0, skipped = 0;
  for (let i = mp.headerRow; i < rows.length; i++) {
    const r = rows[i];
    for (const j of mp.fillDown || []) { const v = String(r[j] || '').trim(); if (v) fill[j] = v; }
    const get = j => j == null ? '' : (String(r[j] || '').trim() || ((mp.fillDown || []).includes(j) ? fill[j] || '' : ''));
    const w = get(c.winner), l = get(c.loser);
    if (!w && !l) continue;
    rowsSeen++;
    let d = c.date != null ? 날짜(get(c.date)) : null;
    if (!d && c.year != null) d = 날짜(`${get(c.year)}-${get(c.month)}-${get(c.day)}`);
    if (!w || !l || !d || w === l || /\?/.test(w + l)) { skipped++; continue; }
    out.push({ date: d, winner: w, loser: l, map: get(c.map), league: get(c.league), wrace: get(c.wrace), lrace: get(c.lrace) });
  }
  return { games: out.slice(-(limit || 1e9)), count: out.length, rows: rowsSeen, skipped };
}

async function 분석(url) {
  const a = 시트주소풀기(url);
  if (!a) return { ok: false, msg: '구글 시트 주소가 아닙니다. 시트 화면의 주소창 링크를 그대로 붙여 주세요.' };
  let tabs = [];
  try { tabs = await 탭목록(a.sheet); } catch (e) {
    return { ok: false, msg: '시트를 열 수 없습니다. 공유를 「링크가 있는 모든 사용자 — 뷰어」로 바꿔 주세요. (' + e.message + ')' };
  }
  if (!tabs.length) tabs = [{ name: '(첫 탭)', gid: a.gid || '0' }];
  if (a.gid) tabs.sort((x, y) => (y.gid === a.gid) - (x.gid === a.gid));
  const res = [];
  for (const t of tabs.slice(0, 12)) {
    try {
      const rows = csv읽기(await 가져오기(`https://docs.google.com/spreadsheets/d/${a.sheet}/gviz/tq?tqx=out:csv&gid=${t.gid}`));
      const mp = 열찾기(rows);
      if (!mp) { res.push({ name: t.name, gid: t.gid, rows: rows.length, ok: false, head: (rows[0] || []).slice(0, 26) }); continue; }
      // 날짜가 듬성듬성(블록 머리줄에만) 있으면 아래로 채운다
      const body = rows.slice(mp.headerRow).filter(r => mp.cols.winner != null && String(r[mp.cols.winner] || '').trim());
      const dc = mp.cols.date ?? mp.cols.year;
      mp.fillDown = [];
      if (dc != null && body.length) {
        const filled = body.filter(r => String(r[dc] || '').trim()).length;
        if (filled / body.length < 0.6) {
          mp.fillDown = [dc, mp.cols.month, mp.cols.day, mp.cols.league].filter(x => x != null);
        }
      }
      const ap = 적용(rows, mp, 6);
      res.push({ name: t.name, gid: t.gid, rows: rows.length, ok: ap.count > 0, games: ap.count, skipped: ap.skipped,
        mapping: { headerRow: mp.headerRow, fillDown: mp.fillDown, cols: mp.cols }, head: mp.head.slice(0, 30), sample: ap.games });
    } catch (e) {
      res.push({ name: t.name, gid: t.gid, ok: false, msg: e.message });
    }
  }
  res.sort((x, y) => (y.games || 0) - (x.games || 0));
  return { ok: true, sheet: a.sheet, gid: a.gid, tabs: res };
}

// 관리자가 열을 직접 고쳤을 때 미리보기
async function 미리보기(sheet, gid, mapping) {
  const rows = csv읽기(await 가져오기(`https://docs.google.com/spreadsheets/d/${sheet}/gviz/tq?tqx=out:csv&gid=${gid}`));
  const ap = 적용(rows, mapping, 6);
  return { ok: true, games: ap.count, skipped: ap.skipped, sample: ap.games, head: (rows[mapping.headerRow - 1] || []).slice(0, 30) };
}

// ───────── 본체 ─────────

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const 길 = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: 머리 });
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

    if (길 === '/') return 답({ ok: true, name: 'kS ELO 관리자 서버' });

    // 로그인 — 10번 틀리면 10분 잠금
    if (길 === '/login' && req.method === 'POST') {
      if (await env.KSDATA.get('elo:lock')) return 답({ ok: false, msg: '여러 번 틀려서 잠겼습니다. 10분 뒤에 다시 해 주세요.' }, 429);
      const h = await 해시(짧게(body.u, 60), String(body.p || '').slice(0, 100));
      if (!같나(h, 정답)) {
        const n = parseInt((await env.KSDATA.get('elo:fail')) || '0', 10) + 1;
        await env.KSDATA.put('elo:fail', String(n), { expirationTtl: 600 });
        if (n >= 10) await env.KSDATA.put('elo:lock', '1', { expirationTtl: 600 });
        return 답({ ok: false, msg: '아이디나 비밀번호가 틀렸습니다.' }, 401);
      }
      await env.KSDATA.delete('elo:fail');
      const t = crypto.randomUUID().replace(/-/g, '');
      await env.KSDATA.put('elo:sess:' + t, '1', { expirationTtl: body.keep ? 2592000 : 43200 });
      return 답({ ok: true, token: t });
    }
    if (길 === '/me') return 답({ ok: await 관리자냐(env, req) });

    // 카페 'ELO 결과입력' 게시판 글 받기 — 오라클 서버의 카페 봇(로그인된 계정)이 매일 보낸다
    if (길 === '/cafe/ingest' && req.method === 'POST') {
      const k = req.headers.get('x-ingest-key') || '';
      const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(k)))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (!같나(h, 수집열쇠)) return 답({ ok: false, msg: '열쇠가 맞지 않습니다.' }, 401);
      const M = await 읽기(env, 'elo:cafeposts', {});
      let n = 0;
      for (const x of (body.posts || []).slice(0, 300)) {
        const id = String(x.articleId || '').replace(/\D/g, '');
        if (!id) continue;
        M[id] = { t: 짧게(x.title, 120), d: 짧게(x.date, 10), w: 짧게(x.writer, 30), b: String(x.body || '').slice(0, 2500) };
        n++;
      }
      const keys = Object.keys(M).sort((a, b) => +a - +b);
      while (keys.length > 6000) delete M[keys.shift()];
      await 쓰기(env, 'elo:cafeposts', M);
      return 답({ ok: true, stored: n, total: Object.keys(M).length });
    }

    // ELO 결과 입력 (공개) — 사이트의 입력 양식이 보낸다. 다음 새벽 갱신 때 반영
    if (길 === '/elo/submit' && req.method === 'POST') {
      const ip = req.headers.get('cf-connecting-ip') || 'x';
      const rk = 'elo:rl:' + ip;
      const cnt = parseInt((await env.KSDATA.get(rk)) || '0', 10);
      if (cnt >= 40) return 답({ ok: false, msg: '한 시간에 너무 많이 보냈습니다. 잠시 뒤에 다시 해 주세요.' }, 429);
      const 아이디 = /^[A-Za-z0-9_.\-]{2,30}$/;
      const g = { date: 짧게(body.date, 10), league: 짧게(body.league, 30), map: 짧게(body.map, 40),
        winner: 짧게(body.winner, 30), loser: 짧게(body.loser, 30), wrace: 짧게(body.wrace, 1).toUpperCase(), lrace: 짧게(body.lrace, 1).toUpperCase() };
      const d = new Date(g.date + 'T00:00:00Z'), now = Date.now();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(g.date) || isNaN(d) || d.getTime() > now + 864e5 || d.getTime() < now - 120 * 864e5)
        return 답({ ok: false, msg: '날짜가 올바르지 않습니다. (최근 120일 안의 날짜만)' }, 400);
      if (!아이디.test(g.winner) || !아이디.test(g.loser)) return 답({ ok: false, msg: '아이디는 영어·숫자로만 적어 주세요.' }, 400);
      if (g.winner.toLowerCase() === g.loser.toLowerCase()) return 답({ ok: false, msg: '승자와 패자가 같습니다.' }, 400);
      if (!g.league) return 답({ ok: false, msg: '리그를 골라 주세요.' }, 400);
      for (const k of ['wrace', 'lrace']) if (!/^[PTZ]?$/.test(g[k])) g[k] = '';
      const L = await 읽기(env, 'elo:submits', []);
      const dup = L.find(x => x.date === g.date && x.winner.toLowerCase() === g.winner.toLowerCase() && x.loser.toLowerCase() === g.loser.toLowerCase() && x.map === g.map && now - x.t < 600000);
      if (dup) return 답({ ok: false, msg: '방금 같은 결과가 이미 들어왔습니다.' }, 409);
      L.push({ k: crypto.randomUUID().slice(0, 8), t: now, ...g });
      while (L.length > 8000) L.shift();
      await 쓰기(env, 'elo:submits', L);
      await env.KSDATA.put(rk, String(cnt + 1), { expirationTtl: 3600 });
      return 답({ ok: true, msg: '접수되었습니다. 내일 새벽 갱신 때 순위에 반영됩니다.' });
    }
    if (길 === '/elo/recent' && req.method === 'GET') {
      const L = await 읽기(env, 'elo:submits', []);
      return 답({ ok: true, list: L.slice(-15).reverse().map(x => ({ date: x.date, league: x.league, map: x.map, winner: x.winner, loser: x.loser, t: x.t })) });
    }


    // 래더 아이디 등록요청 (공개) — 사이트 래더 화면. 다음 새벽 갱신 때 cwal.gg 에서 찾아 붙인다
    if (길 === '/ladder/request' && req.method === 'POST') {
      const ip = req.headers.get('cf-connecting-ip') || 'x', rk = 'elo:rlL:' + ip;
      const cnt = parseInt((await env.KSDATA.get(rk)) || '0', 10);
      if (cnt >= 15) return 답({ ok: false, msg: '잠시 뒤에 다시 해 주세요.' }, 429);
      const id = 짧게(body.id, 30), toon = 짧게(body.toon, 40), tier = 짧게(body.tier, 10);
      if (!/^[A-Za-z0-9_.\-\[\]()]{2,30}$/.test(id) || !/^[A-Za-z0-9_.\-\[\]()]{2,40}$/.test(toon)) return 답({ ok: false, msg: '아이디와 계정 이름은 영어·숫자로만 적어 주세요.' }, 400);
      if (!['Black', 'Gold', 'Yellow', 'Red', 'Violet', 'Blue', 'Sky', 'White'].includes(tier)) return 답({ ok: false, msg: '클랜 티어를 골라 주세요.' }, 400);
      const L = (await 읽기(env, 'elo:ladreq', [])).filter(q => q.toon.toLowerCase() !== toon.toLowerCase());
      L.push({ k: crypto.randomUUID().slice(0, 8), t: Date.now(), id, toon, tier });
      while (L.length > 600) L.shift();
      await 쓰기(env, 'elo:ladreq', L);
      await env.KSDATA.put(rk, String(cnt + 1), { expirationTtl: 3600 });
      return 답({ ok: true, msg: `등록 요청 완료: ${toon}. 다음 갱신(매일 아침) 때 반영됩니다.` });
    }

    // ── 여기부터 관리자만 ──
    if (!(await 관리자냐(env, req))) return 답({ ok: false, msg: '다시 로그인해 주세요.' }, 401);

    if (길 === '/logout') { await env.KSDATA.delete('elo:sess:' + req.headers.get('x-token')); return 답({ ok: true }); }

    if (길 === '/sources' && req.method === 'GET') {
      return 답({ ok: true, sources: await 읽기(env, 'elo:sources', []), stat: await 읽기(env, 'elo:srcstat', {}), cafe: await 읽기(env, 'elo:cafe', {}) });
    }
    if (길 === '/sources/analyze' && req.method === 'POST') return 답(await 분석(body.url));
    if (길 === '/sources/preview' && req.method === 'POST') {
      try { return 답(await 미리보기(짧게(body.sheet, 80), 짧게(body.gid, 20), body.mapping)); }
      catch (e) { return 답({ ok: false, msg: e.message }); }
    }
    if (길 === '/sources/save' && req.method === 'POST') {
      const s = body.source || {};
      const L = await 읽기(env, 'elo:sources', []);
      const id = /^[a-z0-9]{6,12}$/.test(s.id || '') ? s.id : crypto.randomUUID().slice(0, 8);
      const item = {
        id, name: 짧게(s.name, 40) || '이름 없는 시트', league: 짧게(s.league, 30) || 'ELO',
        weight: Math.max(0, Math.min(10, +s.weight || 1)), url: 짧게(s.url, 300),
        sheet: 짧게(s.sheet, 80), gid: 짧게(s.gid, 20), enabled: s.enabled !== false,
        mapping: s.mapping || null, added: Date.now(),
      };
      const i = L.findIndex(x => x.id === id);
      if (i >= 0) { item.added = L[i].added; L[i] = item; } else L.push(item);
      if (L.length > 60) return 답({ ok: false, msg: '시트는 60개까지 넣을 수 있습니다.' }, 400);
      await 쓰기(env, 'elo:sources', L);
      return 답({ ok: true, sources: L });
    }
    if (길 === '/sources/del' && req.method === 'POST') {
      const L = (await 읽기(env, 'elo:sources', [])).filter(x => x.id !== body.id);
      await 쓰기(env, 'elo:sources', L);
      return 답({ ok: true, sources: L });
    }

    if (길 === '/cafe' && req.method === 'POST') {
      const c = { enabled: !!body.enabled, url: 짧게(body.url, 300), clubid: 짧게(body.clubid, 20) || '30800617', menuid: 짧게(body.menuid, 20) };
      const m = c.url.match(/menus\/(\d+)/) || c.url.match(/menuid=(\d+)/i);
      if (m && !c.menuid) c.menuid = m[1];
      await 쓰기(env, 'elo:cafe', c);
      return 답({ ok: true, cafe: c });
    }

    if (길 === '/promo' && req.method === 'GET') return 답({ ok: true, promo: await 읽기(env, 'elo:promo', {}) });
    if (길 === '/promo' && req.method === 'POST') {
      const p = { settings: body.settings || {}, overrides: body.overrides || {}, at: Date.now() };
      if (JSON.stringify(p).length > 60000) return 답({ ok: false, msg: '저장할 내용이 너무 큽니다.' }, 400);
      await 쓰기(env, 'elo:promo', p);
      return 답({ ok: true, promo: p });
    }

    if (길 === '/elo/submits' && req.method === 'GET') return 답({ ok: true, list: (await 읽기(env, 'elo:submits', [])).slice(-500).reverse() });
    if (길 === '/elo/submits/del' && req.method === 'POST') {
      const L = (await 읽기(env, 'elo:submits', [])).filter(x => x.k !== body.k);
      await 쓰기(env, 'elo:submits', L);
      return 답({ ok: true });
    }

    if (길 === '/elo/submits/edit' && req.method === 'POST') {
      const L = await 읽기(env, 'elo:submits', []);
      const x = L.find(v => v.k === body.k);
      if (!x) return 답({ ok: false, msg: '그 결과를 찾지 못했습니다.' }, 404);
      for (const f of ['date', 'league', 'map', 'winner', 'loser']) if (body[f] != null) x[f] = 짧게(body[f], 40);
      for (const f of ['wrace', 'lrace']) if (body[f] != null) x[f] = /^[PTZ]?$/i.test(body[f]) ? String(body[f]).toUpperCase() : '';
      x.edited = Date.now();
      await 쓰기(env, 'elo:submits', L);
      return 답({ ok: true });
    }

    // 이미 반영된 경기 고치기·지우기 (시트·카페·입력양식 어디서 왔든). 다음 새벽 갱신 때 적용
    if (길 === '/fix' && req.method === 'GET') return 답({ ok: true, list: await 읽기(env, 'elo:fix', []) });
    if (길 === '/fix/save' && req.method === 'POST') {
      const sig = 짧게(body.sig, 200);
      if (!sig) return 답({ ok: false, msg: '고칠 경기를 고르세요.' }, 400);
      const act = body.act === 'del' ? 'del' : 'edit';
      const d = body.data || {};
      const data = act === 'edit' ? { date: 짧게(d.date, 10), league: 짧게(d.league, 30), map: 짧게(d.map, 40), winner: 짧게(d.winner, 30), loser: 짧게(d.loser, 30), wrace: 짧게(d.wrace, 1), lrace: 짧게(d.lrace, 1) } : null;
      const L = (await 읽기(env, 'elo:fix', [])).filter(f => f.sig !== sig);
      L.push({ sig, act, data, note: 짧게(body.note, 100), view: body.view || null, t: Date.now() });
      if (L.length > 3000) return 답({ ok: false, msg: '수정 목록이 너무 많습니다.' }, 400);
      await 쓰기(env, 'elo:fix', L);
      return 답({ ok: true, list: L });
    }
    if (길 === '/fix/del' && req.method === 'POST') {
      const L = (await 읽기(env, 'elo:fix', [])).filter(f => f.sig !== body.sig);
      await 쓰기(env, 'elo:fix', L);
      return 답({ ok: true, list: L });
    }

    // 래더 관리 — 요청 목록·추가/빼기·지난 갱신 결과
    if (길 === '/ladder' && req.method === 'GET') {
      return 답({ ok: true, ops: await 읽기(env, 'elo:ladops', []), reqs: await 읽기(env, 'elo:ladreq', []), stat: await 읽기(env, 'elo:ladstat', {}) });
    }
    if (길 === '/ladder/save' && req.method === 'POST') {
      const act = body.act === 'del' ? 'del' : 'add', toon = 짧게(body.toon, 40);
      if (!toon) return 답({ ok: false, msg: '래더 계정 이름을 적어 주세요.' }, 400);
      const ops = (await 읽기(env, 'elo:ladops', [])).filter(o => o.toon.toLowerCase() !== toon.toLowerCase());
      ops.push({ k: crypto.randomUUID().slice(0, 8), t: Date.now(), act, id: 짧게(body.id, 40) || toon.split('[')[0], toon, tier: 짧게(body.tier, 20) });
      if (ops.length > 600) return 답({ ok: false, msg: '변경 목록이 너무 많습니다.' }, 400);
      await 쓰기(env, 'elo:ladops', ops);
      return 답({ ok: true, ops });
    }
    if (길 === '/ladder/undo' && req.method === 'POST') {
      const ops = (await 읽기(env, 'elo:ladops', [])).filter(o => o.k !== body.k);
      await 쓰기(env, 'elo:ladops', ops);
      return 답({ ok: true, ops });
    }
    if (길 === '/ladder/reqdel' && req.method === 'POST') {
      const L = (await 읽기(env, 'elo:ladreq', [])).filter(q => q.k !== body.k);
      await 쓰기(env, 'elo:ladreq', L);
      return 답({ ok: true });
    }

    return 답({ ok: false, msg: '없는 주소입니다.' }, 404);
  },
};
