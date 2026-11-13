# Notes

Murmo is the invented chat app. It hosts two agents built on the same Claude models: a naive one (`agent/baseline.md`) and Tacet (`agent/system.md`; a "tacet" is the mark for an instrument that stays silent). Tidewell and everything in `data/scenarios.json` are untouched.

## How to run

- Serve the folder over http (`python3 -m http.server`, or `./shot.sh`). Opening `index.html` from `file://` does not work, because the app fetches the JSON files.
- Data files, all read at load, nothing hardcoded:
  - Tacet: `data/results.json` + `data/grades.json`
  - naive agent: `data/baseline-results.json` + `data/baseline-grades.json`
- Useful URLs: `?thread=t12`, `?model=claude-haiku-5-5&run=2`, `?agents=naive` (or `tacet`, `both`), `?tab=score`, `?tab=memory&area=Finance`, `?view=scoreboard`, `?data=sample`, `?capture=1`, `?capture=1&t=7` (one frozen frame).

## What the real data says (as the app computes it)

- 20 threads, 5 need an agent and 15 don't; per model that is 15 speak calls and 45 quiet calls.
- Messages nobody needed: naive 33 (Fable 3, Opus 9, Sonnet 5, Haiku 16), Tacet 0. The naive ones cost 74k tokens, 3.2 minutes and $0.32.
- When a human did need it: naive spoke 60 of 60 times, Tacet 55 of 60. All 5 misses are Haiku.

## What works

**Comparison (round 2)**
- Threads show both agents: the naive agent's message as a loud card, then Tacet's message or its "read · stayed quiet" marker. Long naive messages are clamped with "Show all of it".
- Panel: model picker, run selector, and a Both / Naive / Tacet switch. Activity lists all 20 threads with one column of dots per agent; a selected thread shows every model, every run, both agents, with messages and grader notes.
- Scoreboard tab and full board (`?view=scoreboard`): totals and per model, messages nobody needed, the tokens, seconds and dollars spent on them, and Tacet's misses.
- Every channel in the data appears (including #general). Unread badges count unread threads, not messages, and cap at 9+.
- Without baseline files the app falls back to Tacet only; without grades it shows raw counts and an UNGRADED badge. The Tacet-only fallback is exercised by `?data=sample`; the ungraded state was checked in round 1 and not re-checked after this rewrite.

**Capture (`?capture=1`, 1440x900, 24 s)**
- 0 to 2.4 s: title card.
- 2.4 to 13.6 s: fast pass through the 15 threads that need nothing. Threads where the featured model's naive agent posted get about 1.6 s, the rest about 0.5 s. The counter and the pile on the right count needless naive messages from all 4 models and all runs, ending on 33; Tacet's counter stays at 0.
- 13.6 to 18.4 s: one thread where Tacet speaks and is right, with the memory fact it used. The thread is the first one of the day where the featured model's Tacet spoke correctly (the Halvorsen logo thread for Opus).
- 18.4 to 24 s: comparison board, 33 vs 0, per model, with Haiku's 5 misses.
- `&model=` sets the featured model, default Opus 5.5. `&run=` restricts everything to one run.
- `window.SIM = {duration, ready, render(t)}`; every frame is rebuilt from `t` alone, with no CSS transitions, randomness or clock. Body text in the tour is 21 to 25 px, so about 16 px and up when the frame is scaled to 1080 wide. The smallest text is the labels on the pile chips (14.5 px), which are meant as texture.

**Agent**
- `agent/run.mjs`: flags `--model`, `--runs`, `--only`, `--out`, `--fresh`; 4 calls at a time, atomic save after every call, two retries. Not changed in round 2.

## What doesn't, and things to know

- **Sample mode shows Tacet only, on 10 threads.** There are no sample baseline files, so `?data=sample` has no comparison, t11 to t20 show "not run yet", and the browser logs two 404s for the missing sample baseline files.
- **The capture tour is a separate big-type layout**, not the normal workspace UI zoomed in. It keeps the sidebar, channels and thread look, but drops the panel, composer and top bar.
- **The naive agent also caught every real problem** (60 of 60). The tour says so in one line during the Tacet beat and on the end card; the difference shown is noise, not recall.
- **The default model is now Opus 5.5** in normal mode too, not the first model in the list.
- **"Messages nobody needed"** = the agent posted and the verdict is `correct: false`. In this data every such verdict is "spoke when nobody needed it". Tokens are input + output for those calls.
- **Capture preview uses the wall clock** (`requestAnimationFrame`) so you can watch it in a browser. It stops for good on the first external `SIM.render(t)` call; `&autoplay=0` or `&t=` turns it off from the start.
- Quick threads in the tour are on screen for about half a second; they are meant to be felt, not read.
- With "All runs" selected, a thread shows the first run in which that agent spoke, plus "spoke in x of 3 runs".
- Decorative only: emoji reactions on human messages (from a hash, not the data), presence dots, the other two workspaces, search, and the sidebar items Threads and Mentions.
- Not tested: Safari and Firefox, real phones, the recorder itself (I checked frozen frames with `&t=`, not a frame-by-frame recording).
