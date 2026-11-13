# Notes

Murmo is the invented chat app, Tacet is the agent (a "tacet" is the mark for an instrument that stays silent). Tidewell and everything in `data/scenarios.json` are untouched.

## How to run

- Serve the folder over http (`python3 -m http.server`, or `./shot.sh`). Opening `index.html` from `file://` does not work, because the app fetches the JSON files.
- Full grid: `CLAUDE_BIN=... node agent/run.mjs` writes `data/results.json`. Then drop `data/grades.json` next to it. No code changes needed.
- Useful URLs: `?thread=t04&model=claude-haiku-5-5&run=2`, `?tab=score`, `?tab=memory&area=Finance`, `?view=scoreboard`, `?data=sample`, `?capture=1`, `?capture=1&t=10.9` (one frozen frame).

## What works

**Agent**
- `agent/system.md`: general rules only. Nothing about Tidewell or the 10 threads.
- `agent/run.mjs`: flags `--model`, `--runs`, `--only`, `--out`, plus `--fresh`. 4 calls at a time, saves after every call (atomic write), retries a failed call twice.
- Tested with exactly 4 Haiku calls (t01, t02, t07, t08, one run each): quiet on t01 and t07, spoke on t02 with the right clause, quiet on t08.
- The app reads `[memory: Area]` at the end of an agent message and turns it into a chip that opens that area of the company memory.

**Workspace**
- Workspace rail, channel sidebar with unread badges, DMs, inline threads, avatars, reactions, timestamps, attachment card, working composer (posts locally only).
- Each thread ends with either the agent's message or the "read · stayed quiet" marker. Clicking a thread opens its detail in the Tacet panel: all 4 models, every run, the message and the grader's note.
- Tacet panel: model picker, run selector (All / 1 / 2 / 3), three tabs: Activity, Scoreboard, Company memory. Full-screen scoreboard via "Full view".
- Data states, all checked with screenshots:
  - no `results.json`: sample data with a SAMPLE DATA badge (also forced by `?data=sample`);
  - `results.json` without `grades.json`: real results, UNGRADED badge, counts and spend only, no scores;
  - both files: full scores.
- Phone layout (checked at 390x844): sidebar becomes a drawer, the Tacet panel a full-height sheet.

**Capture**
- `?capture=1` at 1440x900, 20 seconds: intro 0 to 1.8 s, ten threads at 1.55 s each in the order they happened that day, end card with the full scoreboard from 17.3 s.
- `window.SIM = {duration, ready, render(t)}`. Every frame is rebuilt from `t` alone: no CSS transitions or animations, no randomness, no clock.
- `&model=` picks the featured model whose message pops into the thread. `&run=` picks one run; default is all runs, so the scoreboard ends on x/15.

## What doesn't, and things to know

- **Haiku stayed quiet on t08 in my one test call.** If that thread is one that needs the agent, that was a miss. I added one general sentence to `system.md` afterwards (knowing a rule is not the same as following it) and could not re-test it, the 4-call budget was spent. The prompt has not been tried on Fable, Opus or Sonnet at all.
- **Sample data is hand-written**, including which threads "expect" a message and every number in it. It says nothing about how the models really behave.
- **Capture preview uses the wall clock.** Opening `?capture=1` in a browser autoplays through `requestAnimationFrame` so you can watch it. It stops for good on the first external `SIM.render(t)` call; `&autoplay=0` or `&t=` turns it off from the start.
- **"Messages nobody needed"** = the agent spoke and the verdict is `correct: false` (spoke where silence was expected, or named the wrong problem). Tokens are input + output for those calls; `run.mjs` stores input as fresh + cache-write + cache-read tokens.
- If a verdict is missing for a call, quiet calls are scored from `expect`; a spoken message on a "speak" thread stays unscored, since only a human can say whether it named the right problem.
- A call that still fails after two retries is saved with `decision: "error"` and treated as missing by the UI. Re-running `run.mjs` retries only those and anything not yet done; it keeps existing records unless you pass `--fresh`. So after editing `system.md`, use `--fresh`.
- With "All runs" selected, a thread shows the first run in which the model spoke, plus "spoke in x of 3 runs". Pick a run to see exactly that run.
- Decorative only: the few emoji reactions on human messages (derived from a hash, not from the data), presence dots, the other two workspaces, search, and the sidebar items Threads and Mentions.
- With no `results.json`, the browser logs one 404 for it before falling back to sample data. `?data=sample` avoids the request.
- Not tested: Safari and Firefox, real phones, widths between 860 and 1180 px beyond the layout rules.
