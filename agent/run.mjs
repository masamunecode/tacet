#!/usr/bin/env node
// Runs the proactive agent over every thread x model x run and records speak/skip.
//   node agent/run.mjs [--model id[,id]] [--runs N] [--only t02,t05] [--out path] [--fresh]
// Calls the Claude CLI (env CLAUDE_BIN), prompt on stdin. No npm deps.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL_MODELS = ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const CONCURRENCY = 4;
const RETRIES = 2;            // extra attempts after the first failure
const TIMEOUT_MS = 240_000;   // per call

// ---- args
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i === -1) return def;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) { console.error(`--${name} needs a value`); process.exit(2); }
  return v;
};
const flag = (name) => args.includes('--' + name);
if (flag('help') || flag('h')) {
  console.log('node agent/run.mjs [--model id[,id]] [--runs N] [--only t02,t05] [--out path] [--fresh]\n' +
    '  --fresh   ignore records already in the output file (default: keep them and only run what is missing)');
  process.exit(0);
}
const models = opt('model') ? opt('model').split(',').map((s) => s.trim()).filter(Boolean) : ALL_MODELS;
const runs = Number(opt('runs', '3'));
const only = opt('only') ? opt('only').split(',').map((s) => s.trim()).filter(Boolean) : null;
const outPath = path.resolve(process.cwd(), opt('out', path.join(ROOT, 'data', 'results.json')));
if (!Number.isInteger(runs) || runs < 1) { console.error('--runs must be a positive integer'); process.exit(2); }

const BIN = process.env.CLAUDE_BIN || 'claude';
if (!process.env.CLAUDE_BIN) console.error('warning: CLAUDE_BIN is not set, falling back to "claude" on PATH');

// ---- inputs
const scenarios = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'scenarios.json'), 'utf8'));
const systemPrompt = fs.readFileSync(path.join(ROOT, 'agent', 'system.md'), 'utf8').trim();
const threads = scenarios.threads.filter((t) => !only || only.includes(t.id));
if (only) {
  const unknown = only.filter((id) => !scenarios.threads.some((t) => t.id === id));
  if (unknown.length) { console.error('unknown thread id(s): ' + unknown.join(', ')); process.exit(2); }
}

function buildPrompt(company, thread) {
  const L = [];
  L.push(`# Company: ${company.name}`);
  if (company.about) L.push(company.about);
  if (company.today) L.push(`Today is ${company.today}.`);
  L.push('', '# Company memory');
  for (const area of company.memory) {
    L.push('', `## ${area.area}`);
    for (const f of area.facts) L.push(`- ${f}`);
  }
  L.push('', `# Thread in #${thread.channel}`, '');
  for (const m of thread.messages) {
    L.push(`[${m.time}] ${m.who}: ${m.text}${m.attachment ? ` (attachment: ${m.attachment})` : ''}`);
  }
  L.push('', 'Reply with exactly SKIP to stay quiet, or with the message you would post in this thread.');
  return L.join('\n');
}

// "exactly SKIP": tolerate only surrounding whitespace, quotes, backticks and a trailing period.
function isSkip(text) {
  return /^[\s"'`*]*SKIP[\s"'`*.]*$/.test(text);
}

function callOnce(model, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, [
      '-p', '--model', model, '--system-prompt', systemPrompt, '--tools', '', '--strict-mcp-config',
      '--setting-sources', '', '--no-session-persistence', '--output-format', 'json',
    ], {stdio: ['pipe', 'pipe', 'pipe']});
    let out = '', err = '', done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(reject, new Error(`timeout after ${TIMEOUT_MS} ms`)); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish(reject, e));
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      let j;
      try { j = JSON.parse(out); } catch { return finish(reject, new Error(`exit ${code}, no JSON: ${(err || out).trim().slice(0, 300)}`)); }
      if (Array.isArray(j)) j = j.find((x) => x && x.type === 'result') || j[j.length - 1];
      if (!j || j.is_error || typeof j.result !== 'string' || !j.result.trim()) {
        return finish(reject, new Error(`CLI error: ${String(j && (j.result || j.subtype) || err).trim().slice(0, 300)}`));
      }
      finish(resolve, j);
    });
    child.stdin.end(prompt);
  });
}

