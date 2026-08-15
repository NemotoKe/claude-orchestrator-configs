# claude-orchestrator-configs

Claude Code configs for using Claude as an orchestrator that delegates bounded
implementation work to another coding agent — Codex CLI or GitHub Copilot CLI —
instead of implementing everything itself.

## Layout

```text
skills/
  break-down-task-creator/     Turn a rough task into a self-contained prompt with a tier and default-FAIL criteria
  codex-delegate/              Global skill — delegate one task to Codex CLI
  copilot-delegate/            Global skill — delegate one task to Copilot CLI
  integration-reviewer/        Read-only, evidence-based PASS/FAIL verdict on a finished unit
  integration-test-builder/    Add independently executable integration tests for a unit

templates/
  criteria.md                  Seed for the project's .agents/criteria.md
  progress.md                  Seed for the project's .agents/progress.md

opus5-codex-orchestrator/
  CLAUDE.md                    Always-on policy: delegate implementation to Codex CLI

opus5-copilot-orchestrator/
  CLAUDE.md                    Always-on policy: delegate implementation to Copilot CLI
  README.md                    Setup and usage
  bridge/                      MCP stdio bridge wrapping the Copilot CLI

setup-project.sh               Install a CLAUDE.md, the skills, and the templates into a project
```

## Two delegation modes

### Global skills

`skills/*-delegate` are global Claude Code skills, typically symlinked from:

```text
~/.claude/skills/
```

They remain dormant until delegation is explicitly requested, for example:

```text
Codexに投げて
Copilotに投げて
```

Use these when Claude normally handles implementation itself and you only want
to delegate individual tasks.

### Project orchestrators

`opus5-*-orchestrator/CLAUDE.md` defines a project-scoped, always-on delegation
policy.

When Claude Code is started inside one of these projects, Claude acts as the
orchestrator for the whole session:

```text
Claude Opus
    ↓
task definition / scope / acceptance criteria
    ↓
Codex CLI or Copilot CLI
    ↓
implementation + tests
    ↓
Claude review / verification
```

Use this mode when the project is delegation-first by design.

## Verification harness

The orchestrator owns repository inspection, decomposition, acceptance
criteria, delegation, diff review, commits, and the state files. The worker
owns source edits, tests, and corrective passes. The split exists so the agent
that wrote the code is never the agent that decides whether it works.

### Complexity tiers

`break-down-task-creator` classifies every unit, and the tier selects the
pipeline — over-verifying trivial changes is its own failure mode.

| Tier | Applies to | Pipeline |
|---|---|---|
| 1 — direct | No behavioral change: docs, comments, formatting, config values with no runtime effect, renames that do not change call-site semantics | Implement only; the orchestrator verifies by reading the diff. |
| 2 — standard | Bounded behavioral change inside one component, already covered by existing test infrastructure | Implement, then review. Insert the test-builder only if the reviewer returns FAIL (unverifiable). |
| 3 — full | Crosses component boundaries, or touches persistence, an external API, concurrency, a migration, auth, or anything security-relevant | Implement, then integration-test-builder, then integration-reviewer. |

Default to Tier 2 when unsure. Escalate on observed evidence at any time; never
de-escalate mid-unit. Any unit whose criteria touch persistence, an external
boundary, concurrency, or security is Tier 3 regardless of diff size.

### Default-FAIL criteria

Every criterion in `.agents/criteria.md` starts at FAIL and moves to PASS only
on a reviewer PASS verdict with cited evidence. Absence of evidence is FAIL.
This closes self-grading: a worker's completion report and "the tests are
green" are not evidence.

### Read-only reviewer

`integration-reviewer` runs in a fresh session and may execute tests and checks
but never modifies, creates, or deletes a file — a reviewer that can fix what
it finds stops being an independent check. A criterion with no meaningful
coverage is FAIL (unverifiable), and the orchestrator re-delegates to
`integration-test-builder` rather than letting the reviewer supply the missing
tests itself.

### State files

`.agents/criteria.md` and `.agents/progress.md` live in the target project,
seeded from `templates/`, and are committed as part of the work. They are
external memory, not scratch files. The orchestrator is their only writer.

`progress.md` records completed units, each unit's commit sha, decisions and
rejected approaches, and the single concrete next action. A new session's first
act is to read both files and resume from that next action rather than
re-planning. This closes context loss: sessions accumulate instead of resetting
when the orchestrator's context window ends.

## Workers

### Codex CLI

Codex is invoked directly from Claude through the shell using non-interactive
commands such as:

```bash
codex exec --sandbox workspace-write --json ...
```

Claude owns task definition, model selection, scope control, diff review, and
independent verification.

Codex owns implementation, source edits, tests, and corrective passes.

No Codex MCP server is required.

Every Codex delegation uses `gpt-5.6-luna` with `model_reasoning_effort=xhigh`,
including corrective passes and verification work performed by Codex. There is
no silent switch to Terra, Sol, a lower reasoning effort, or Ultra — Ultra can
introduce Codex-managed subagents and duplicate the orchestrator role. If Luna
or xhigh is unavailable, the delegation stops and reports the blocker instead
of downgrading.

This is the Codex worker's policy only. The Copilot worker keeps its own
`luna`/`terra`/`sol` tier table with `terra` as the default.

### Copilot CLI

Copilot CLI is used for environments where GitHub Copilot is the preferred
worker.

Unlike the Codex setup in this repository, Copilot is exposed to Claude through
the custom MCP bridge under:

```text
opus5-copilot-orchestrator/bridge/
```

See that project's README for setup details.

## Usage

To copy one orchestrator configuration into another project, run the setup
script from that project's root. The script accepts `codex` or `copilot` and
copies the matching `CLAUDE.md`, the common skills, and only the selected
agent's delegation skill into `.agents/skills`, plus the state-file templates
into `.agents/templates`:

```bash
/path/to/claude-orchestrator-configs/setup-project.sh codex
# or
/path/to/claude-orchestrator-configs/setup-project.sh copilot
```

The destination is the current directory. Existing files with the same names
are overwritten. `.agents/skills` is the project-local skills location shared
by Codex and Copilot CLI.

The script installs only the templates. It never creates or overwrites a live
`.agents/criteria.md` or `.agents/progress.md` — the orchestrator writes those
per task from the installed templates.

For occasional delegation, install or symlink the desired skill into Claude
Code's global skills directory and explicitly request delegation.

For delegation-first development, start Claude Code inside one of the
`opus5-*-orchestrator` projects.

The two mechanisms are intentionally separate:

```text
global skill
  -> explicit, one-task delegation

project CLAUDE.md
  -> always-on orchestration
```

A delegation rule only applies where it is configured. Installing the global
skill does not make every project delegation-first.
