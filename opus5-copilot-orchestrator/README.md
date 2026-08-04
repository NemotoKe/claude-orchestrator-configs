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

The MCP layer is verified end-to-end against a stub binary: handshake, `tools/list`,
both tools, model-alias resolution, session inheritance on reply, the git-repo guard,
and run serialization all work.

**The Copilot CLI flag names in `bridge/config.json` are unverified** — they were
written from prior knowledge without access to the binary. Model availability
(`gpt-5.6-luna` / `-terra` / `-sol` under Copilot) is likewise assumed, not confirmed.
Expect to adjust the config once on the target machine; the JS should not need edits.

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

`effort.mode` handles the fact that Copilot may not expose a reasoning-depth flag:

- `"flag"` — a real flag exists; set `effort.flag` to its spelling
- `"prompt"` — **current default**; the depth is prepended to the prompt as text
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
