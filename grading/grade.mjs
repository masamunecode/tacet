// node grading/grade.mjs data/results.json data/grades.json grading/overrides.json
// skip-expected: correct iff decision == skip.
// speak-expected: correct iff decision == speak AND message mentions the right problem (keyword check),
// then every speak verdict is reviewed by hand; overrides.json {"model|thread|run": {correct, note}} wins.
import fs from 'fs';
const [resP, outP, ovP] = process.argv.slice(2);
const ans = JSON.parse(fs.readFileSync(new URL('./answers.json', import.meta.url)));
const res = JSON.parse(fs.readFileSync(resP));
const runs = Array.isArray(res) ? res : res.runs || res.results || res.records;
const ov = ovP && fs.existsSync(ovP) ? JSON.parse(fs.readFileSync(ovP)) : {};
const expect = Object.fromEntries(Object.entries(ans).map(([k, v]) => [k, v.expect]));
const verdicts = runs.map((r) => {
  const a = ans[r.thread]; const m = (r.message || '').toLowerCase();
  let correct, note;
  if (a.expect === 'skip') { correct = r.decision === 'skip'; note = correct ? 'stayed quiet' : 'spoke when nobody needed it'; }
  else if (r.decision === 'skip') { correct = false; note = 'stayed quiet, missed: ' + a.must; }
  else {
    const hit = a.keys.every((k) => m.includes(k)) && a.any.some((k) => m.includes(k));
    correct = hit; note = hit ? 'flagged: ' + a.must : 'spoke but missed: ' + a.must;
  }
  const o = ov[`${r.model}|${r.thread}|${r.run}`]; if (o) ({correct, note} = {...{correct, note}, ...o});
  return {model: r.model, thread: r.thread, run: r.run, correct, note};
});
fs.writeFileSync(outP, JSON.stringify({expect, verdicts}, null, 2));
const by = {};
for (const v of verdicts) { const r = runs.find((x) => x.model === v.model && x.thread === v.thread && x.run === v.run);
  const b = by[v.model] ||= {speakOk: 0, skipOk: 0, n: 0, waste$: 0, wasteTok: 0, wasteMs: 0};
  b.n++; if (v.correct) expect[v.thread] === 'speak' ? b.speakOk++ : b.skipOk++;
  if (expect[v.thread] === 'skip' && r.decision === 'speak') { b.waste$ += r.cost_usd || 0; b.wasteTok += r.output_tokens || 0; b.wasteMs += r.duration_ms || 0; } }
console.table(by);
