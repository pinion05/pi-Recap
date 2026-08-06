# Live on/off benchmark — attempt log & scripts

Goal: measure pi-Recap's effect on **live task success rate + tokens** (vanilla vs recap-on), targeting Terminal-Bench v2.1. **Status: blocked by pi/environment issues** — see the tracking issue linked from the top-level README.

## What's already settled (static simulation — strong conclusion)

These don't need a live run; they use the session log's `originalText`/`recapText` on every `recap-entry`:

- **Main context-window saving: 90.7%** (tiktoken, same tool-result sequence replayed vanilla vs recap). Saved 68,513 tokens in one ~1h session.
- **Semantic fidelity (task-grounded recall): 80.6%** overall — but **inverse with size**: small 90.6% → large 59.1%. LOST pattern = exact identifiers (paths/names/values). Measured by `recap_judge.py`.

See top-level README "Measured impact" + "Semantic fidelity" for tables.

## Scripts in this dir

| Script | Route | recap triggers? | Notes |
|---|---|---|---|
| `bench.sh` | local tmux + `pi` interactive | ✅ yes | big2 task (16 bugs), `node --test` scoring. recap on/off via `-e`. **Both on/off succeed** — task too short for recap to help; on actually uses more tokens (familiar overhead). |
| `bench_wc.sh` | local tmux + terminal-bench **write-compressor** | ✅ yes (loads) | decomp.c roundtrip scoring. **Hits the agentic-loop stall** (see issue): pi calls read/bash, gets toolResults, then never sends the next model call → 1 turn, no `data.comp`. |
| `runner.py` | `pi -p` (CLI non-interactive) | ❌ no | recap needs the `context` event, which `pi -p` never emits (only SDK path). |
| `sdk_harness.mts` | pi SDK `createAgentSession` | ❌ no | recap doesn't load — default `createAgentSession` loads **zero** extensions (`LOADED_EXTENSIONS: []`); `DefaultResourceLoader` + `additionalExtensionPaths` also came up empty. |
| `recap_judge.py` | offline | n/a | task-grounded recall LLM-as-judge → 80.6%. |
| `recap_ab.py` | offline | n/a | familiar-prompt A/B (baseline vs 3 variants). Aborted when the live route was chosen; data in `/tmp/recap_ab_*` if the run completed. |

## Reproduce the static simulation (vanilla vs recap context)

Reads a session log, replays each tool result both ways, tokens via tiktoken:

```python
import json, tiktoken
enc = tiktoken.encoding_for_model("gpt-4")
def tok(s): return len(enc.encode(s or ""))
# collect, per toolCallId: original (toolResult message text), recap (recap-entry.recapText),
# and whether it was swapped (a recap-message custom_message exists for it)
# at session end: vanilla = sum(tok(original)); recap = sum(tok(recap if swapped else original))
```

Swap detection: a `custom_message` with `customType: "recap-message"` marks the toolCallId as swapped in context.
