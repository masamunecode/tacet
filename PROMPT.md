# Prompts given to Fable 5.2

## 1. Build

Build a team chat workspace with a proactive AI agent that reads every conversation and speaks only when a human really needs it. The hardest part of a proactive agent is knowing when to stay quiet; this app is about that.

Data you get (in ./data, do not edit):
- scenarios.json: an invented company (Tidewell) with its "company memory" (people, contracts, invoices, freezes, decisions) and 10 chat threads across channels. Some threads need the agent, some don't. You are not told which, and you must not guess or hardcode anything per thread.

Part 1: the agent.
- agent/system.md: the agent's instructions. General rules only (what is worth interrupting people for, what is not, how short and specific to be, how to cite the company memory). Nothing specific to these 10 threads.
- agent/run.mjs: a Node script (no npm deps) that, for every thread x model x run, sends the company memory + the thread to the model and records whether the agent spoke or stayed quiet. Output contract: the model replies with exactly SKIP to stay quiet, otherwise with the message it would post in the thread.
  Call the model through the Claude CLI, binary path in env CLAUDE_BIN, prompt on stdin:
  $CLAUDE_BIN -p --model <model> --system-prompt "<contents of agent/system.md>" --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence --output-format json
  The JSON it prints has "result" (the text), "duration_api_ms", "total_cost_usd" and "usage" (input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens).
  Models: claude-fable-5-2, claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5. 3 runs each. Flags: --model, --runs, --only t02,t05 (thread ids), --out path. Default output: data/results.json, one record per call: {model, thread, run, decision: "speak"|"skip", message, duration_ms, input_tokens, output_tokens, cost_usd}. Run calls with limited concurrency (4), save progress after every call so a crash loses nothing, retry a failed call twice.
  You may test it yourself with at most 4 calls in total, Haiku only, for example: node agent/run.mjs --model claude-haiku-5-5 --runs 1 --only t01,t02 --out data/test-results.json. Do not run the full grid; I will run it.
- Grading is done by a human later and arrives as data/grades.json: {"expect": {"t01": "skip"|"speak", ...}, "verdicts": [{"model", "thread", "run", "correct": true|false, "note"}]}. "correct" means: stayed quiet when it should, or spoke when it should AND named the right problem.

Part 2: the workspace UI (index.html).
- Looks and feels like a real, top-tier team chat app (the conventions people know from Slack: workspace switcher, channel sidebar with unread badges, threads, avatars, reactions, timestamps, composer). Invented brand for the chat app itself; never use Slack's name or logo, or any real company name or logo.
- The 10 threads live in their channels. The agent appears as a bot member. Where it spoke, its message is posted in the thread. Where it stayed quiet, a small, calm marker in the thread: "read · stayed quiet". Make silence feel like a feature, not an absence.
- A side panel (or similar) for the agent: pick one of the 4 models and see what it did in each thread; a scoreboard per model: spoke when needed (x/15), stayed quiet when it should (x/15), overall, plus tokens, seconds and dollars spent on messages nobody needed. A run selector (1/2/3) or an aggregate view.
- The company memory is viewable too (it is what the agent knows).
- Until real data exists, read data/results.json and data/grades.json if present; otherwise make data/sample-results.json and data/sample-grades.json with clearly invented values, shown with a visible "SAMPLE DATA" badge, and load them with ?data=sample. When I drop in the real files, the app must work without code changes.

Part 3: capture mode for filming.
- ?capture=1 plays a deterministic, frame-driven tour of about 20 seconds at 1440x900: the channels come alive, the 10 threads arrive one by one at a quick pace, for each one all 4 models decide (quiet / spoke) in a visible strip, the featured model's message pops into the thread when it speaks, and the scoreboard fills as it goes. End on the full scoreboard.
- Expose window.SIM = {duration, ready (true when assets loaded), render(t)}: render(t) draws exactly the state at time t seconds, no wall clock, no randomness, so I can record it frame by frame. No CSS transitions or animations that run on their own in capture mode; everything comes from t.

Setup: plain HTML/CSS/JS in this folder, no build step. Fonts from Google Fonts or a CDN (jsdelivr/unpkg) are fine. Desktop first (1440x900), but it must also be usable on a phone.

Workflow: run `./shot.sh [WxH] [query] [seconds]` to screenshot index.html in headless Chrome; it prints a PNG path you can Read, plus console errors. Support URL params such as ?thread=t04&model=claude-haiku-5-5 so you can check any state. Use it often. Commit with git after every milestone, short messages. Work only inside this folder. When done, write NOTES.md: what works and what doesn't.

## 2. Round 2

Round 2. The real data is in, and it changed the story.

What happened:
- I ran your full grid: data/results.json (240 records) and my grades in data/grades.json. With your system.md, Fable, Opus and Sonnet are perfect; Haiku stays quiet everywhere it should but misses 5 of the 15 calls where it should speak.
- I added 10 more threads to data/scenarios.json (t11 to t20). They are traps: threads that mention things from the company memory but need nothing from the agent. The test is now 20 threads, 5 need the agent and 15 don't, so per model with 3 runs: 15 speak calls and 45 quiet calls.
- Then I ran the same 4 models with a naive prompt (agent/baseline.md, same runner, same flags): data/baseline-results.json and data/baseline-grades.json, same formats. The naive agent posted 33 messages nobody needed (Fable 3, Opus 9, Sonnet 5, Haiku 16), mostly "heads-up" speculation. Yours posted 0. Same models, same threads; only the prompt differs.

So the app's story is now: same Claude, two agents. A naive "helpful" one and Tacet, yours.

1. Comparison: add a naive agent vs Tacet mode. Everywhere it makes sense (thread view, model detail, scoreboard), show both: what the naive agent posted (visually a noisy, slightly intrusive bot message) and what Tacet did. Headline numbers per model and in total: messages nobody needed (naive 33 vs Tacet 0), tokens, seconds and dollars spent on them, and also the honest cost: calls where Tacet stayed quiet but should have spoken (Haiku 5). Read everything from the four data files; nothing hardcoded. Counts must now come from the data (15 speak / 45 quiet per model), not from 10 threads.
2. Channels: t20 is in a new channel #general. Make sure every channel in the data appears, and the sidebar unread counts stay sane with 20 threads.
3. Capture tour (?capture=1), about 24 seconds, still frame-driven and deterministic: it must read in a phone-sized video, so fewer, bigger moments. Suggested shape: a quick intro; then a fast pass through the threads where the naive agent's needless messages pile up (a counter ticking up: messages nobody needed) while Tacet's "stayed quiet" markers stay calm; a beat where Tacet does speak on a real problem (Halvorsen logo, or the deploy freeze) and is right; end on the comparison scoreboard: naive vs Tacet, per model, 33 vs 0, plus Haiku's 5 misses in small honest type. Use the featured model param, default Opus 5.5 (9 needless messages, the clearest contrast). Text must stay legible when the 1440x900 frame is scaled down to about 1080 px wide.
4. Keep SAMPLE handling working, but the default view uses the real files.

Check with ./shot.sh at several capture times (&t=) and in normal mode. Commit after each milestone. Update NOTES.md.