// ---- results store (resumable; atomic save after every call)
const key = (r) => `${r.model}|${r.thread}|${r.run}`;
const store = new Map();
if (!flag('fresh') && fs.existsSync(outPath)) {
  try {
    for (const r of JSON.parse(fs.readFileSync(outPath, 'utf8'))) store.set(key(r), r);
  } catch (e) {
    console.error(`could not read ${outPath} (${e.message}); pass --fresh to overwrite it`);
    process.exit(1);
  }
}
const threadOrder = new Map(scenarios.threads.map((t, i) => [t.id, i]));
const modelOrder = (m) => { const i = ALL_MODELS.indexOf(m); return i === -1 ? 99 : i; };
function save() {
  const list = [...store.values()].sort((a, b) =>
    modelOrder(a.model) - modelOrder(b.model) || a.model.localeCompare(b.model) ||
    (threadOrder.get(a.thread) ?? 99) - (threadOrder.get(b.thread) ?? 99) || a.run - b.run);
  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1) + '\n');
  fs.renameSync(tmp, outPath);
}

// ---- job list: run by run, so every model has run 1 before anyone starts run 2
const jobs = [];
for (let run = 1; run <= runs; run++) for (const thread of threads) for (const model of models) {
  const prev = store.get(key({model, thread: thread.id, run}));
  if (prev && prev.decision !== 'error') continue;
  jobs.push({model, thread, run});
}
const kept = models.length * threads.length * runs - jobs.length;
console.log(`${jobs.length} call(s) to make` + (kept ? `, ${kept} already in ${path.relative(process.cwd(), outPath)} (use --fresh to redo)` : '') +
  ` -> ${path.relative(process.cwd(), outPath)}`);

let finished = 0, failed = 0;
async function work(job) {
  const {model, thread, run} = job;
  const prompt = buildPrompt(scenarios.company, thread);
  let rec, lastErr;
  for (let attempt = 0; attempt <= RETRIES && !rec; attempt++) {
    try {
      const j = await callOnce(model, prompt);
      const text = j.result.trim();
      const u = j.usage || {};
      const skip = isSkip(text);
      rec = {
        model, thread: thread.id, run,
        decision: skip ? 'skip' : 'speak',
        message: skip ? '' : text,
        duration_ms: Math.round(j.duration_api_ms ?? j.duration_ms ?? 0),
        // everything the model read: fresh input plus cache writes and cache reads
        input_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
        output_tokens: u.output_tokens || 0,
        cost_usd: j.total_cost_usd ?? 0,
      };
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  if (!rec) {
    failed++;
    // kept so the gap is visible; the next invocation retries records with decision "error"
    rec = {model, thread: thread.id, run, decision: 'error', message: '', error: String(lastErr && lastErr.message || lastErr),
      duration_ms: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0};
  }
  store.set(key(rec), rec);
  save();
  finished++;
  const tail = rec.decision === 'speak' ? rec.message.replace(/\s+/g, ' ').slice(0, 70) : rec.decision === 'error' ? rec.error.slice(0, 70) : '';
  console.log(`[${String(finished).padStart(3)}/${jobs.length}] ${model.padEnd(18)} ${thread.id} run ${run}  ${rec.decision.toUpperCase().padEnd(5)} ${tail}`);
}

let next = 0;
await Promise.all(Array.from({length: Math.min(CONCURRENCY, jobs.length)}, async () => {
  while (next < jobs.length) await work(jobs[next++]);
}));
if (!jobs.length) save();
console.log(`done: ${finished - failed} ok, ${failed} failed. ${store.size} record(s) in ${path.relative(process.cwd(), outPath)}`);
process.exitCode = failed ? 1 : 0;
