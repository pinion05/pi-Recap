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
