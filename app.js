/* Murmo: team chat workspace with Tacet, a proactive agent that mostly stays quiet.
   Plain JS, no build. Everything on screen is rendered from state (S) or, in capture mode, from time t. */
window.SIM = {duration: 20, ready: false, render() {}};
(async () => {
'use strict';
const Q = new URLSearchParams(location.search);
const CAPTURE = Q.get('capture') === '1';
const $ = (s) => document.querySelector(s);
const app = $('#app');
if (CAPTURE) document.documentElement.classList.add('capture');

// ---------- data
async function getJSON(u) { try { const r = await fetch(u, {cache: 'no-store'}); return r.ok ? await r.json() : null; } catch { return null; } }
const SC = await getJSON('data/scenarios.json');
if (!SC) { document.body.innerHTML = '<p style="color:#fff;padding:24px;font-family:sans-serif">Could not load data/scenarios.json. Serve this folder over http (for example: python3 -m http.server) and open it from there.</p>'; return; }
let results = null, G = null, SAMPLE = false;
if (Q.get('data') !== 'sample') { results = await getJSON('data/results.json'); if (results) G = await getJSON('data/grades.json'); }
if (!results) { SAMPLE = true; results = await getJSON('data/sample-results.json') || []; G = await getJSON('data/sample-grades.json'); }
if (!Array.isArray(results)) results = results.results || results.records || [];
const EXPECT = (G && G.expect) || {};
const GRADED = !!G;

const KNOWN = [['claude-fable-5-2', 'Fable 5.2'], ['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5']];
const MODELS = KNOWN.map(([id, name]) => ({id, name}));
for (const r of results) if (!MODELS.some((m) => m.id === r.model)) MODELS.push({id: r.model, name: r.model.replace(/^claude-/, '')});
const modelName = (id) => (MODELS.find((m) => m.id === id) || {name: id}).name;
const R = {}, V = {};
let maxRun = 1;
for (const r of results) { ((R[r.model] ||= {})[r.thread] ||= {})[r.run] = r; if (r.run > maxRun) maxRun = r.run; }
for (const v of (G && G.verdicts) || []) ((V[v.model] ||= {})[v.thread] ||= {})[v.run] = v;
const RUNS = Array.from({length: Math.max(maxRun, 1)}, (_, i) => i + 1);

const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const THREADS = [...SC.threads].sort((a, b) => toMin(a.messages[0].time) - toMin(b.messages[0].time)); // the day, in order
const ORD = Object.fromEntries(THREADS.map((t, i) => [t.id, i]));
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

// ---------- state
const S = {
  thread: TH[Q.get('thread')] ? Q.get('thread') : null,
  channel: null, dm: null,
  model: MODELS.some((m) => m.id === Q.get('model')) ? Q.get('model') : MODELS[0].id,
  run: RUNS.includes(+Q.get('run')) ? +Q.get('run') : 'all',
  tab: ['activity', 'score', 'memory'].includes(Q.get('tab')) ? Q.get('tab') : 'activity',
  memArea: Q.get('area') || null,
  panel: Q.has('panel') ? Q.get('panel') !== '0' : innerWidth > 860,
  nav: false,
  board: Q.get('view') === 'scoreboard',
  local: {}, myReacts: {},
};
S.channel = S.thread ? TH[S.thread].channel : CHANNELS.includes(Q.get('channel')) ? Q.get('channel')
  : [...CHANNELS].sort((a, b) => inChannel(b).length - inChannel(a).length)[0];
const visited = new Set([S.channel]);
let F = null; // capture frame, when rendering from t

// ---------- results helpers
const rec = (m, th, r) => { const x = R[m] && R[m][th] && R[m][th][r]; return x && x.decision !== 'error' ? x : null; };
function verdict(m, th, r) { // true / false / null (unknown)
  const x = rec(m, th, r); if (!x) return null;
  const v = V[m] && V[m][th] && V[m][th][r];
  if (v) return !!v.correct;
  const e = EXPECT[th]; if (!e) return null;
  if (x.decision === 'skip') return e === 'skip';
  return e === 'skip' ? false : null; // spoke where needed, but nobody judged whether it named the right problem
}
const noteOf = (m, th, r) => { const v = V[m] && V[m][th] && V[m][th][r]; return v && v.note ? v.note : ''; };
const runsSel = () => (S.run === 'all' ? RUNS : [S.run]);
function outcome(m, th, runSel = S.run) {
  const recs = (runSel === 'all' ? RUNS : [runSel]).map((r) => ({run: r, rec: rec(m, th, r), ok: verdict(m, th, r)})).filter((x) => x.rec);
  const spoke = recs.filter((x) => x.rec.decision === 'speak');
  const judged = recs.filter((x) => x.ok !== null);
  const mark = !judged.length ? null : judged.every((x) => x.ok) ? 'ok' : judged.some((x) => x.ok) ? 'mix' : 'bad';
  return {n: recs.length, recs, spoke: spoke.length, shown: spoke[0] || null, mark};
}
function stats(m, w = () => 1, runSel = S.run) {
  const s = {n: 0, need: 0, needOk: 0, quiet: 0, quietOk: 0, graded: 0, ok: 0, spoke: 0, skipped: 0, wN: 0, wTok: 0, wMs: 0, wCost: 0, tok: 0, ms: 0, cost: 0};
  for (const th of THREADS) {
    const k = w(th.id); if (!k) continue;
    for (const r of (runSel === 'all' ? RUNS : [runSel])) {
      const x = rec(m, th.id, r); if (!x) continue;
      const tok = (x.input_tokens || 0) + (x.output_tokens || 0), ok = verdict(m, th.id, r), e = EXPECT[th.id], speak = x.decision === 'speak';
      s.n += k; s.tok += k * tok; s.ms += k * (x.duration_ms || 0); s.cost += k * (x.cost_usd || 0);
      if (speak) s.spoke += k; else s.skipped += k;
      if (e === 'speak') { s.need += k; if (ok) s.needOk += k; } else if (e === 'skip') { s.quiet += k; if (ok) s.quietOk += k; }
      if (ok !== null) { s.graded += k; if (ok) s.ok += k; }
      if (speak && ok === false) { s.wN += k; s.wTok += k * tok; s.wMs += k * (x.duration_ms || 0); s.wCost += k * (x.cost_usd || 0); }
    }
  }
  return s;
}
const fTok = (n) => (n >= 9950 ? (n / 1000).toFixed(0) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)));
const fSec = (ms) => (ms / 1000).toFixed(ms >= 99950 ? 0 : 1) + 's';
const fUsd = (v) => '$' + (v >= 10 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v > 0 ? v.toFixed(4) : '0');

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
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24"><path d="${P[n]}"/></svg>`;
// Tacet: a whole rest, the sign for "this instrument is silent"
const TACET = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="8" width="16" height="2.2" rx="1.1"/><rect x="7.5" y="10" width="9" height="5" rx="1"/></svg>';
const LOGO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17V10a4 4 0 0 1 8 0v7M12 10a4 4 0 0 1 8 0v7"/></svg>';
const av = (name, cls = '') => { const p = people[name] || {color: '#52666a', initials: name.slice(0, 1).toUpperCase()}; return `<span class="av ${cls}" style="background:${p.color}">${esc(p.initials)}</span>`; };
const bot = (cls = '') => `<span class="av bot ${cls}">${TACET}</span>`;
const areaFor = (name) => { const n = name.trim().toLowerCase(), A = SC.company.memory; return A.find((a) => a.area.toLowerCase() === n) || A.find((a) => a.area.toLowerCase().startsWith(n) || n.startsWith(a.area.toLowerCase())) || null; };
function fmt(s, agent) {
  let h = esc(s);
  if (agent) {
    h = h.replace(/\[memory:\s*([^\]]+)\]/gi, (m, a) => `<button class="cite" data-act="mem" data-arg="${a.trim()}" title="Open in company memory">${ic('book')}${a.trim().replace(/\s*\(.*\)$/, '')}</button>`)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>');
  }
  h = h.replace(/(^|[\s(])@([A-Za-z][\w-]*)/g, '$1<span class="mention">@$2</span>')
    .replace(/(^|[\s(])#([a-z][\w-]*)/g, (m, a, c) => (CHANNELS.includes(c) ? `${a}<span class="chanref">#${c}</span>` : m));
  return h.replace(/\n/g, '<br>');
}
const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x) => { x = clamp(x); return 1 - Math.pow(1 - x, 3); };
const fx = (p, dy = 8) => (p >= 1 ? '' : `opacity:${p.toFixed(3)};transform:translateY(${((1 - p) * dy).toFixed(2)}px)`);
const grow = (html, p) => (!F ? html : p <= 0 ? '' : `<div class="grow-w" style="grid-template-rows:${Math.min(1, p).toFixed(4)}fr;opacity:${Math.min(1, p).toFixed(3)}"><div>${html}</div></div>`);
const mark = (k, cls = 'mk2') => (k ? `<span class="${cls} ${k}" title="${k === 'ok' ? 'correct' : k === 'bad' ? 'wrong' : 'correct in some runs'}">${k === 'ok' ? ic('check') : k === 'bad' ? ic('x') : '<svg class="ic" viewBox="0 0 24 24"><path d="M6 12h12"/></svg>'}</span>` : '');
const pips = (o, th) => `<span class="pips">${RUNS.map((r) => { const x = o.recs.find((y) => y.run === r); return `<i class="pip ${x ? x.rec.decision : ''} ${x && x.ok === false ? 'wrong' : ''}" title="run ${r}: ${x ? (x.rec.decision === 'speak' ? 'spoke' : 'stayed quiet') : 'no data'}"></i>`; }).join('')}</span>`;

// ---------- chrome: top bar and rail
function renderTop() {
  $('#top').innerHTML = `<div class="brand"><span class="logo">${LOGO}</span>Murmo</div>
    <div class="navs"><span class="tbtn">${ic('left')}</span><span class="tbtn">${ic('right')}</span><span class="tbtn">${ic('clock')}</span></div>
    <div class="search">${ic('search')}Search ${esc(SC.company.name)}</div>
    <div class="right">${SAMPLE ? '<span class="badge-sample" title="Invented values. Drop data/results.json and data/grades.json next to them to see the real run.">SAMPLE DATA</span>' : !GRADED ? '<span class="badge-pending" title="data/grades.json not found yet">UNGRADED</span>' : ''}
      <button class="agent-btn" data-act="toggle-panel" title="Tacet, the agent">${bot('xs')}<span>Tacet</span></button>
      <span class="tbtn">${ic('help')}</span><span class="av sm me" style="background:#3f6b73">Y</span></div>`;
  $('#rail').innerHTML = `<span class="ws on" title="${esc(SC.company.name)}">${esc(SC.company.name.slice(0, 2))}</span><span class="ws" style="background:#5b4a7a">Lk</span><span class="ws" style="background:#7a5a3a">Od</span><span class="ws add">${ic('plus')}</span>
    <span class="sep"></span>
    <span class="rnav on"><i>${ic('home')}</i>Home</span><span class="rnav"><i>${ic('dm')}</i>DMs</span><span class="rnav"><i>${ic('bell')}</i>Activity</span>`;
  $('#ctools').innerHTML = '<span><b>B</b></span><span><em>I</em></span><span><s>S</s></span><span>' + ic('hash') + '</span>';
  $('#cfoot').innerHTML = `<span>${ic('plus')}</span><span>${ic('smile')}</span><span>${ic('at')}</span><span>${ic('clip')}</span><button class="send" title="Send">${ic('send')}</button>`;
}

// ---------- sidebar
function unread(ch) {
  if (F) { const nx = THREADS[F.idx + 1]; return nx && nx.channel === ch && ch !== F.active ? nx.messages.length : 0; } // the next thread lands, then we jump to it
  return visited.has(ch) ? 0 : inChannel(ch).reduce((n, t) => n + t.messages.length, 0);
}
function renderSide() {
  let i = 0;
  const st = () => (F ? ` style="${fx(F.sideP(i++), 0)}${F.sideP(i - 1) < 1 ? `;transform:translateX(${((1 - F.sideP(i - 1)) * -10).toFixed(2)}px)` : ''}"` : '');
  const active = F ? F.active : S.dm ? null : S.channel;
  let h = `<div class="side-head"><b>${esc(SC.company.name)} ${ic('down')}</b><span class="compose">${ic('edit')}</span></div><div class="side-scroll">`;
  h += `<span class="s-item"${st()}>${ic('thread')}<span class="nm">Threads</span></span><span class="s-item"${st()}>${ic('at')}<span class="nm">Mentions &amp; reactions</span></span>`;
  h += `<div class="s-sec"${st()}>${ic('down')}Channels</div>`;
  CHANNELS.forEach((ch, j) => {
    const n = unread(ch), bp = F ? F.badgeP : 1;
    h += `<button class="s-item ${active === ch ? 'on' : ''} ${n && bp > 0 ? 'unread' : ''}" data-act="channel" data-arg="${ch}"${st()}>${ic('hash')}<span class="nm">${ch}</span>${n && bp > 0 ? `<span class="cnt"${bp < 1 ? ` style="transform:scale(${(0.4 + 0.6 * bp).toFixed(3)});opacity:${bp.toFixed(3)}"` : ''}>${n}</span>` : ''}</button>`;
  });
  h += `<div class="s-sec"${st()}>${ic('down')}Direct messages</div>`;
  Object.keys(people).slice(0, 6).forEach((n) => {
    h += `<button class="s-item ${S.dm === n && !F ? 'on' : ''}" data-act="dm" data-arg="${esc(n)}"${st()}><span class="dot ${hash(n) % 3 ? 'live' : ''}"></span><span class="nm">${esc(n)}</span></button>`;
  });
  h += `<div class="s-sec"${st()}>${ic('down')}Apps</div><button class="s-item" data-act="open-agent"${st()}>${bot('xs')}<span class="nm">Tacet</span><span class="app-tag">APP</span></button></div>`;
  // calm status: how often the agent kept quiet
  const seen = THREADS.filter((t) => (F ? F.decided(t.id) : true) && outcome(S.model, t.id).n);
  const q = seen.filter((t) => outcome(S.model, t.id).spoke === 0).length;
  h += `<button class="side-foot" data-act="open-agent"${F ? ` style="${fx(F.sideP(16), 0)}"` : ''}>${bot('sm')}<span><b>Tacet is reading</b>${seen.length ? `Quiet in ${q} of ${seen.length} thread${seen.length === 1 ? '' : 's'} today` : 'Nothing to say so far'}</span></button>`;
  $('#side').innerHTML = h;
}

// ---------- main column
function reactsHTML(key) {
  const h = hash('r' + key), base = h % 4 === 0 ? [[['👍', '✅', '👀', '🙏'][(h >>> 3) % 4], 1 + ((h >>> 7) % 3)]] : [];
  const mine = S.myReacts[key];
  if (mine) { const b = base.find((x) => x[0] === '👍'); if (b) b[1]++; else base.push(['👍', 1]); }
  return (base.length ? `<div class="reacts">${base.map(([e, n]) => `<button class="react ${mine && e === '👍' ? 'mine' : ''}" data-act="react" data-arg="${key}">${e} ${n}</button>`).join('')}</div>` : '') +
    (F ? '' : `<div class="hov"><button data-act="react" data-arg="${key}" title="React with 👍">👍</button><button data-act="react" data-arg="${key}" title="Add reaction">${ic('smile')}</button><button data-act="noop" title="Reply in thread">${ic('thread')}</button></div>`);
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
function agentHTML(th) {
  const o = outcome(S.model, th.id), last = th.messages[th.messages.length - 1];
  const many = S.run === 'all' && o.n > 1;
  if (!o.n) return `<div class="quiet pending"><span class="q-ic">${TACET}</span><span class="q-txt">not run yet</span></div>`;
  if (!o.spoke) {
    const missed = o.recs.some((x) => x.ok === false);
    return `<div class="quiet" title="Tacet read this thread and had nothing worth interrupting for."><span class="q-ic">${TACET}</span><span class="q-txt">read · stayed quiet</span>${many ? `<span class="q-sub">${o.n} of ${o.n} runs</span>` : ''}${missed ? `<span class="tag bad">${ic('x')}missed: a human needed this</span>` : ''}</div>`;
  }
  const x = o.shown;
  return `<div class="msg agent">${bot('sm')}<div class="body"><div class="meta"><b>Tacet</b><span class="app-tag" style="background:#f3dccb;color:#8a4a1c">APP</span><time>${fromMin(toMin(last.time) + 1)}</time></div>
    <div class="text">${fmt(x.rec.message, true)}</div>
    <div class="foot">${verdictTag(x, th.id)}<span class="via">${esc(modelName(S.model))} · run ${x.run}</span>${many ? `${pips(o)}<span>spoke in ${o.spoke} of ${o.n} runs</span>` : ''}</div></div></div>`;
}
function threadHTML(th) {
  const sel = F ? F.cur === th.id : S.thread === th.id;
  const mp = (j) => (F ? F.msgP(th.id, j) : 1);
  return `<div class="thread ${sel ? 'sel' : ''}" id="th-${th.id}" data-act="thread" data-arg="${th.id}">${grow(msgHTML(th.messages[0], th.id + ':0'), mp(0))}
    <div class="replies">${th.messages.slice(1).map((m, j) => grow(msgHTML(m, `${th.id}:${j + 1}`, true), mp(j + 1))).join('')}${grow(agentHTML(th), F ? F.agentP(th.id) : 1)}</div></div>`;
}
function renderMain(scroll = 'keep') {
  const list = $('#mlist'), keep = list.scrollTop;
  const ch = F ? F.channel : S.channel;
  if (S.dm && !F) {
    $('#mhead').innerHTML = `<button class="hbtn menu" data-act="toggle-nav">${ic('menu')}</button><h1>${av(S.dm, 'xs')}&nbsp;${esc(S.dm)}</h1><span class="topic">${esc(people[S.dm].role)}</span>`;
    list.innerHTML = `<div class="push"></div><div class="intro">${av(S.dm, 'lg')}<h2 style="margin-top:10px">${esc(S.dm)}</h2><p>${esc(people[S.dm].role)} at ${esc(SC.company.name)}. This is the very beginning of your direct messages.</p></div>` + localHTML('dm:' + S.dm);
    $('#cinput').placeholder = `Message ${S.dm}`;
    return;
  }
  const ths = inChannel(ch).filter((t) => !F || F.arrived(t.id));
  const members = [...new Set(inChannel(ch).flatMap((t) => t.messages.map((m) => m.who)))];
  $('#mhead').innerHTML = `<button class="hbtn menu" data-act="toggle-nav" title="Channels">${ic('menu')}</button><h1>${ic('hash')}${ch}</h1>
    <span class="topic">${inChannel(ch).length} thread${inChannel(ch).length === 1 ? '' : 's'} today · Tacet reads along</span>
    <span class="stack"><span class="avs">${members.slice(0, 3).map((n) => av(n, 'xs')).join('')}${bot('xs')}</span>${members.length + 1}</span>
    <button class="hbtn" data-act="toggle-panel" title="Tacet, the agent">${bot('xs')}</button>`;
  list.innerHTML = `<div class="push"></div><div class="intro"><div class="big">${ic('hash')}</div><h2>#${ch}</h2><p>This is the very beginning of #${ch}. Tacet reads every thread here and speaks only when someone needs it.</p></div>
    <div class="day"><span>Today · ${esc(SC.company.today || '')}</span></div>` + ths.map(threadHTML).join('') + localHTML(ch);
  list.style.opacity = F && F.mainFade < 1 ? F.mainFade.toFixed(3) : '';
  $('#cinput').placeholder = `Message #${ch}`;
  if (F) return;
  if (scroll === 'thread' && S.thread && TH[S.thread].channel === ch) { const el = $('#th-' + S.thread); if (el) list.scrollTop = Math.max(0, el.offsetTop - list.offsetTop - Math.max(12, (list.clientHeight - el.offsetHeight) / 2)); }
  else if (scroll === 'bottom' || scroll === 'thread') list.scrollTop = list.scrollHeight;
  else list.scrollTop = keep;
}
const localHTML = (k) => (F ? '' : (S.local[k] || []).map((m) => `<div class="thread" style="cursor:default">${msgHTML(m)}</div>`).join(''));

// ---------- agent panel
function meter(cls, label, num, den, big) {
  const n = Math.round(num), vis = den > 0 && den <= 20 ? `<div class="segs">${Array.from({length: den}, (_, i) => `<i class="${i < n ? 'f' : ''}"></i>`).join('')}</div>` : `<div class="bar"><i style="width:${den ? (100 * num / den).toFixed(1) : 0}%"></i></div>`;
  return big ? `<div class="m2 ${cls}"><div class="k"><span>${label}</span><b>${den ? `${n}/${den}` : 'n/a'}</b></div>${vis}</div>`
    : `<div class="meter ${cls}"><span>${label}</span>${vis}<span class="num">${den ? `${n}/${den}` : 'n/a'}</span></div>`;
}
function scoreCard(m, w) {
  const full = stats(m.id), s = w ? stats(m.id, w) : full;
  if (!full.n) return `<div class="sc"><div class="sc-h"><b>${esc(m.name)}</b><span class="pct"><small>no results yet</small></span></div></div>`;
  const body = GRADED
    ? meter('s', 'Spoke when needed', s.needOk, full.need) + meter('q', 'Stayed quiet', s.quietOk, full.quiet) +
      `<div class="sc-w"><span class="k">${Math.round(s.wN)} message${Math.round(s.wN) === 1 ? '' : 's'} nobody needed</span><span>${fTok(s.wTok)} tok</span><span>${fSec(s.wMs)}</span><span>${fUsd(s.wCost)}</span></div>`
    : meter('s', 'Spoke', s.spoke, full.n) + meter('q', 'Stayed quiet', s.skipped, full.n) +
      `<div class="sc-w"><span class="k">total spend</span><span>${fTok(s.tok)} tok</span><span>${fSec(s.ms)}</span><span>${fUsd(s.cost)}</span></div>`;
  return `<button class="sc ${m.id === S.model ? 'on' : ''}" data-act="model" data-arg="${m.id}"><div class="sc-h"><b>${esc(m.name)}</b><span class="pct">${GRADED && full.graded ? `${Math.round(100 * s.ok / full.graded)}%<small>${Math.round(s.ok)}/${full.graded} correct</small>` : '<small>awaiting grades</small>'}</span></div>${body}</button>`;
}
function panelActivity() {
  const s = stats(S.model);
  let h = '';
  if (!s.n) h += `<div class="note-box">No results for ${esc(modelName(S.model))} yet. Run <code>node agent/run.mjs</code>.</div>`;
  else if (GRADED) {
    h += `<div class="hero"><div class="tile s"><div class="k">Spoke when needed</div><div class="v">${s.needOk}<small>/${s.need}</small></div></div><div class="tile q"><div class="k">Stayed quiet when it should</div><div class="v">${s.quietOk}<small>/${s.quiet}</small></div></div><div class="tile"><div class="k">Overall correct</div><div class="v">${s.graded ? Math.round(100 * s.ok / s.graded) : 0}<small>%</small></div></div></div>`;
    h += s.wN ? `<div class="waste">Spent on ${s.wN} message${s.wN === 1 ? '' : 's'} nobody needed<div class="nums"><span>${fTok(s.wTok)}<small>tokens</small></span><span>${fSec(s.wMs)}<small>waiting</small></span><span>${fUsd(s.wCost)}<small>of ${fUsd(s.cost)} total</small></span></div></div>`
      : `<div class="waste zero">Spent on messages nobody needed<div class="nums"><span>nothing</span></div></div>`;
  } else {
    h += `<div class="hero"><div class="tile s"><div class="k">Spoke</div><div class="v">${s.spoke}<small>/${s.n}</small></div></div><div class="tile q"><div class="k">Stayed quiet</div><div class="v">${s.skipped}<small>/${s.n}</small></div></div><div class="tile"><div class="k">Spend</div><div class="v" style="font-size:17px">${fUsd(s.cost)}</div></div></div>
      <div class="note-box">Not graded yet. When <code>data/grades.json</code> arrives, the scores appear here.</div>`;
  }
  h += `<div class="lbl">Today's threads <span style="text-transform:none;letter-spacing:0;font-weight:500">${S.run === 'all' ? `all ${RUNS.length} runs` : 'run ' + S.run}</span></div>`;
  for (const th of THREADS) {
    const o = outcome(S.model, th.id), on = S.thread === th.id;
    const label = !o.n ? 'no data' : !o.spoke ? 'quiet' : o.spoke === o.n ? 'spoke' : `spoke ${o.spoke}/${o.n}`;
    h += `<button class="row ${on ? 'on' : ''}" data-act="thread" data-arg="${th.id}"><time>${th.messages[0].time}</time><span><span class="ch">#${th.channel}</span><div class="sn">${esc(th.messages[0].text)}</div></span>
      <span class="oc ${!o.n ? 'none' : o.spoke ? 'speak' : 'skip'}">${S.run === 'all' && o.n ? pips(o) : ''}${label}${mark(o.mark)}</span></button>`;
    if (on) h += detailHTML(th);
  }
  return h;
}
function detailHTML(th) {
  let h = '<div class="detail">';
  if (EXPECT[th.id]) h += `<div class="exp">Graders expected the agent to <b>${EXPECT[th.id] === 'speak' ? 'speak' : 'stay quiet'}</b> here.</div>`;
  for (const m of MODELS) {
    const o = outcome(m.id, th.id, 'all');
    h += `<div class="mrow ${m.id === S.model ? 'on' : ''}"><span>${esc(m.name)}</span>${pips(o)}<span class="w">${!o.n ? 'no data' : !o.spoke ? 'stayed quiet' : o.spoke === o.n ? 'spoke' : `spoke in ${o.spoke} of ${o.n}`}${o.mark ? ` · ${o.mark === 'ok' ? 'correct' : o.mark === 'bad' ? 'wrong' : 'mixed'}` : ''}</span></div>`;
  }
  for (const x of outcome(S.model, th.id).recs) {
    const note = noteOf(S.model, th.id, x.run);
    h += `<div class="runmsg"><div class="h"><b>Run ${x.run}</b><span class="oc ${x.rec.decision}">${x.rec.decision === 'speak' ? 'spoke' : 'stayed quiet'}</span>${verdictTag(x, th.id)}<span class="cost">${fSec(x.rec.duration_ms || 0)} · ${fUsd(x.rec.cost_usd || 0)}</span></div>
      ${x.rec.decision === 'speak' ? `<div class="m">${fmt(x.rec.message, true)}</div>` : ''}${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
  }
  return h + '</div>';
}
function panelScore() {
  let h = '';
  if (F) {
    h += `<div class="progress"><span>Threads read ${F.read}/${THREADS.length}</span><span class="slots">${THREADS.map((t, i) => { const o = outcome(S.model, t.id); return `<i class="${F.decided(t.id) ? (o.spoke ? 'speak' : 'skip') : i === F.idx ? 'cur' : ''}"></i>`; }).join('')}</span></div>`;
  } else {
    h += `<div class="lbl">${GRADED ? 'Who knew when to stay quiet' : 'What each model did'}<button data-act="board">${ic('expand')}Full view</button></div>`;
    if (!GRADED) h += `<div class="note-box">Not graded yet. Scores need <code>data/grades.json</code>.</div>`;
  }
  h += MODELS.map((m, k) => scoreCard(m, F ? F.w(k) : null)).join('');
  if (!F && GRADED) h += `<p style="font-size:12px;color:var(--muted);margin:10px 2px 0">A message nobody needed is one the agent posted where silence was expected, or one that named the wrong problem. Tokens are everything the model read and wrote for those calls.</p>`;
  return h;
}
function panelMemory() {
  const c = SC.company, hl = S.memArea ? areaFor(S.memArea) : null;
  return `<div class="mem-about"><b>${esc(c.name)}</b> · ${esc(c.about || '')}<br>Today is ${esc(c.today || '')}. This is everything Tacet knows besides the thread it is reading.</div>` +
    c.memory.map((a) => `<div class="mem ${/people/i.test(a.area) ? 'people' : ''} ${hl === a ? 'hl' : ''}" ${hl === a ? 'id="mem-hl"' : ''}><h3>${ic('book')}${esc(a.area)}<span>${a.facts.length} fact${a.facts.length === 1 ? '' : 's'}</span></h3><ul>${a.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`).join('');
}
function renderPanel(scroll) {
  const body = $('#panel .p-body'), keep = body ? body.scrollTop : 0, tab = F ? 'score' : S.tab;
  $('#panel').innerHTML = `<div class="p-head">${bot('lg')}<div class="t"><h2>Tacet <span class="app-tag">APP</span>${SAMPLE ? '<span class="badge-sample">SAMPLE DATA</span>' : ''}</h2><p>Reads every thread. Speaks only when someone needs it.</p></div><button class="hbtn" data-act="toggle-panel" title="Close">${ic('x')}</button></div>
    <div class="p-ctl"><div class="seg">${MODELS.map((m) => `<button class="${m.id === S.model ? 'on' : ''}" data-act="model" data-arg="${m.id}">${esc(m.name)}</button>`).join('')}</div>
      <div class="ctl-row"><div class="seg runs"><button class="${S.run === 'all' ? 'on' : ''}" data-act="run" data-arg="all">All runs</button>${RUNS.map((r) => `<button class="${S.run === r ? 'on' : ''}" data-act="run" data-arg="${r}">${r}</button>`).join('')}</div></div></div>
    <div class="tabs">${[['activity', 'Activity'], ['score', 'Scoreboard'], ['memory', 'Company memory']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="tab" data-arg="${k}">${l}</button>`).join('')}</div>
    <div class="p-body">${tab === 'score' ? panelScore() : tab === 'memory' ? panelMemory() : panelActivity()}</div>`;
  if (F) return;
  const nb = $('#panel .p-body');
  if (scroll === 'focus') { const el = tab === 'memory' ? $('#mem-hl') : $('#panel .row.on'); if (el) nb.scrollTop = Math.max(0, el.offsetTop - nb.offsetTop - 60); }
  else if (scroll !== 'top') nb.scrollTop = keep;
}

// ---------- full scoreboard
function boardHTML(wf, colStyle = () => '') {
  const sub = `${THREADS.length} threads · ${RUNS.length} run${RUNS.length === 1 ? '' : 's'}${S.run === 'all' ? '' : ' (showing run ' + S.run + ')'} · ${MODELS.length} models · one question: speak or stay quiet?`;
  const cols = MODELS.map((m, k) => {
    const full = stats(m.id), s = wf ? stats(m.id, wf(k)) : full;
    if (!full.n) return `<div class="col" style="${colStyle(k)}"><h3>${esc(m.name)}</h3><div class="sub" style="margin-top:8px">no results yet</div></div>`;
    const w0 = Math.round(s.wN) === 0 && GRADED;
    return `<div class="col ${m.id === S.model ? 'on' : ''}" style="${colStyle(k)}"><h3>${esc(m.name)}</h3>
      ${GRADED && full.graded ? `<div class="big">${Math.round(100 * s.ok / full.graded)}<small>%</small></div><div class="sub">${Math.round(s.ok)} of ${full.graded} calls correct</div>` : `<div class="big">${Math.round(s.skipped)}<small>/${full.n}</small></div><div class="sub">stayed quiet · awaiting grades</div>`}
      ${GRADED ? meter('s', 'Spoke when needed', s.needOk, full.need, true) + meter('q', 'Stayed quiet when it should', s.quietOk, full.quiet, true) : meter('s', 'Spoke', s.spoke, full.n, true) + meter('q', 'Stayed quiet', s.skipped, full.n, true)}
      <div class="w"><div class="k">${GRADED ? `${Math.round(s.wN)} message${Math.round(s.wN) === 1 ? '' : 's'} nobody needed` : 'Total spend'}</div>
      <div class="g ${w0 ? 'zero' : ''}"><div>${fTok(GRADED ? s.wTok : s.tok)}<small>tokens</small></div><div>${fSec(GRADED ? s.wMs : s.ms)}<small>seconds</small></div><div>${fUsd(GRADED ? s.wCost : s.cost)}<small>dollars</small></div></div></div></div>`;
  }).join('');
  return `<div class="board-h"><div><h2>Knowing when to stay quiet</h2><p>${sub}</p></div><div class="r">${SAMPLE ? '<span class="badge-sample">SAMPLE DATA</span>' : !GRADED ? '<span class="badge-pending">UNGRADED</span>' : ''}</div></div>
    <div class="cols">${cols}</div>
    <div class="board-f"><span><i style="background:var(--spoke)"></i>spoke, and named the right problem</span><span><i style="background:var(--quiet)"></i>read the thread and stayed quiet, correctly</span></div>`;
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
      const same = S.thread === arg && el.classList.contains('row');
      S.thread = same ? null : arg; S.dm = null;
      if (!same) { const ch = TH[arg].channel, moved = ch !== S.channel; S.channel = ch; visited.add(ch); ms = moved || el.classList.contains('row') ? 'thread' : 'keep'; if (S.tab === 'activity' && !el.classList.contains('row')) ps = 'focus'; }
    }
    else if (act === 'model') S.model = arg;
    else if (act === 'run') S.run = arg === 'all' ? 'all' : +arg;
    else if (act === 'tab') { S.tab = arg; ps = 'top'; }
    else if (act === 'mem') { S.tab = 'memory'; S.memArea = arg; S.panel = true; ps = 'focus'; e.stopPropagation(); }
    else if (act === 'toggle-panel') S.panel = !S.panel;
    else if (act === 'open-agent') { S.panel = true; S.nav = false; }
    else if (act === 'toggle-nav') S.nav = !S.nav;
    else if (act === 'close-sheets') S.nav = false;
    else if (act === 'board') S.board = true;
    else if (act === 'close-board') S.board = false;
    else if (act === 'react') { S.myReacts[arg] = !S.myReacts[arg]; }
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
people[ME] = {role: '', color: '#3f6b73', initials: 'Y'};

// ---------- capture: everything below is a pure function of t (seconds)
const TL = {intro: 1.8, per: 1.55, msg0: 0.08, msgGap: 0.11, strip: 0.42, decide: 0.72, decideGap: 0.09, dur: 20};
TL.outro = TL.intro + THREADS.length * TL.per;
TL.dur = Math.max(20, Math.ceil(TL.outro + 2.4));
const tStart = (i) => TL.intro + i * TL.per;
const tDecide = (k, i) => tStart(i) + TL.decide + Math.min(k, 3) * TL.decideGap;
const featK = () => Math.max(0, MODELS.findIndex((m) => m.id === S.model));
function frame(t) {
  const idx = t < TL.intro ? -1 : Math.min(THREADS.length - 1, Math.floor((t - TL.intro) / TL.per));
  const cur = idx >= 0 ? THREADS[idx] : null, u = idx >= 0 ? t - tStart(idx) : 0;
  const channel = (cur || THREADS[0]).channel, prev = idx > 0 ? THREADS[idx - 1].channel : null;
  const fk = featK();
  return {
    t, idx, channel, cur: cur && t < TL.outro ? cur.id : null,
    active: t > TL.intro - 0.35 ? channel : null,
    mainFade: idx >= 0 && channel !== prev ? ease(u / 0.14) : 1,
    arrived: (id) => t >= tStart(ORD[id]),
    msgP: (id, j) => ease((t - tStart(ORD[id]) - TL.msg0 - j * TL.msgGap) / 0.18),
    agentP: (id) => ease((t - tDecide(fk, ORD[id]) - 0.03) / 0.24),
    decided: (id) => t >= tDecide(fk, ORD[id]),
    read: THREADS.filter((x) => t >= tDecide(3, ORD[x.id])).length,
    w: (k) => (id) => ease((t - tDecide(k, ORD[id])) / 0.3),
    sideP: (i) => ease((t - 0.1 - i * 0.055) / 0.4),
    badgeP: ease((t - (idx < 0 ? 0.85 : tStart(idx + 1) - 0.4)) / 0.2),
  };
}
function stripHTML(t) {
  const p = ease((t - 1.0) / 0.4); // the strip arrives once, during the intro, and stays put so the layout never jumps
  if (!F || p <= 0) return '';
  const i = F.idx, th = THREADS[Math.max(0, i)], reading = i >= 0 && t - tStart(i) >= TL.strip;
  const last = th.messages[th.messages.length - 1];
  const chips = MODELS.slice(0, 4).map((m, k) => {
    const d = i < 0 ? -1 : t - tDecide(k, i), o = outcome(m.id, th.id);
    if (!reading) return `<div class="chip ${m.id === S.model ? 'feat' : ''}"><div class="nm">${esc(m.name)}</div><div class="st"><span class="think">${[0, 1, 2].map(() => '<i style="opacity:.22"></i>').join('')}</span></div></div>`;
    if (d < 0 || !o.n) return `<div class="chip ${m.id === S.model ? 'feat' : ''}"><div class="nm">${esc(m.name)}</div><div class="st"><span class="think">${[0, 1, 2].map((j) => `<i style="opacity:${(0.25 + 0.75 * Math.max(0, Math.sin(t * 11 - j * 1.1 - k))).toFixed(3)}"></i>`).join('')}</span></div></div>`;
    const pop = 1 + 0.07 * Math.sin(Math.PI * clamp(d / 0.24));
    const label = !o.spoke ? 'quiet' : o.spoke === o.n ? 'spoke' : `spoke ${o.spoke}/${o.n}`;
    return `<div class="chip ${o.spoke ? 'speak' : 'skip'} ${m.id === S.model ? 'feat' : ''}" style="transform:scale(${pop.toFixed(4)})"><div class="nm">${esc(m.name)}${S.run === 'all' ? pips(o) : ''}</div><div class="st">${label}${mark(o.mark, 'mk')}</div></div>`;
  }).join('');
  const line = i < 0 ? '<b>Tacet</b> is reading along. Four models, one question per thread: speak or stay quiet?'
    : `<b>Tacet</b> ${reading ? 'read' : 'is reading'} the thread in <b>#${th.channel}</b>${reading ? ' at ' + fromMin(toMin(last.time) + 1) : ''}. Four models, same question: speak or stay quiet?`;
  return grow(`<div class="strip" style="${fx(p, 14)}"><div class="strip-top">${bot('xs')}<span>${line}</span><span class="n">${Math.max(0, i + 1)}/${THREADS.length}</span></div><div class="chips">${chips}</div></div>`, p);
}
function draw(t) {
  t = Math.max(0, Math.min(TL.dur, +t || 0));
  F = frame(t);
  renderSide(); renderMain(); renderPanel();
  $('#strip').innerHTML = stripHTML(t);
  $('#main').style.opacity = ease((t - 0.35) / 0.5).toFixed(3);
  $('#panel').style.opacity = ease((t - 0.6) / 0.5).toFixed(3);
  // end card: the full scoreboard
  const o = $('#overlay'), p = ease((t - TL.outro - 0.15) / 0.55);
  o.classList.toggle('show', p > 0);
  if (p > 0) {
    o.style.background = `rgba(7,24,27,${(0.66 * p).toFixed(3)})`;
    const fill = (k) => { const f = ease((t - TL.outro - 0.45 - k * 0.12) / 0.85); return () => f; };
    o.innerHTML = `<div class="board" style="opacity:${p.toFixed(3)};transform:translateY(${((1 - p) * 26).toFixed(2)}px) scale(${(0.965 + 0.035 * p).toFixed(4)})">${boardHTML(fill, (k) => fx(ease((t - TL.outro - 0.3 - k * 0.1) / 0.4), 12))}</div>`;
  } else o.innerHTML = '';
}

// ---------- boot
renderTop();
if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 4000))]);
if (CAPTURE) {
  S.panel = true; S.board = false;
  app.classList.remove('no-panel');
  let external = false;
  window.SIM = {duration: TL.dur, ready: false, render(t) { external = true; draw(t); }};
  if (Q.has('t')) draw(+Q.get('t'));
  else {
    draw(0);
    // preview driver only; it stops for good the moment a recorder calls SIM.render(t)
    if (Q.get('autoplay') !== '0') { let t0 = null; const tick = (now) => { if (external) return; if (t0 === null) t0 = now; const t = (now - t0) / 1000; draw(Math.min(t, TL.dur)); if (t < TL.dur) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  }
  window.SIM.ready = true;
} else {
  bind();
  renderAll(S.thread ? 'thread' : 'bottom', S.thread || S.memArea ? 'focus' : 'top');
  window.SIM.ready = true;
}
})();
