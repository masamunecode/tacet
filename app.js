/* Murmo: team chat workspace. Same Claude, two agents: a naive "helpful" one and Tacet, which mostly stays quiet.
   Plain JS, no build. Everything on screen is rendered from state (S) or, in capture mode, from time t. */
window.SIM = {duration: 24, ready: false, render() {}};
(async () => {
'use strict';
const Q = new URLSearchParams(location.search);
const CAPTURE = Q.get('capture') === '1';
const $ = (s) => document.querySelector(s);
const app = $('#app');
if (CAPTURE) document.documentElement.classList.add('capture');

// ---------- data: four files, two agents
async function getJSON(u) { try { const r = await fetch(u, {cache: 'no-store'}); return r.ok ? await r.json() : null; } catch { return null; } }
const SC = await getJSON('data/scenarios.json');
if (!SC) { document.body.innerHTML = '<p style="color:#fff;padding:24px;font-family:sans-serif">Could not load data/scenarios.json. Serve this folder over http (for example: python3 -m http.server) and open it from there.</p>'; return; }
const A = {
  naive: {key: 'naive', name: 'Naive agent', R: {}, V: {}, expect: {}, has: false, graded: false},
  tacet: {key: 'tacet', name: 'Tacet', R: {}, V: {}, expect: {}, has: false, graded: false},
};
let SAMPLE = Q.get('data') === 'sample', maxRun = 1;
const arr = (x) => (Array.isArray(x) ? x : x ? x.results || x.records || [] : []);
async function loadSet(pre) {
  const [tr, tg, br, bg] = await Promise.all([pre + 'results', pre + 'grades', pre + 'baseline-results', pre + 'baseline-grades'].map((f, i) => (i === 0 || true) && getJSON(`data/${f}.json`)));
  return {tr, tg, br, bg};
}
let set = SAMPLE ? await loadSet('sample-') : await loadSet('');
if (!SAMPLE && !set.tr) { SAMPLE = true; set = await loadSet('sample-'); } // no real run yet
function fill(a, results, grades) {
  for (const r of arr(results)) { ((a.R[r.model] ||= {})[r.thread] ||= {})[r.run] = r; if (r.run > maxRun) maxRun = r.run; a.has = true; }
  if (grades) { a.graded = true; a.expect = grades.expect || {}; for (const v of grades.verdicts || []) ((a.V[v.model] ||= {})[v.thread] ||= {})[v.run] = v; }
}
fill(A.tacet, set.tr, set.tg); fill(A.naive, set.br, set.bg);
const EXPECT = {...A.naive.expect, ...A.tacet.expect};
const GRADED = Object.keys(EXPECT).length > 0;
const AGENTS = ['naive', 'tacet'].filter((k) => A[k].has || k === 'tacet');
const BOTH = AGENTS.length === 2;

const KNOWN = [['claude-fable-5-2', 'Fable 5.2'], ['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5']];
const MODELS = KNOWN.map(([id, name]) => ({id, name}));
for (const k of AGENTS) for (const id of Object.keys(A[k].R)) if (!MODELS.some((m) => m.id === id)) MODELS.push({id, name: id.replace(/^claude-/, '')});
const modelName = (id) => (MODELS.find((m) => m.id === id) || {name: id}).name;
const RUNS = Array.from({length: Math.max(maxRun, 1)}, (_, i) => i + 1);

const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const THREADS = [...SC.threads].sort((a, b) => toMin(a.messages[0].time) - toMin(b.messages[0].time)); // the day, in order
const TH = Object.fromEntries(THREADS.map((t) => [t.id, t]));
const CHANNELS = [...new Set(THREADS.map((t) => t.channel))].sort();
const inChannel = (ch) => THREADS.filter((t) => t.channel === ch);

const people = {};
for (const f of (SC.company.memory.find((a) => /people/i.test(a.area)) || {facts: []}).facts) {
  const i = f.indexOf(':'); if (i < 0) continue;
  for (const n of f.slice(0, i).split(',')) people[n.trim()] = {role: f.slice(i + 1).trim()};
}
for (const t of THREADS) for (const m of t.messages) people[m.who] ||= {role: ''};
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const AV_COLORS = ['#3d7ea6', '#b9584f', '#5a8f5c', '#8a63b8', '#c08a2b', '#2f8f8a', '#c4577f', '#5f6fc0', '#7a8a3a', '#a8663c', '#4c9ac9', '#96527f'];
Object.keys(people).forEach((n, i) => { people[n].color = AV_COLORS[i % AV_COLORS.length]; people[n].initials = n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(); });
const ME = 'You';
people[ME] = {role: '', color: '#3f6b73', initials: 'Y'};

// ---------- state
const S = {
  thread: TH[Q.get('thread')] ? Q.get('thread') : null,
  channel: null, dm: null,
  model: MODELS.some((m) => m.id === Q.get('model')) ? Q.get('model') : (MODELS.find((m) => m.id === 'claude-opus-5-5') || MODELS[0]).id,
  run: RUNS.includes(+Q.get('run')) ? +Q.get('run') : 'all',
  agents: AGENTS.includes(Q.get('agents')) ? Q.get('agents') : 'both',
  tab: ['activity', 'score', 'memory'].includes(Q.get('tab')) ? Q.get('tab') : 'activity',
  memArea: Q.get('area') || null,
  panel: Q.has('panel') ? Q.get('panel') !== '0' : innerWidth > 860,
  nav: false,
  board: Q.get('view') === 'scoreboard',
  local: {}, myReacts: {}, open: {},
};
S.channel = S.thread ? TH[S.thread].channel : CHANNELS.includes(Q.get('channel')) ? Q.get('channel')
  : [...CHANNELS].sort((a, b) => inChannel(b).length - inChannel(a).length)[0];
const visited = new Set([S.channel]);
const shown = () => (S.agents === 'both' ? AGENTS : [S.agents]);

// ---------- results helpers (a = 'naive' | 'tacet')
const rec = (a, m, th, r) => { const x = A[a].R[m] && A[a].R[m][th] && A[a].R[m][th][r]; return x && x.decision !== 'error' ? x : null; };
function verdict(a, m, th, r) { // true / false / null (unknown)
  const x = rec(a, m, th, r); if (!x) return null;
  const v = A[a].V[m] && A[a].V[m][th] && A[a].V[m][th][r];
  if (v) return !!v.correct;
  const e = EXPECT[th]; if (!e) return null;
  if (x.decision === 'skip') return e === 'skip';
  return e === 'skip' ? false : null; // spoke where needed, but nobody judged whether it named the right problem
}
const noteOf = (a, m, th, r) => { const v = A[a].V[m] && A[a].V[m][th] && A[a].V[m][th][r]; return v && v.note ? v.note : ''; };
const runList = (sel = S.run) => (sel === 'all' ? RUNS : [sel]);
function outcome(a, m, th, runSel = S.run) {
  const recs = runList(runSel).map((r) => ({run: r, rec: rec(a, m, th, r), ok: verdict(a, m, th, r)})).filter((x) => x.rec);
  const spoke = recs.filter((x) => x.rec.decision === 'speak');
  const judged = recs.filter((x) => x.ok !== null);
  const mark = !judged.length ? null : judged.every((x) => x.ok) ? 'ok' : judged.some((x) => x.ok) ? 'mix' : 'bad';
  return {n: recs.length, recs, spoke: spoke.length, shown: spoke[0] || null, mark};
}
const ZERO = () => ({n: 0, need: 0, needOk: 0, quiet: 0, quietOk: 0, graded: 0, ok: 0, spoke: 0, skipped: 0, missed: 0, wN: 0, wTok: 0, wMs: 0, wCost: 0, tok: 0, ms: 0, cost: 0});
// needless = the agent posted and the grader said it was not correct (nobody needed it, or it named the wrong problem)
const isNeedless = (a, m, th, r) => { const x = rec(a, m, th, r); return !!x && x.decision === 'speak' && verdict(a, m, th, r) === false; };
function stats(a, m, w = () => 1, runSel = S.run) {
  const s = ZERO();
  for (const th of THREADS) {
    const k = w(th.id); if (!k) continue;
    for (const r of runList(runSel)) {
      const x = rec(a, m, th.id, r); if (!x) continue;
      const tok = (x.input_tokens || 0) + (x.output_tokens || 0), ok = verdict(a, m, th.id, r), e = EXPECT[th.id], speak = x.decision === 'speak';
      s.n += k; s.tok += k * tok; s.ms += k * (x.duration_ms || 0); s.cost += k * (x.cost_usd || 0);
      if (speak) s.spoke += k; else s.skipped += k;
      if (e === 'speak') { s.need += k; if (ok) s.needOk += k; if (!speak) s.missed += k; } else if (e === 'skip') { s.quiet += k; if (ok) s.quietOk += k; }
      if (ok !== null) { s.graded += k; if (ok) s.ok += k; }
      if (speak && ok === false) { s.wN += k; s.wTok += k * tok; s.wMs += k * (x.duration_ms || 0); s.wCost += k * (x.cost_usd || 0); }
    }
  }
  return s;
}
function total(a, wf) { const s = ZERO(); MODELS.forEach((m, k) => { const x = stats(a, m.id, wf ? wf(k) : undefined); for (const key in s) s[key] += x[key]; }); return s; }
const MAXN = Math.max(1, ...AGENTS.flatMap((a) => MODELS.map((m) => { const s = stats(a, m.id, undefined, 'all'); return GRADED ? s.wN : s.spoke; })));
const fTok = (n) => (n >= 9950 ? (n / 1000).toFixed(0) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
const fSec = (ms) => (ms >= 99950 ? (ms / 60000).toFixed(1) + ' min' : (ms / 1000).toFixed(1) + 's');
const fUsd = (v) => '$' + (v >= 10 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v > 0 ? v.toFixed(4) : '0');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- small html helpers
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const P = {
  hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3', down: 'M6 9l6 6 6-6', plus: 'M12 5v14M5 12h14',
  home: 'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', dm: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0', smile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  at: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8', clip: 'M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z', menu: 'M3 6h18M3 12h18M3 18h18', x: 'M18 6L6 18M6 6l12 12', left: 'M19 12H5M12 19l-7-7 7-7', right: 'M5 12h14M12 5l7 7-7 7',
  check: 'M20 6L9 17l-5-5', book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5', expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM21 15l-5-5L5 21', edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  thread: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01', clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  horn: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24"><path d="${P[n]}"/></svg>`;
// Tacet: a whole rest, the sign for "this instrument is silent"
const TACET = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="8" width="16" height="2.2" rx="1.1"/><rect x="7.5" y="10" width="9" height="5" rx="1"/></svg>';
const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17V10a4 4 0 0 1 8 0v7M12 10a4 4 0 0 1 8 0v7"/></svg>';
const av = (name, cls = '') => { const p = people[name] || {color: '#52666a', initials: name.slice(0, 1).toUpperCase()}; return `<span class="av ${cls}" style="background:${p.color}">${esc(p.initials)}</span>`; };
const bot = (cls = '') => `<span class="av bot ${cls}">${TACET}</span>`;
const nbot = (cls = '') => `<span class="av nbot ${cls}">${ic('horn')}<i></i></span>`;
const areaFor = (name) => { const n = name.trim().toLowerCase(), M = SC.company.memory; return M.find((a) => a.area.toLowerCase() === n) || M.find((a) => a.area.toLowerCase().startsWith(n) || n.startsWith(a.area.toLowerCase())) || null; };
function fmt(s, agent) {
  let h = esc(s);
  if (agent) {
    h = h.replace(/\[memory:\s*([^\]]+)\]/gi, (m, a) => `<button class="cite" data-act="mem" data-arg="${a.trim()}" title="Open in company memory">${ic('book')}${a.trim().replace(/\s*\(.*\)$/, '')}</button>`)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/(^|\n)\s*[-•]\s+/g, '$1• ').replace(/\n{2,}/g, '\n');
  }
  h = h.replace(/(^|[\s(])@([A-Za-z][\w-]*)/g, '$1<span class="mention">@$2</span>')
    .replace(/(^|[\s(])#([a-z][\w-]*)/g, (m, a, c) => (CHANNELS.includes(c) ? `${a}<span class="chanref">#${c}</span>` : m));
  return h.replace(/\n/g, '<br>');
}
const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x) => { x = clamp(x); return 1 - Math.pow(1 - x, 3); };
const mark = (k, cls = 'mk2') => (k ? `<span class="${cls} ${k}" title="${k === 'ok' ? 'correct' : k === 'bad' ? 'wrong' : 'correct in some runs'}">${k === 'ok' ? ic('check') : k === 'bad' ? ic('x') : '<svg class="ic" viewBox="0 0 24 24"><path d="M6 12h12"/></svg>'}</span>` : '');
const pips = (o, a) => `<span class="pips a-${a}">${runList().map((r) => { const x = o.recs.find((y) => y.run === r); return `<i class="pip ${x ? x.rec.decision : ''} ${x && x.ok === false ? 'wrong' : ''}" title="${A[a].name}, run ${r}: ${x ? (x.rec.decision === 'speak' ? 'spoke' : 'stayed quiet') : 'no data'}${x && x.ok === false ? ' (wrong)' : ''}"></i>`; }).join('')}</span>`;
const badge = () => (SAMPLE ? '<span class="badge-sample" title="Invented values. Put the real data files in data/ to see the real run.">SAMPLE DATA</span>' : !GRADED ? '<span class="badge-pending" title="no grades file found yet">UNGRADED</span>' : '');

// ---------- chrome: top bar and rail
function renderTop() {
  $('#top').innerHTML = `<div class="brand"><span class="logo">${LOGO}</span>Murmo</div>
    <div class="navs"><span class="tbtn">${ic('left')}</span><span class="tbtn">${ic('right')}</span><span class="tbtn">${ic('clock')}</span></div>
    <div class="search">${ic('search')}Search ${esc(SC.company.name)}</div>
    <div class="right">${badge()}
      <button class="agent-btn" data-act="toggle-panel" title="The agents">${bot('xs')}<span>Agents</span></button>
      <span class="tbtn">${ic('help')}</span><span class="av sm me" style="background:#3f6b73">Y</span></div>`;
  $('#rail').innerHTML = `<span class="ws on" title="${esc(SC.company.name)}">${esc(SC.company.name.slice(0, 2))}</span><span class="ws" style="background:#5b4a7a">Lk</span><span class="ws" style="background:#7a5a3a">Od</span><span class="ws add">${ic('plus')}</span>
    <span class="sep"></span>
    <span class="rnav on"><i>${ic('home')}</i>Home</span><span class="rnav"><i>${ic('dm')}</i>DMs</span><span class="rnav"><i>${ic('bell')}</i>Activity</span>`;
  $('#ctools').innerHTML = '<span><b>B</b></span><span><em>I</em></span><span><s>S</s></span><span>' + ic('hash') + '</span>';
  $('#cfoot').innerHTML = `<span>${ic('plus')}</span><span>${ic('smile')}</span><span>${ic('at')}</span><span>${ic('clip')}</span><button class="send" title="Send">${ic('send')}</button>`;
}

// ---------- sidebar
const unread = (ch) => (visited.has(ch) ? 0 : inChannel(ch).length); // unread threads, not messages: stays small however long the day gets
function renderSide() {
  const active = S.dm ? null : S.channel;
  let h = `<div class="side-head"><b>${esc(SC.company.name)} ${ic('down')}</b><span class="compose">${ic('edit')}</span></div><div class="side-scroll">`;
  h += `<span class="s-item">${ic('thread')}<span class="nm">Threads</span></span><span class="s-item">${ic('at')}<span class="nm">Mentions &amp; reactions</span></span>`;
  h += `<div class="s-sec">${ic('down')}Channels</div>`;
  for (const ch of CHANNELS) {
    const n = unread(ch);
    h += `<button class="s-item ${active === ch ? 'on' : ''} ${n ? 'unread' : ''}" data-act="channel" data-arg="${ch}">${ic('hash')}<span class="nm">${ch}</span>${n ? `<span class="cnt" title="${plural(n, 'unread thread')}">${n > 9 ? '9+' : n}</span>` : ''}</button>`;
  }
  h += `<div class="s-sec">${ic('down')}Direct messages</div>`;
  Object.keys(people).filter((n) => n !== ME).slice(0, 5).forEach((n) => {
    h += `<button class="s-item ${S.dm === n ? 'on' : ''}" data-act="dm" data-arg="${esc(n)}"><span class="dot ${hash(n) % 3 ? 'live' : ''}"></span><span class="nm">${esc(n)}</span></button>`;
  });
  h += `<div class="s-sec">${ic('down')}Apps</div><button class="s-item" data-act="open-agent">${bot('xs')}<span class="nm">Tacet</span><span class="app-tag">APP</span></button>`;
  if (BOTH) h += `<button class="s-item" data-act="open-agent">${nbot('xs')}<span class="nm">Naive agent</span><span class="app-tag">APP</span></button>`;
  h += '</div>';
  // calm status: how often Tacet kept quiet
  const seen = THREADS.filter((t) => outcome('tacet', S.model, t.id).n);
  const q = seen.filter((t) => outcome('tacet', S.model, t.id).spoke === 0).length;
  h += `<button class="side-foot" data-act="open-agent">${bot('sm')}<span><b>Tacet is reading</b>${seen.length ? `Quiet in ${q} of ${plural(seen.length, 'thread')} today` : 'Nothing to say so far'}</span></button>`;
  $('#side').innerHTML = h;
}

// ---------- main column
function reactsHTML(key) {
  const h = hash('r' + key), base = h % 4 === 0 ? [[['👍', '✅', '👀', '🙏'][(h >>> 3) % 4], 1 + ((h >>> 7) % 3)]] : [];
  const mine = S.myReacts[key];
  if (mine) { const b = base.find((x) => x[0] === '👍'); if (b) b[1]++; else base.push(['👍', 1]); }
  return (base.length ? `<div class="reacts">${base.map(([e, n]) => `<button class="react ${mine && e === '👍' ? 'mine' : ''}" data-act="react" data-arg="${key}">${e} ${n}</button>`).join('')}</div>` : '') +
    `<div class="hov"><button data-act="react" data-arg="${key}" title="React with 👍">👍</button><button data-act="react" data-arg="${key}" title="Add reaction">${ic('smile')}</button><button data-act="noop" title="Reply in thread">${ic('thread')}</button></div>`;
}
function msgHTML(m, key, reply) {
  const file = m.attachment ? `<div><span class="file"><i>${ic('image')}</i><span>${esc(m.attachment)}<small>${esc((m.attachment.split('.').pop() || 'file').toUpperCase())}</small></span></span></div>` : '';
  return `<div class="msg">${av(m.who, reply ? 'sm' : '')}<div class="body"><div class="meta"><b>${esc(m.who)}</b><time>${esc(m.time)}</time></div><div class="text">${fmt(m.text)}</div>${file}${key ? reactsHTML(key) : ''}</div></div>`;
}
function verdictTag(x, th) {
  if (x.ok === true) return `<span class="tag ok">${ic('check')}${x.rec.decision === 'speak' ? 'needed, right problem' : 'right to stay quiet'}</span>`;
  if (x.ok === false) return `<span class="tag bad">${ic('x')}${x.rec.decision === 'skip' ? 'missed: a human needed this' : EXPECT[th] === 'skip' ? 'nobody needed this' : 'wrong problem'}</span>`;
  return '';
}
const replyTime = (th, add) => fromMin(toMin(th.messages[th.messages.length - 1].time) + add);
function agentCard(a, th, o) {
  const x = o.shown, many = S.run === 'all' && o.n > 1, long = a === 'naive' && x.rec.message.length > 330 && !S.open[th.id];
  const head = a === 'naive' ? `${nbot('sm')}<div class="body"><div class="meta"><b>Naive agent</b><span class="app-tag">APP</span><time>${replyTime(th, 1)}</time></div>`
    : `${bot('sm')}<div class="body"><div class="meta"><b>Tacet</b><span class="app-tag">APP</span><time>${replyTime(th, 1)}</time></div>`;
  return `<div class="msg agent a-${a} ${x.ok === false ? 'needless' : ''}">${head}
    <div class="text ${long ? 'clampd' : ''}">${fmt(x.rec.message, true)}</div>${long ? `<button class="more" data-act="more" data-arg="${th.id}">Show all of it</button>` : ''}
    <div class="foot">${verdictTag(x, th.id)}<span class="via">${esc(modelName(S.model))} · run ${x.run}</span>${many ? `${pips(o, a)}<span>spoke in ${o.spoke} of ${o.n} runs</span>` : ''}</div></div></div>`;
}
function agentsHTML(th) {
  const on = shown(), ot = outcome('tacet', S.model, th.id), on_ = on.includes('naive') ? outcome('naive', S.model, th.id) : null;
  const many = S.run === 'all';
  let h = '';
  if (on_ && on_.spoke) h += agentCard('naive', th, on_);
  const nvQuiet = on_ && on_.n && !on_.spoke ? `<span class="q-nv">${nbot('xs')}naive agent ${on_.recs.some((x) => x.ok === false) ? 'also missed it' : 'stayed quiet too'}</span>` : '';
  if (!on.includes('tacet')) return h + (nvQuiet ? `<div class="quiet pending">${nvQuiet}</div>` : '');
  if (!ot.n) return h + `<div class="quiet pending"><span class="q-ic">${TACET}</span><span class="q-txt">Tacet: not run yet</span>${nvQuiet}</div>`;
  if (ot.spoke) return h + agentCard('tacet', th, ot) + (nvQuiet ? `<div class="quiet pending">${nvQuiet}</div>` : '');
  const missed = ot.recs.some((x) => x.ok === false);
  return h + `<div class="quiet" title="Tacet read this thread and had nothing worth interrupting for."><span class="q-ic">${TACET}</span><span class="q-txt">read · stayed quiet</span>${many && ot.n > 1 ? `<span class="q-sub">${ot.n} of ${ot.n} runs</span>` : ''}${missed ? `<span class="tag bad">${ic('x')}missed: a human needed this</span>` : ''}${nvQuiet}</div>`;
}
function threadHTML(th) {
  return `<div class="thread ${S.thread === th.id ? 'sel' : ''}" id="th-${th.id}" data-act="thread" data-arg="${th.id}">${msgHTML(th.messages[0], th.id + ':0')}
    <div class="replies">${th.messages.slice(1).map((m, j) => msgHTML(m, `${th.id}:${j + 1}`, true)).join('')}${agentsHTML(th)}</div></div>`;
}
const localHTML = (k) => (S.local[k] || []).map((m) => `<div class="thread" style="cursor:default">${msgHTML(m)}</div>`).join('');
function renderMain(scroll = 'keep') {
  const list = $('#mlist'), keep = list.scrollTop, ch = S.channel;
  if (S.dm) {
    $('#mhead').innerHTML = `<button class="hbtn menu" data-act="toggle-nav">${ic('menu')}</button><h1>${av(S.dm, 'xs')}&nbsp;${esc(S.dm)}</h1><span class="topic">${esc(people[S.dm].role)}</span>`;
    list.innerHTML = `<div class="push"></div><div class="intro">${av(S.dm, 'lg')}<h2 style="margin-top:10px">${esc(S.dm)}</h2><p>${esc(people[S.dm].role)} at ${esc(SC.company.name)}. This is the very beginning of your direct messages.</p></div>` + localHTML('dm:' + S.dm);
    $('#cinput').placeholder = `Message ${S.dm}`;
    return;
  }
  const ths = inChannel(ch), members = [...new Set(ths.flatMap((t) => t.messages.map((m) => m.who)))];
  $('#mhead').innerHTML = `<button class="hbtn menu" data-act="toggle-nav" title="Channels">${ic('menu')}</button><h1>${ic('hash')}${ch}</h1>
    <span class="topic">${plural(ths.length, 'thread')} today · ${BOTH && S.agents !== 'tacet' ? (S.agents === 'both' ? 'two agents read along' : 'the naive agent reads along') : 'Tacet reads along'}</span>
    <span class="stack"><span class="avs">${members.slice(0, 3).map((n) => av(n, 'xs')).join('')}${bot('xs')}</span>${members.length + shown().length}</span>
    <button class="hbtn" data-act="toggle-panel" title="The agents">${bot('xs')}</button>`;
  list.innerHTML = `<div class="push"></div><div class="intro"><div class="big">${ic('hash')}</div><h2>#${ch}</h2><p>This is the very beginning of #${ch}. Tacet reads every thread here and speaks only when someone needs it.</p></div>
    <div class="day"><span>Today · ${esc(SC.company.today || '')}</span></div>` + ths.map(threadHTML).join('') + localHTML(ch);
  $('#cinput').placeholder = `Message #${ch}`;
  if (scroll === 'thread' && S.thread && TH[S.thread].channel === ch) { const el = $('#th-' + S.thread); if (el) list.scrollTop = Math.max(0, el.offsetTop - list.offsetTop - Math.max(12, (list.clientHeight - el.offsetHeight) / 2)); }
  else if (scroll === 'bottom' || scroll === 'thread') list.scrollTop = list.scrollHeight;
  else list.scrollTop = keep;
}

// ---------- comparison pieces (panel + board)
const spendOf = (s) => (GRADED ? (Math.round(s.wN) ? `${fTok(s.wTok)} tok · ${fSec(s.wMs)} · ${fUsd(s.wCost)}` : 'nothing wasted') : `${fTok(s.tok)} tok · ${fSec(s.ms)} · ${fUsd(s.cost)} in total`);
function cmpRow(a, s) {
  const n = Math.round(GRADED ? s.wN : s.spoke);
  return `<div class="cc-r a-${a} ${n ? '' : 'zero'}"><span class="who">${a === 'naive' ? nbot('xs') : bot('xs')}${A[a].name}</span><span class="n">${s.n ? n : 'n/a'}</span>
    <span class="barw"><span class="what">${GRADED ? `message${n === 1 ? '' : 's'} nobody needed` : `message${n === 1 ? '' : 's'} posted`}</span><span class="bar"><i style="width:${(100 * Math.min(1, n / MAXN)).toFixed(1)}%"></i></span><span class="sp">${s.n ? spendOf(s) : 'no results yet'}</span></span></div>`;
}
function cmpFoot(sn, st) {
  if (!GRADED) return `<div class="cc-f">Not graded yet. Scores appear when the grades files arrive.</div>`;
  const part = (a, s) => (s && s.need ? `${A[a].name === 'Tacet' ? 'Tacet' : 'naive'} ${Math.round(s.needOk)}/${s.need}` : '');
  const miss = st && st.missed ? `<span class="hon">Tacet stayed quiet on ${Math.round(st.missed)} of ${st.need} calls that needed it</span>` : '';
  return `<div class="cc-f"><span>Spoke when needed: ${[BOTH && sn ? part('naive', sn) : '', part('tacet', st)].filter(Boolean).join(' · ') || 'n/a'}</span>${miss}</div>`;
}
function cmpCard(m, on) {
  const sn = BOTH ? stats('naive', m.id) : null, st = stats('tacet', m.id);
  return `<button class="cc ${on ? 'on' : ''}" data-act="model" data-arg="${m.id}"><div class="cc-h"><b>${esc(m.name)}</b>${GRADED && st.graded ? `<span>Tacet ${Math.round(st.ok)}/${st.graded} correct${sn && sn.graded ? ` · naive ${Math.round(sn.ok)}/${sn.graded}` : ''}</span>` : ''}</div>
    ${sn ? cmpRow('naive', sn) : ''}${cmpRow('tacet', st)}${cmpFoot(sn, st)}</button>`;
}
function totalsCard() {
  const sn = BOTH ? total('naive') : null, st = total('tacet');
  return `<div class="cc tot"><div class="cc-h"><b>All ${MODELS.length} models</b><span>${plural(THREADS.length, 'thread')} · ${plural(runList().length, 'run')}</span></div>${sn ? cmpRow('naive', sn) : ''}${cmpRow('tacet', st)}${cmpFoot(sn, st)}</div>`;
}

// ---------- agent panel
function panelActivity() {
  const m = MODELS.find((x) => x.id === S.model);
  let h = cmpCard(m, false).replace('<button class="cc ', '<div class="cc hero ').replace(/<\/button>$/, '</div>');
  const nNeed = THREADS.filter((t) => EXPECT[t.id] === 'speak').length;
  h += `<div class="lbl">Today's threads <span class="lbl-r">${GRADED ? `${nNeed} need an agent, ${THREADS.length - nNeed} don't · ` : ''}${S.run === 'all' ? `all ${RUNS.length} runs` : 'run ' + S.run}</span></div>`;
  if (BOTH) h += `<div class="colhead"><span></span><span></span><span class="oc2"><i>naive</i><i>Tacet</i></span></div>`;
  for (const th of THREADS) {
    const on = S.thread === th.id;
    const cell = (a) => { const o = outcome(a, S.model, th.id); return `<span class="ocell a-${a}" title="${A[a].name}">${o.n ? pips(o, a) : '<span class="nodata">no data</span>'}${mark(o.mark)}</span>`; };
    h += `<button class="row ${on ? 'on' : ''}" data-act="thread" data-arg="${th.id}"><time>${th.messages[0].time}</time><span><span class="ch">#${th.channel}${EXPECT[th.id] === 'speak' ? '<em class="needs">needs an agent</em>' : ''}</span><div class="sn">${esc(th.messages[0].text)}</div></span>
      <span class="oc2">${AGENTS.map(cell).join('')}</span></button>`;
    if (on) h += detailHTML(th);
  }
  return h + `<p class="fine">Filled dot: the agent posted. Ring: it stayed quiet. Red outline: the grader marked that call wrong.</p>`;
}
function detailHTML(th) {
  let h = '<div class="detail">';
  if (EXPECT[th.id]) h += `<div class="exp">Graders expected an agent to <b>${EXPECT[th.id] === 'speak' ? 'speak' : 'stay quiet'}</b> here.</div>`;
  for (const m of MODELS) {
    h += `<div class="mrow ${m.id === S.model ? 'on' : ''}"><span>${esc(m.name)}</span>${AGENTS.map((a) => { const o = outcome(a, m.id, th.id); return `<span class="ocell a-${a}"><small>${a === 'naive' ? 'naive' : 'Tacet'}</small>${pips(o, a)}${mark(o.mark)}</span>`; }).join('')}</div>`;
  }
  for (const a of AGENTS) {
    const o = outcome(a, S.model, th.id); if (!o.n) continue;
    h += `<div class="runs-h a-${a}">${a === 'naive' ? nbot('xs') : bot('xs')}${A[a].name} · ${esc(modelName(S.model))}</div>`;
    for (const x of o.recs) {
      const note = noteOf(a, S.model, th.id, x.run);
      h += `<div class="runmsg"><div class="h"><b>Run ${x.run}</b><span class="oc ${x.rec.decision} a-${a}">${x.rec.decision === 'speak' ? 'spoke' : 'stayed quiet'}</span>${verdictTag(x, th.id)}<span class="cost">${fSec(x.rec.duration_ms || 0)} · ${fUsd(x.rec.cost_usd || 0)}</span></div>
        ${x.rec.decision === 'speak' ? `<div class="m">${fmt(x.rec.message, true)}</div>` : ''}${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
    }
  }
  return h + '</div>';
}
function panelScore() {
  let h = `<div class="lbl">${BOTH ? 'Same models, two prompts' : 'What each model did'}<button data-act="board">${ic('expand')}Full view</button></div>`;
  h += totalsCard() + MODELS.map((m) => cmpCard(m, m.id === S.model)).join('');
  if (GRADED) h += `<p class="fine">A message nobody needed is one an agent posted where silence was expected, or one that named the wrong problem. Tokens, seconds and dollars are what those calls cost (everything the model read and wrote).</p>`;
  return h;
}
function panelMemory() {
  const c = SC.company, hl = S.memArea ? areaFor(S.memArea) : null;
  return `<div class="mem-about"><b>${esc(c.name)}</b> · ${esc(c.about || '')}<br>Today is ${esc(c.today || '')}. This is everything an agent knows besides the thread it is reading.</div>` +
    c.memory.map((a) => `<div class="mem ${/people/i.test(a.area) ? 'people' : ''} ${hl === a ? 'hl' : ''}" ${hl === a ? 'id="mem-hl"' : ''}><h3>${ic('book')}${esc(a.area)}<span>${plural(a.facts.length, 'fact')}</span></h3><ul>${a.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`).join('');
}
function renderPanel(scroll) {
  const body = $('#panel .p-body'), keep = body ? body.scrollTop : 0, tab = S.tab;
  const seg = (cls, items, cur, act) => `<div class="seg ${cls}">${items.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" data-act="${act}" data-arg="${k}">${l}</button>`).join('')}</div>`;
  $('#panel').innerHTML = `<div class="p-head"><span class="duo">${BOTH ? nbot('lg') : ''}${bot('lg')}</span><div class="t"><h2>${BOTH ? 'Two agents' : 'Tacet <span class="app-tag">APP</span>'}${badge()}</h2><p>${BOTH ? 'Same Claude, same threads. Only the prompt differs.' : 'Reads every thread. Speaks only when someone needs it.'}</p></div><button class="hbtn" data-act="toggle-panel" title="Close">${ic('x')}</button></div>
    <div class="p-ctl">${seg('', MODELS.map((m) => [m.id, esc(m.name)]), S.model, 'model')}
      <div class="ctl-row">${seg('runs', [['all', 'All runs'], ...RUNS.map((r) => [r, r])], S.run, 'run')}${BOTH ? seg('ags', [['both', 'Both'], ['naive', 'Naive'], ['tacet', 'Tacet']], S.agents, 'agents') : ''}</div></div>
    <div class="tabs">${[['activity', 'Activity'], ['score', 'Scoreboard'], ['memory', 'Company memory']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="tab" data-arg="${k}">${l}</button>`).join('')}</div>
    <div class="p-body">${tab === 'score' ? panelScore() : tab === 'memory' ? panelMemory() : panelActivity()}</div>`;
  const nb = $('#panel .p-body');
  if (scroll === 'focus') { const el = tab === 'memory' ? $('#mem-hl') : $('#panel .row.on'); if (el) nb.scrollTop = Math.max(0, el.offsetTop - nb.offsetTop - 60); }
  else if (scroll !== 'top') nb.scrollTop = keep;
}

// ---------- full comparison board (also the end card of the capture tour)
// wf(k) -> weight fn for model k (capture count-up); st(i) -> inline style for staged entrance
function boardHTML(wf, st = () => '') {
  const nNeed = THREADS.filter((t) => EXPECT[t.id] === 'speak').length;
  const sub = `${plural(THREADS.length, 'thread')}${GRADED ? ` (${nNeed} need an agent, ${THREADS.length - nNeed} don't)` : ''} · ${MODELS.length} models · ${plural(runList().length, 'run')}${S.run === 'all' ? '' : ' (run ' + S.run + ')'}`;
  const big = (a, s, full) => `<div class="vs-c a-${a}"><div class="k">${a === 'naive' ? nbot('sm') : bot('sm')}${A[a].name}<small>${a === 'naive' ? 'posts whenever it can help' : 'speaks only when someone needs it'}</small></div>
    <div class="n">${full.n ? Math.round(GRADED ? s.wN : s.spoke) : 'n/a'}</div><div class="l">${GRADED ? 'messages nobody needed' : 'messages posted'}</div><div class="sp">${full.n ? spendOf(s) : 'no results yet'}</div></div>`;
  const tn = BOTH ? total('naive', wf) : null, tt = total('tacet', wf), fn = BOTH ? total('naive') : null, ft = total('tacet');
  const cols = MODELS.map((m, k) => {
    const w = wf ? wf(k) : undefined, sn = BOTH ? stats('naive', m.id, w) : null, s = stats('tacet', m.id, w), full = stats('tacet', m.id);
    const v = (x) => Math.round(GRADED ? x.wN : x.spoke);
    return `<div class="col ${m.id === S.model ? 'on' : ''}" style="${st(3 + k)}"><h3>${esc(m.name)}</h3>
      <div class="pair">${sn ? `<span class="a-naive"><b>${v(sn)}</b><small>naive</small></span><span class="arrow">${ic('right')}</span>` : ''}<span class="a-tacet"><b>${full.n ? v(s) : 'n/a'}</b><small>Tacet</small></span></div>
      ${sn ? `<div class="w">${Math.round(sn.wN) || !GRADED ? `naive spent ${spendOf(sn)}` : 'naive wasted nothing'}</div>` : `<div class="w">${full.n ? spendOf(s) : ''}</div>`}
      ${GRADED && full.need ? `<div class="hon ${full.missed ? 'miss' : ''}">${full.missed ? `Tacet missed ${Math.round(full.missed)} of ${full.need} calls that needed it` : `Tacet spoke on all ${full.need} calls that needed it`}</div>` : ''}</div>`;
  }).join('');
  const honest = !GRADED ? 'Not graded yet: these are raw counts of posted messages.' :
    `When a human did need it: ${fn && fn.need ? `the naive agent spoke up ${fn.needOk} of ${fn.need} times, ` : ''}Tacet ${ft.needOk} of ${ft.need}.` +
    (ft.missed ? ` The honest cost of staying quiet: ${MODELS.map((m) => [m.name, stats('tacet', m.id).missed]).filter((x) => x[1]).map(([n, c]) => `${n} missed ${c}`).join(', ')}.` : ' Tacet missed nothing.');
  return `<div class="board-h" style="${st(0)}"><div><h2>Same Claude. ${BOTH ? 'Two agents.' : 'One quiet agent.'}</h2><p>${sub}</p></div><div class="r">${badge()}</div></div>
    <div class="vs" style="${st(1)}">${tn ? big('naive', tn, fn) + '<div class="vs-mid">vs</div>' : ''}${big('tacet', tt, ft)}</div>
    <div class="cols">${cols}</div>
    <div class="board-f" style="${st(8)}">${honest}</div>`;
}
function renderBoard() {
  const o = $('#overlay');
  o.classList.toggle('show', S.board);
  o.innerHTML = S.board ? `<div class="board"><button class="x" data-act="close-board" title="Close">${ic('x')}</button>${boardHTML()}</div>` : '';
}

function renderAll(mainScroll, panelScroll) {
  app.classList.toggle('no-panel', !S.panel); app.classList.toggle('panel-open', S.panel); app.classList.toggle('nav-open', S.nav);
  renderSide(); renderMain(mainScroll); renderPanel(panelScroll); renderBoard();
}
function syncURL() {
  const q = new URLSearchParams();
  if (Q.get('data')) q.set('data', Q.get('data'));
  if (S.thread) q.set('thread', S.thread); else if (!S.dm) q.set('channel', S.channel);
  q.set('model', S.model); if (S.run !== 'all') q.set('run', S.run);
  if (S.agents !== 'both') q.set('agents', S.agents);
  if (S.tab !== 'activity') q.set('tab', S.tab);
  if (S.board) q.set('view', 'scoreboard');
  history.replaceState(null, '', location.pathname + '?' + q);
}

// ---------- interaction
function bind() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, arg = el.dataset.arg;
    let ms = 'keep', ps = 'keep';
    if (act === 'channel') { S.channel = arg; S.dm = null; S.thread = null; S.nav = false; visited.add(arg); ms = 'bottom'; }
    else if (act === 'dm') { S.dm = arg; S.thread = null; S.nav = false; ms = 'bottom'; }
    else if (act === 'thread') {
      const row = el.classList.contains('row'), same = S.thread === arg && row;
      S.thread = same ? null : arg; S.dm = null;
      if (!same) { const ch = TH[arg].channel, moved = ch !== S.channel; S.channel = ch; visited.add(ch); ms = moved || row ? 'thread' : 'keep'; if (S.tab === 'activity' && !row) ps = 'focus'; }
    }
    else if (act === 'model') S.model = arg;
    else if (act === 'run') S.run = arg === 'all' ? 'all' : +arg;
    else if (act === 'agents') S.agents = arg;
    else if (act === 'tab') { S.tab = arg; ps = 'top'; }
    else if (act === 'mem') { S.tab = 'memory'; S.memArea = arg; S.panel = true; ps = 'focus'; }
    else if (act === 'more') S.open[arg] = true;
    else if (act === 'toggle-panel') S.panel = !S.panel;
    else if (act === 'open-agent') { S.panel = true; S.nav = false; }
    else if (act === 'toggle-nav') S.nav = !S.nav;
    else if (act === 'close-sheets') S.nav = false;
    else if (act === 'board') S.board = true;
    else if (act === 'close-board') S.board = false;
    else if (act === 'react') S.myReacts[arg] = !S.myReacts[arg];
    renderAll(ms, ps); syncURL();
  });
  $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay' && S.board) { S.board = false; renderAll(); syncURL(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (S.board || S.nav)) { S.board = false; S.nav = false; renderAll(); syncURL(); } });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#cinput'), text = inp.value.trim(); if (!text) return;
    const d = new Date(), k = S.dm ? 'dm:' + S.dm : S.channel;
    (S.local[k] ||= []).push({who: ME, time: fromMin(d.getHours() * 60 + d.getMinutes()), text});
    inp.value = ''; renderMain('bottom');
  });
}

// ====================================================================
// capture: a big-type tour for a phone-sized video. Every frame is a pure function of t (seconds).
// intro -> fast pass through the threads that need nothing (naive messages pile up, Tacet stays quiet)
//       -> one beat where Tacet does speak, and is right -> comparison board.
// ====================================================================
function buildTour() {
  const feat = S.model;
  const needs = (t) => EXPECT[t.id] === 'speak';
  const pass = GRADED ? THREADS.filter((t) => !needs(t)) : THREADS;
  const nt = THREADS.filter(needs);
  const tacetOk = (t) => { const o = outcome('tacet', feat, t.id); return o.spoke && o.mark === 'ok'; };
  const beat = nt.find(tacetOk) || nt.find((t) => outcome('tacet', feat, t.id).spoke) || null;
  const T = {intro: 2.4, passEnd: beat ? 13.6 : 18.4, beatEnd: 18.4, dur: 24, pass, beat};
  // threads where the featured model's naive agent posted get room to be read; the rest flick past
  const big = (t) => BOTH && outcome('naive', feat, t.id).spoke > 0;
  const wts = pass.map((t) => (big(t) ? 3.4 : 1)), unit = (T.passEnd - T.intro) / wts.reduce((a, b) => a + b, 0);
  let at = T.intro;
  T.items = pass.map((t, i) => { const it = {th: t, i, start: at, len: wts[i] * unit, big: big(t)}; it.hit = it.start + (it.big ? 0.5 : Math.min(0.2, it.len * 0.4)); at += it.len; return it; });
  // every needless naive message, across all models and runs, becomes one chip on the pile
  T.chips = [];
  for (const it of T.items) {
    let j = 0;
    MODELS.forEach((m, k) => runList().forEach((r) => {
      for (const a of AGENTS) if (isNeedless(a, m.id, it.th.id, r)) { const x = rec(a, m.id, it.th.id, r); T.chips.push({a, k, m, th: it.th, t: it.hit + (a === 'naive' ? j++ : 0) * 0.035, tok: (x.input_tokens || 0) + (x.output_tokens || 0), ms: x.duration_ms || 0, cost: x.cost_usd || 0}); }
    }));
  }
  return T;
}
const cst = (p, dy = 0, sc = 0) => `opacity:${clamp(p).toFixed(3)};transform:translateY(${((1 - p) * dy).toFixed(2)}px) scale(${(1 - (1 - p) * sc).toFixed(4)})`;
function capMsg(m, p, reply) {
  if (p <= 0) return '';
  return `<div class="k-msg ${reply ? 'rep' : ''}" style="${cst(p, 10)}">${av(m.who)}<div><div class="k-meta"><b>${esc(m.who)}</b><time>${esc(m.time)}</time></div><div class="k-text">${fmt(m.text)}</div>${m.attachment ? `<span class="k-file">${ic('image')}${esc(m.attachment)}</span>` : ''}</div></div>`;
}
function bestFact(msg) { // the memory fact the message leans on: cited area, then most shared words
  const c = /\[memory:\s*([^\]]+)\]/i.exec(msg), area = c ? areaFor(c[1]) : null;
  const words = new Set(msg.toLowerCase().match(/[a-z0-9$.-]{4,}/g) || []);
  let best = null, bs = -1;
  for (const a of area ? [area] : SC.company.memory) for (const f of a.facts) { const s = (f.toLowerCase().match(/[a-z0-9$.-]{4,}/g) || []).filter((w) => words.has(w)).length; if (s > bs) { bs = s; best = {area: a.area, fact: f}; } }
  return best;
}
function drawCapture(T, t) {
  const feat = S.model, inBeat = T.beat && t >= T.passEnd;
  const cur = inBeat ? null : T.items.filter((it) => t >= it.start).pop() || null;
  const th = inBeat ? T.beat : (cur || T.items[0]).th;
  const started = inBeat || !!cur;
  const u = inBeat ? t - T.passEnd : cur ? t - cur.start : 0;
  const done = T.items.filter((it) => t >= it.hit).length;

  // ----- sidebar
  let side = `<div class="k-brand"><span class="logo">${LOGO}</span>Murmo</div><div class="k-ws">${esc(SC.company.name)}</div>`;
  for (const ch of CHANNELS) {
    const left = T.items.filter((it) => it.th.channel === ch && t < it.start).length, on = started && th.channel === ch;
    side += `<div class="k-ch ${on ? 'on' : ''} ${left ? 'unread' : ''}"><span>#</span>${ch}${left ? `<i>${left}</i>` : ''}</div>`;
  }
  // ----- main: one thread at a time, big
  let main = '';
  const cap = inBeat ? `<b class="hot">A thread that does need an agent</b>` : `<b>${Math.min(T.items.length, (cur ? cur.i : 0) + 1)} of ${T.items.length}</b> ${GRADED ? 'threads that need nothing from an agent' : 'threads'}`;
  main += `<div class="k-cap ${inBeat ? 'hot' : ''}">${cap}</div><div class="k-head"><span>#</span>${th.channel}<time>${th.messages[0].time}</time></div>`;
  if (started) {
    const fade = ease(u / 0.12);
    const on_ = BOTH ? outcome('naive', feat, th.id) : null, ot = outcome('tacet', feat, th.id);
    let body = capMsg(th.messages[0], inBeat ? ease((u - 0.15) / 0.25) : 1);
    let reps = th.messages.slice(1).map((m, j) => capMsg(m, inBeat ? ease((u - 0.5 - j * 0.32) / 0.25) : 1, true)).join('');
    if (inBeat) {
      const tp = ease((u - 1.55) / 0.35), x = ot.shown;
      if (x && tp > 0) reps += `<div class="k-agent a-tacet" style="${cst(tp, 16, 0.04)}">${bot()}<div><div class="k-meta"><b>Tacet</b><span class="app-tag">APP</span><time>${replyTime(th, 1)}</time></div><div class="k-text">${fmt(x.rec.message, true)}</div>
        ${ease((u - 2.3) / 0.3) > 0 && x.ok ? `<span class="k-tag ok" style="${cst(ease((u - 2.3) / 0.3), 0, 0.2)}">${ic('check')}needed, and right</span>` : ''}</div></div>`;
      if (on_ && on_.spoke && ease((u - 2.9) / 0.3) > 0) reps += `<div class="k-note" style="${cst(ease((u - 2.9) / 0.3))}">${nbot('xs')}The naive agent flagged this one too. The difference is everything else it posted.</div>`;
    } else {
      const np = cur.big ? ease((u - 0.38) / 0.22) : 0, qp = ease((u - (cur.big ? 0.75 : Math.min(0.14, cur.len * 0.3))) / 0.16);
      if (on_ && on_.spoke && np > 0) { const x = on_.shown; reps += `<div class="k-agent a-naive" style="opacity:${np.toFixed(3)};transform:scale(${(1.1 - 0.1 * np).toFixed(4)}) rotate(${(-0.6 * np).toFixed(2)}deg)">${nbot()}<div><div class="k-meta"><b>Naive agent</b><span class="app-tag">APP</span><time>${replyTime(th, 1)}</time></div><div class="k-text clampd">${fmt(x.rec.message, true)}</div>
        <span class="k-tag ${x.ok === false ? 'bad' : 'ok'}">${x.ok === false ? ic('x') + 'nobody needed this' : ic('check') + 'needed'}</span></div></div>`; }
      if (qp > 0) reps += ot.spoke ? `<div class="k-quiet spoke" style="${cst(qp, 6)}"><span class="q-ic">${TACET}</span>Tacet spoke here</div>`
        : `<div class="k-quiet" style="${cst(qp, 6)}"><span class="q-ic">${TACET}</span>Tacet read it · stayed quiet${on_ && !on_.spoke ? '<small>naive agent quiet too</small>' : ''}</div>`;
    }
    main += `<div class="k-thread" style="opacity:${fade.toFixed(3)}">${body}<div class="k-reps">${reps}</div></div>`;
  }
  // ----- right: the two counters
  const landed = T.chips.filter((c) => t >= c.t), nv = landed.filter((c) => c.a === 'naive'), tc = landed.filter((c) => c.a === 'tacet');
  const sum = (l, f) => l.reduce((a, c) => a + c[f], 0);
  const lastHit = nv.length ? t - nv[nv.length - 1].t : 9, bump = 1 + 0.09 * Math.sin(Math.PI * clamp(lastHit / 0.3));
  const pile = nv.map((c, i) => {
    const h = hash(c.th.id + c.m.id + i), p = ease((t - c.t) / 0.28), col = i % 3, row = Math.floor(i / 3);
    const x = col * 148 + (h % 22) - 6, y = row * 21 + ((h >>> 5) % 9), rot = ((h >>> 9) % 15) - 7;
    return `<span class="chipn" style="left:${x}px;bottom:${y}px;opacity:${p.toFixed(3)};transform:translateY(${((1 - p) * -70).toFixed(1)}px) rotate(${rot}deg)">${esc(c.m.name.split(' ')[0])} · #${c.th.channel}</span>`;
  }).join('');
  const perModel = MODELS.map((m, k) => `<span class="${m.id === feat ? 'on' : ''}">${esc(m.name.split(' ')[0])} <b>${nv.filter((c) => c.k === k).length}</b></span>`).join('');
  const rings = T.items.map((it) => { const o = outcome('tacet', feat, it.th.id), p = ease((t - it.hit) / 0.2); return `<i class="${t >= it.hit ? (o.spoke ? 'spoke' : 'q') : ''}" style="${t >= it.hit && p < 1 ? `transform:scale(${(1.5 - 0.5 * p).toFixed(3)})` : ''}"></i>`; }).join('');
  let right = '';
  if (BOTH) right += `<div class="k-card a-naive"><div class="k-who">${nbot('sm')}Naive agent<small>"if you can help, post"</small></div>
    <div class="k-num"><b style="transform:scale(${bump.toFixed(4)})">${nv.length}</b><span>messages<br>nobody needed</span></div>
    <div class="k-models">${perModel}</div>
    <div class="k-spend">${nv.length ? `${fTok(sum(nv, 'tok'))} tokens · ${fSec(sum(nv, 'ms'))} · ${fUsd(sum(nv, 'cost'))}` : '&nbsp;'}</div>
    <div class="k-pile">${pile}</div></div>`;
  right += `<div class="k-card a-tacet"><div class="k-who">${bot('sm')}Tacet<small>speaks only when needed</small></div>
    <div class="k-num"><b>${tc.length}</b><span>messages<br>nobody needed</span></div>
    <div class="k-rings">${rings}</div><div class="k-spend calm">read ${done} of ${T.items.length} · ${tc.length ? plural(tc.length, 'needless message') : 'stayed quiet every time it should'}</div></div>`;
  if (inBeat) { // the memory fact Tacet used slides over the pile
    const x = outcome('tacet', feat, th.id).shown, f = x ? bestFact(x.rec.message) : null, p = ease((u - 1.95) / 0.4);
    if (f && p > 0) right += `<div class="k-mem" style="${cst(p, 30)}"><div class="k-memh">${ic('book')}Company memory · ${esc(f.area.replace(/\s*\(.*\)$/, ''))}</div><div class="k-memf">${esc(f.fact)}</div></div>`;
  }
  // ----- intro and end overlays
  let over = '';
  const ip = 1 - ease((t - (T.intro - 0.55)) / 0.5);
  if (ip > 0) {
    const a = (d) => cst(ease((t - d) / 0.4), 18);
    over += `<div class="k-intro" style="opacity:${ip.toFixed(3)}"><div class="k-i1" style="${a(0.1)}">Same Claude. Two agents.</div>
      <div class="k-i2"><div class="a-naive" style="${a(0.55)}">${nbot('lg')}<b>Naive agent</b><span>posts whenever it can help</span></div><div class="a-tacet" style="${a(0.85)}">${bot('lg')}<b>Tacet</b><span>speaks only when someone needs it</span></div></div>
      <div class="k-i3" style="${a(1.2)}">${plural(THREADS.length, 'thread')} · ${MODELS.length} models · ${plural(runList().length, 'run')} each${SAMPLE ? ' · SAMPLE DATA' : ''}</div></div>`;
  }
  const ep = ease((t - T.beatEnd) / 0.5);
  if (ep > 0) {
    const fill = (k) => { const f = ease((t - T.beatEnd - 0.45 - k * 0.08) / 0.9); return () => f; };
    over += `<div class="k-end" style="background:rgba(7,24,27,${(0.72 * ep).toFixed(3)})"><div class="board" style="${cst(ep, 26, 0.035)}">${boardHTML(fill, (i) => cst(ease((t - T.beatEnd - 0.2 - i * 0.11) / 0.4), 12))}</div></div>`;
  }
  $('#stage').innerHTML = `<div class="k-side">${side}</div><div class="k-main">${main}</div><div class="k-right">${right}</div>${over}`;
}

// ---------- boot
renderTop();
if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 4000))]);
if (CAPTURE) {
  const stage = document.createElement('div'); stage.id = 'stage'; stage.className = 'stage'; document.body.appendChild(stage);
  app.style.display = 'none';
  const T = buildTour();
  const draw = (t) => drawCapture(T, Math.max(0, Math.min(T.dur, +t || 0)));
  let external = false;
  window.SIM = {duration: T.dur, ready: false, render(t) { external = true; draw(t); }};
  if (Q.has('t')) draw(+Q.get('t'));
  else {
    draw(0);
    // preview driver only; it stops for good the moment a recorder calls SIM.render(t)
    if (Q.get('autoplay') !== '0') { let t0 = null; const tick = (now) => { if (external) return; if (t0 === null) t0 = now; const t = (now - t0) / 1000; draw(Math.min(t, T.dur)); if (t < T.dur) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  }
  window.SIM.ready = true;
} else {
  bind();
  renderAll(S.thread ? 'thread' : 'bottom', S.thread || S.memArea ? 'focus' : 'top');
  window.SIM.ready = true;
}
})();
