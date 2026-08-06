<p align="center">
  <img src="assets/recap.jpeg" width="720" alt="pi-Recap">
</p>

<h3 align="center">A context-sharing familiar summarizes every tool result into 1–3 lines — old results are swapped with recaps, recoverable on demand.</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@npmc_5/pi-recap"><img src="https://img.shields.io/npm/v/@npmc_5/pi-recap?color=cb3837&label=npm"></a>
  <a href="https://www.npmjs.com/package/@npmc_5/pi-recap"><img src="https://img.shields.io/npm/dt/@npmc_5/pi-recap?color=cb3837&label=downloads"></a>
  <img src="https://img.shields.io/npm/l/@npmc_5/pi-recap?color=blue">
  <img src="https://img.shields.io/node/v/@npmc_5/pi-recap?color=339933">
  <img src="https://img.shields.io/badge/pi-extension-7c3aed">
</p>

<p align="center">
  <a href="#install"><b>Install</b></a> ·
  <a href="https://www.npmjs.com/package/@npmc_5/pi-recap">npm</a> ·
  <a href="#measured-impact">Benchmark</a> ·
  <a href="#commands">Docs</a> ·
  <a href="#config">Config</a>
</p>

A [Pi](https://github.com/badlogic/pi-mono) extension. As the main agent works, every tool result (`read`, `bash`, `rg`, web fetch, …) gets a tiny recap written by a **familiar** — an LLM call that shares the main agent's full context and model. A few turns later, the verbose original is quietly replaced in context by the recap. If detail is ever needed again, `recap_recover` brings the original back.

---

## How it works

```
tool result arrives
   │
   ▼
┌──────────────────────────────────────────────┐
│ FAMILIAR (same model, same context prefix)   │
│  “summarize tool result <id> in 1–3 lines”   │
│  → recapText                                 │
└──────────────────────────────────────────────┘
   │  (shared prefix → prefix-cache hit; also warms
   │   the cache for the main agent's next call)
   ▼
recap stored in session index (original kept)

…after `swapTurnThreshold` turns…
   │
   ▼
┌──────────────────────────────────────────────┐
│ context event: aged tool result              │
│   quietly replaced with <recap>              │
│   [recap_recover: rN]                        │
└──────────────────────────────────────────────┘
```

### Why the familiar shares the main context + model

- **Same context** → the recap knows what the ongoing task actually cares about (not a generic "summarize this").
- **Same model + same prefix** → the familiar's input hits the provider's **prefix cache**, so the shared context is billed at cache-read rate, and the call simultaneously warms the cache for the main agent's next request.
- **Per-result, eager** → each tool result is recapped once, the moment it appears, so a recap is always ready by the time the swap threshold is reached.

### "Secret" swap

The main agent isn't told a swap happened — the tool-result message is simply shorter now. Each swapped result carries a tiny marker the agent can act on if it needs the detail back:

```
〈recap〉 src/index.ts exists (1340 LOC, TypeScript). Exports default
extension entry wiring session_start/turn_end/context events.
[recap_recover: r12]
```

---

## Measured impact

The numbers below come from a single real coding session (the pi-Recap debugging session itself). Each `recap-entry` in the session log carries **both** `originalText` and `recapText`, so compression is measured exactly — no estimation. Counts reflect 0.1.3 behavior — results under 200 chars are skipped, so only the 63 recappable results are counted. Meaning-preservation is a qualitative read of representative cases.

### Vanilla vs pi-Recap (static simulation)

A controlled comparison using this session's exact tool-result sequence: **vanilla** keeps every result as the original; **pi-Recap** swaps each to its recap once it ages past the swap threshold. Tokens measured with tiktoken (`cl100k_base`).

| Metric | Vanilla | pi-Recap | Saved |
|---|---|---|---|
| Main-context tool-result tokens (cumulative, end of session) | 75,554 | 7,041 | **90.7%** (−68,513) |
| At 50% through the session | 60,041 | 3,763 | 93.7% |
| At 25% through the session | 29,228 | 3,508 | 88.0% |

Savings compound as the session grows — by the halfway point the vanilla curve is already ~16× the pi-Recap curve.

> ⚠️ **Scope.** 90.7% is **main context-window** savings — what keeps a long session from hitting the context limit. It is *not* total billed tokens: the familiar adds its own calls (100 recaps here, 7,616 output tokens). Familiar **input** tokens aren't logged (only main-call `outputTokens` are tracked), so net cost requires a live A/B. This simulation answers "how much context does pi-Recap free up?" — answered: **90.7%**.

### Compression scales with result size

| Original size | Count | Avg compression |
|---|---|---|
| < 200 chars | — | *skipped since 0.1.3* (recap would be longer than original) |
| 200–1K | 34 | 49% |
| 1K–5K | 24 | 86% |
| 5K–20K | 3 | 96% |
| > 20K | 2 | 99% |
| **All (≥200)** | **63** | **92.1%** (204K → 16K chars ≈ 50.9K → 4.0K tokens) |

The recap is a flat ~1–3 lines regardless of input, so the larger the original, the more dramatic the savings. Results under 200 chars are skipped entirely — the summary would be longer than the original, so recapping would cost tokens instead of saving them.

### Representative cases

| Ref | Tool | Original | Recap | Saved | Meaning preserved |
|---|---|---|---|---|---|
| r3 | `bash` (`ls -la ~`) | 18,255 chars (full dir listing) | 266 chars ("no pi-recap dir; related paths: …") | 99% | ⚠️ Partial — paths captured, full file list lost (recoverable) |
| r33 | `bash` (`grep .d.ts`) | 51,323 chars (type defs) | 226 chars ("truncateHead returns TruncationResult{content,…}") | 100% | ✅ Core fact exact |
| r32 | `bash` (`grep -rn`) | 4,771 chars | 189 chars | 96% | ✅ Core fact exact |
| r26 | `bash` (errored) | 979 chars (module-load error) | 283 chars ("require() failed …") | 71% | ✅ Cause captured |

**Read:** for any result above ~1K chars the familiar compresses 85–99% with the core fact intact. Results under 200 chars are skipped entirely, so the recap is never longer than the original.

### Caveats

- **Single coding session; YMMV.** Compression favors tool-heavy coding (lots of `ls` / `cat` / `grep` / log dumps). Sessions dominated by tiny results see little benefit and may net negative.

---

## Install

```bash
pi install npm:@npmc_5/pi-recap     # stable, once published
pi install git:github.com/pinion05/pi-Recap   # cutting edge
pi -e .                                      # try from source
```

Then:

```
/Recap on
```

## Commands

| Command | Effect |
|---|---|
| `/Recap` | Interactive subcommand picker |
| `/Recap on` / `off` | Enable / disable |
| `/Recap status` | State, threshold, recap count, current turn |
| `/Recap threshold [n]` | Show or set the swap turn threshold (default 5) |
| `/Recap help` | Help |

## Recovery tool

`recap_recover` is always available. Pass a short ref (`r12`) or `toolCallId`:

```
recap_recover({ refs: ["r12"] })   → full original tool result
```

## Configuration

`~/.pi/agent/recap/settings.json`:

```jsonc
{
  "enabled": false,
  "swapTurnThreshold": 5
}
```

| Key | Default | Notes |
|---|---|---|
| `enabled` | `false` | Master switch |
| `swapTurnThreshold` | `5` | A result is swapped once it is this many turns old |

Notes:
- Enabling mid-session does **not** retroactively recap earlier turns (recaps are generated for results seen from now on).
- A recap is only swapped in if it is **shorter** than the original (otherwise the original is kept).
- Recaps are best-effort: if the familiar call fails, the original stays in context untouched.

## Architecture

```
index.ts              entry — events + command/tool registration
src/
  types.ts            config + record types, constants
  config.ts           load/save ~/.pi/agent/recap/settings.json
  recap.ts            RecapIndex + the familiar call (shared-context summary)
  swap.ts             pure context rewriting (aged → recap)
  recovery.ts         recap_recover tool
  commands.ts         /Recap command
```

### Event flow

```
session_start   loadConfig → hydrate index from session entries → reset turn counter
turn_end        currentTurn = max(currentTurn, event.turnIndex)
context         Phase A: for each new toolResult → fire-and-forget runRecap(...)
                Phase B: applyRecaps(...) → replace aged results with recaps
```

### Persistence

- **Recaps** — `sessionManager.appendCustomEntry("recap-entry", record)`, one per recapped tool result. **Not** in LLM context.
- The original `ToolResultMessage` entries in the session JSONL are never modified; only the *next request's* context sees the recap.

---

## Status

Early/experimental. The familiar call uses your **main model per result**, so on long sessions with many tool calls it adds one frontier-model call each — mitigated heavily by prefix-cache reuse, but real. Tunable caps (min size to bother recapping, cheap-model option) are planned.

## License

MIT
