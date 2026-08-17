# opus5-copilot-orchestrator

Claude Opus 5 as orchestrator, GitHub Copilot CLI as the implementation worker.

For environments where the Codex CLI is unavailable (no ChatGPT subscription, no
usage-based OpenAI billing) but Copilot CLI is. Copilot CLI is an MCP *client*, not
an MCP server — it has no `mcp-server` mode to attach to — so `bridge/copilot-mcp.mjs`
wraps it in one.

```
Claude Code (Opus 5, orchestrator)
      │  MCP (stdio)
      ▼
bridge/copilot-mcp.mjs      ← this repo
      │  subprocess
      ▼
copilot -p "…" --model …
```

## Status

Verified end-to-end against the real `copilot` CLI (v1.0.77), not just a stub: the
MCP handshake, both tools, `--allow-all-tools` file edits, `git diff`-reviewable
output, and `copilot_reply` session continuity (including model inheritance across
the reply, after a bug fix — see below) all work with `model: "auto"`.

**`model: "luna"/"terra"/"sol"` is unverified and plan-gated, not just a naming
guess.** On a Copilot free/individual account, every explicit `--model` value was
rejected — including the account's own auto-selected models by display name. The
actual cause, found via `gh api /copilot_internal/user`: that account's
`quota_snapshots.premium_interactions.entitlement` was `0`. The free tier has zero
quota for premium models, independent of what string you pass. `bridge/config.json`
is written for a **Copilot Pro (or higher)** account where that entitlement is
nonzero — confirm with the same `gh api` call before trusting the model table, then
exercise one real call and check `exit: 0`. On a still-free account, don't set
`model` at all; it falls back to `auto`.

**`effort` requires an explicit `model`.** Passing `effort` while `model` resolves
to `auto` fails outright (`Error: Model "auto" does not support reasoning effort
configuration`) — confirmed against the real CLI. So `effort` is gated by the same
Pro-plan requirement as `model`, not independently.

**Fixed 2026-08-04: session continuity bug.** `copilot_reply` was falling back to
`config.json`'s `defaultModel` instead of inheriting the model from the original
call, because session-id extraction was reading only `stdout` — the CLI actually
prints the resume hint (`Resume     copilot --resume=<id>`) to **stderr**, and the
original regex didn't match that text form anyway (it assumed a `sessionId: <id>`
shape). Both are fixed in `copilot-mcp.mjs` / `config.json` and re-verified live.

## Setup

```bash
npm install -g @github/copilot
```

Register the bridge with Claude Code, from the repository you want to work in:

```bash
claude mcp add --transport stdio copilot -- node /ABSOLUTE/PATH/TO/bridge/copilot-mcp.mjs
```

```bash
claude mcp list
```

Then run `setup-project.sh copilot` from the project root (see the top-level
README) to install `CLAUDE.md`, the skills, the state-file templates, and the
delegation-prompt hook (`settings.json` in this directory). The hook's
`PreToolUse` matcher assumes the bridge is registered as MCP server `copilot`,
per the command above — if you register it under a different name, update the
matcher in `settings.json` to match.

## Adapting the config

Everything environment-specific lives in `bridge/config.json`. Run `copilot --help`
and reconcile these four things:

| Config key | Check |
|---|---|
| `command` | Is the binary `copilot`, or is it `gh copilot`? For the latter, set `"command": "gh"` and put `"copilot"` at the front of `args.extra`. |
| `args.prompt` | The non-interactive/print flag. `-p` here; may be `--prompt`. |
| `args.model` + `models` | The model-selection flag, and whether Luna/Terra/Sol appear in the model list at all. Map the aliases to whatever slugs are actually offered. |
| `args.resume` | The session-continuation flag. If Copilot has none, set it to `[]` — `copilot_reply` then starts a fresh run, so the orchestrator must restate context in the follow-up prompt. |

`sessionIdPattern` is the regex used to scrape a session id out of the worker's
output. Run one task by hand, look at how the id is printed, and adjust.

### Reasoning effort

`effort.mode` handles the fact that a different Copilot CLI version might not
expose a reasoning-depth flag the same way:

- `"flag"` — **current default**; verified real: `--effort, --reasoning-effort
  <level>` (choices: `none`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`).
  Only works with an explicit `model` — see Status above.
- `"prompt"` — fallback; the depth is prepended to the prompt as text instead
- `"off"` — ignore effort entirely

## Tools

**`copilot`** — start a task. `prompt` (required), `model` (`luna`/`terra`/`sol` or a
raw slug), `effort`, `cwd`, `allowAllTools`. Returns the worker's output plus a
`sessionId`.

**`copilot_reply`** — continue a session. `sessionId`, `prompt`, `cwd`. Inherits the
model from the originating call.

Model and effort selection guidance lives in [CLAUDE.md](CLAUDE.md) — the orchestrator
reads it automatically.

## Safety properties

**Runs are confined to git repositories.** The worker edits files in place; git is what
makes those edits reviewable and revertible. `requireGitRepo: false` disables this —
prefer `git init` over disabling it.

**Runs are serialized.** Concurrent tool calls queue rather than spawning parallel
Copilot processes against one working tree. To genuinely parallelize, give each worker
its own `git worktree` and a separate bridge instance.

**`defaultAllowAllTools` is `true`.** The worker needs to write files and run tests, so
it is passed `--allow-all-tools` by default and will not prompt before acting. It can
run arbitrary commands within `cwd`. The git-repo guard bounds the blast radius on
tracked files but does not sandbox the process — set this to `false` if that is not
acceptable in your environment.

**No credentials pass through the bridge.** It shells out to `copilot`, which uses
whatever GitHub auth is already configured on the machine.
