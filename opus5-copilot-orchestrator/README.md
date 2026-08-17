# opus5-copilot-orchestrator

Claude Opus 5 as orchestrator, GitHub Copilot CLI as the implementation worker.

For environments where the Codex CLI is unavailable (no ChatGPT subscription, no
usage-based OpenAI billing) but Copilot CLI is. Copilot is invoked the same way
Codex is: directly from the shell, with Claude reading its stdout/stderr.

```
Claude Code (Opus 5, orchestrator)
      │  Bash
      ▼
copilot -p "…" --model … --effort … --allow-all-tools
```

There is no MCP bridge and no server process to register — `copilot` is a
plain CLI subprocess, same as `codex exec` on the Codex path.

## Status

Verified end-to-end against the real `copilot` CLI (v1.0.77): `-p` for a
non-interactive run, `--allow-all-tools` for unattended file edits, `git
diff`-reviewable output, and `--resume <sessionId>` for session continuity —
all confirmed against a live process. This replaces an earlier MCP-bridge
version of this setup; the bridge added a stdio server and a config-file
translation layer that direct invocation doesn't need.

**`--model luna/terra/sol` slugs are unverified and plan-gated, not just a
naming guess.** On a Copilot free/individual account, every explicit `--model`
value was rejected — including the account's own auto-selected models by
display name. The actual cause, found via `gh api /copilot_internal/user`:
that account's `quota_snapshots.premium_interactions.entitlement` was `0`. The
free tier has zero quota for premium models, independent of what string you
pass. The model table in `CLAUDE.md` assumes a **Copilot Pro (or higher)**
account where that entitlement is nonzero — confirm with the same `gh api`
call before trusting the table, then exercise one real call and check `exit:
0`. On a still-free account, don't pass `--model` at all.

**`--effort` requires an explicit `--model`.** Passing `--effort` while the
model resolves to the CLI's auto default fails outright (`Error: Model "auto"
does not support reasoning effort configuration`) — confirmed against the
real CLI. So `--effort` is gated by the same Pro-plan requirement as
`--model`, not independently.

## Setup

```bash
npm install -g @github/copilot
copilot login   # or however this environment's Copilot CLI authenticates
copilot --help  # confirm the flags below still match your installed version
```

Then run `setup-project.sh copilot` from the project root (see the top-level
README) to install `CLAUDE.md`, the skills, the state-file templates, and the
delegation-prompt hook (`settings.json` in this directory). The hook's
`PreToolUse` matcher is `Bash`, the same as the Codex path — it tells the two
workers apart by reading the command text, not by tool name.

## Adapting the config

Everything CLI-specific is written directly into `CLAUDE.md` and
`skills/copilot-delegate/SKILL.md` rather than a separate config file. Run
`copilot --help` and reconcile:

| What | Check |
|---|---|
| Binary name | Is it `copilot`, or is it invoked as `gh copilot`? If the latter, every `copilot -p ...` invocation in `CLAUDE.md` and the delegate skill needs `gh copilot -p ...` instead — and the hook's `*"copilot -p"*` match in `hooks/validate-delegation.sh` needs the same update. |
| `-p` | The non-interactive/print flag. May be spelled `--prompt` in your version. |
| `--model` | The model-selection flag, and whether `gpt-5.6-luna`/`terra`/`sol` are real slugs in your account's model list. Update the table in `CLAUDE.md` and the delegate skill to whatever your account actually offers. |
| `--resume` | The session-continuation flag. If your Copilot CLI version has none, corrective passes cannot resume worker context — restate the needed background in the follow-up prompt instead. |
| `--effort` / `--reasoning-effort` | The reasoning-depth flag; confirm it's still spelled this way and still requires an explicit `--model`. |

### Capturing the session id

There is no bridge scraping this for you — Claude reads it directly out of
the command's own output. Copilot CLI prints a resume hint to **stderr**
(verified 2026-08-03 against copilot 1.0.77): a line containing
`--resume=<id>` (or, with `--output-format json`, a `"sessionId":"<id>"` field
in the stdout result line). After each `copilot -p` call, read that id from
the Bash tool's output and carry it into the next `--resume <id>` call for a
corrective pass. If it isn't visible in the output, re-run with
`--output-format json` if your version supports it.

## Tools

**`copilot -p "<prompt>" [--model <slug>] [--effort <level>] [--allow-all-tools]`**
— start a task. Prints the worker's output and a resume hint to stdout/stderr.

**`copilot -p "<prompt>" --resume <sessionId> [--model <slug>] [--effort <level>]`**
— continue a session. Unlike the old bridge, the model and effort are **not**
inherited automatically — restate them on the resume call if you want the
same tier.

Model and effort selection guidance lives in
[CLAUDE.md](CLAUDE.md) — the orchestrator reads it automatically.

## Safety properties

**Runs are confined to git repositories by convention, not by a guard.**
Unlike the old bridge, there is no `requireGitRepo` check enforced in code —
`CLAUDE.md` and the delegate skill both require the working directory to be a
git repository before invoking `copilot`, because the worker edits files in
place and git is what makes those edits reviewable and revertible. Prefer
`git init` over skipping the check.

**Runs are not automatically serialized.** The old bridge queued concurrent
tool calls against one working tree; a direct Bash invocation has no such
queue. `CLAUDE.md` defaults to a single worker on one working tree and only
parallelizes across separate `git worktree` checkouts — follow that, since two
`copilot` processes editing the same tree concurrently will corrupt each
other's changes.

**`--allow-all-tools` is the default invocation.** The worker needs to write
files and run tests, so every delegation in the skill passes
`--allow-all-tools` and the worker will not prompt before acting. It can run
arbitrary commands within the working directory. The git-repo convention
bounds the blast radius on tracked files but does not sandbox the process —
drop the flag if that is not acceptable in your environment (interactive
confirmation will then block unattended runs).

**No credentials pass through anything extra.** `copilot` uses whatever
GitHub auth is already configured on the machine; there is no intermediary
process holding or forwarding credentials.
