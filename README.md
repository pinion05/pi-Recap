# pi-Recap

> **A context-sharing familiar summarizes each tool result into 1–3 lines. Old results are secretly swapped with recaps — originals stay recoverable.**

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
│  → recapText                                  │
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
│   quietly replaced with 〈recap〉 …           │
│   [recap_recover: rN]                         │
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

The numbers below come from a single real coding session (the pi-Recap debugging session itself: 64 tool results recapped over ~1 hour). Each `recap-entry` in the session log carries **both** `originalText` and `recapText`, so compression is measured exactly — no estimation. Meaning-preservation is a qualitative read of representative cases.

### Compression scales with result size

| Original size | Count | Avg compression |
|---|---|---|
| < 200 chars | 18 | **−491%** (recap *longer* than original) |
| 200–1K | 23 | 49% |
| 1K–5K | 19 | 85% |
| 5K–20K | 2 | 96% |
| > 20K | 2 | 99% |
| **All** | **64** | **90.6%** (178K → 17K chars ≈ 44.5K → 4.2K tokens) |

The recap is a flat ~1–3 lines regardless of input, so the larger the original, the more dramatic the savings. Below ~200 chars the recap is *longer* than the original — the familiar adds task context to a terse result. This is a known cost; future versions will skip recapping very small results.

### Representative cases

| Ref | Tool | Original | Recap | Saved | Meaning preserved |
|---|---|---|---|---|---|
| r3 | `bash` (`ls -la ~`) | 18,255 chars (full dir listing) | 266 chars ("no pi-recap dir; related paths: …") | 99% | ⚠️ Partial — paths captured, full file list lost (recoverable) |
| r33 | `bash` (`grep .d.ts`) | 51,323 chars (type defs) | 226 chars ("truncateHead returns TruncationResult{content,…}") | 100% | ✅ Core fact exact |
| r32 | `bash` (`grep -rn`) | 4,771 chars | 189 chars | 96% | ✅ Core fact exact |
| r26 | `bash` (errored) | 979 chars (module-load error) | 283 chars ("require() failed …") | 71% | ✅ Cause captured |
| r50 | `bash` | 203 chars (test pass + commit) | 267 chars | −32% | ✅ Accurate, just longer |
| r6 | `bash` | 11 chars (`(no output)`) | 302 chars ("no pi-recap anywhere searched…") | −2645% | ⚠️ Over-reach — recap infers facts the empty original can't contain |

**Read:** for any result above ~1K chars the familiar compresses 85–99% with the core fact intact. The failure mode is *over-coverage* on near-empty results (r6) — the familiar fills in context the original didn't carry, which is useful as a hint but isn't a faithful summary of *that* result.

### Caveats

- **Single coding session; YMMV.** Compression favors tool-heavy coding (lots of `ls` / `cat` / `grep` / log dumps). Sessions dominated by tiny results see little benefit and may net negative.
- **Cross-project contamination is real.** A recap can draw in facts from elsewhere in the same session. If you switch projects mid-session — or hot-swap the package you're actively developing — an original from project A can pick up a recap flavored by project B's context. Like tire marks from two different wheels left on the same track. Treat recaps of cross-contaminated results as **hints, not ground truth**; `recap_recover` is the source of truth.

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
