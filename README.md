# claude-orchestrator-configs

Claude Code configs for using Claude as an orchestrator that delegates bounded
implementation work to another coding agent — Codex CLI or GitHub Copilot CLI —
instead of implementing everything itself.

## Layout

```text
hooks/
  validate-delegation.sh       PreToolUse hook — deny a Codex or Copilot delegation whose prompt is structurally incomplete

skills/
  break-down-task-creator/     Turn a rough task into a self-contained prompt with a tier and default-FAIL criteria
  codex-delegate/              Global skill — delegate one task to Codex CLI
  copilot-delegate/            Global skill — delegate one task to Copilot CLI
  delegation-prompt-reviewer/  Read-only Opus subagent — audit a prompt before it is sent, attribute a failure after
  integration-reviewer/        Read-only, evidence-based PASS/FAIL verdict on a finished unit
  integration-test-builder/    Add independently executable integration tests for a unit

templates/
  criteria.md                  Seed for the project's .agents/criteria.md
  progress.md                  Seed for the project's .agents/progress.md
  prompt-defects.md            Seed for the project's .agents/prompt-defects.md — recorded prompt defects and promotions
  repo-facts.md                Seed for the project's .agents/repo-facts.md — durable repository facts with the sha they were observed at

opus5-codex-orchestrator/
  CLAUDE.md                    Always-on policy: delegate implementation to Codex CLI
  settings.json                Hook registration (Bash/`codex exec`), installed as the project's .claude/settings.json

opus5-copilot-orchestrator/
  CLAUDE.md                    Always-on policy: delegate implementation to Copilot CLI
  README.md                    Setup and usage
  settings.json                Hook registration (Bash/`copilot -p`), installed as the project's .claude/settings.json

setup-project.sh               Install a CLAUDE.md, the skills, the templates, and the delegation-prompt hook into a project
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

On the Codex path the reviewer runs as a **fresh Claude subagent pinned to Opus
rather than on Codex**. Deciding whether a test could pass despite a wrong
implementation, or
whether a mock hides the behavior that matters, is the hardest judgment in the
loop, and Luna is the low-cost, weakest worker in the pipeline — the wrong
place for the final gate. Because the reviewer writes nothing, moving it to the
Claude side does not breach the rule that Claude never writes application
source.

It is a subagent, not the orchestrator session. The orchestrator defined the
task and watched the implementation land, so it is the party most likely to
confirm its own framing; the reviewer gets the criteria, the changed files, and
the test results, and nothing else.

The model is pinned rather than inherited, so the strength of the gate does not
depend on how the orchestrator session was started, and it is deliberately not
tiered — the reviewer is the backstop for a unit classified too low, so it must
not weaken alongside the tier it is checking. Tiering already bounds how often
it runs, since a Tier 1 unit never invokes it.

### Prompt feedback loop

The delegated prompt decides what gets built, how it is verified, and what
counts as done, and it was the one artifact in the loop nothing checked.
Implementation gets a reviewer and tests get a reviewer; the instruction that
produces both was sent unexamined. A prompt defect is also the expensive kind:
it is discovered only after a full implementation round has been spent on it.

Two checks, split by what each can actually decide, and both cover both
workers.

`hooks/validate-delegation.sh` is a `PreToolUse` hook matching `Bash` on both
paths — Codex and Copilot are both invoked as plain CLI subprocesses, so one
script tells them apart by command text (`codex exec` vs `copilot -p`) rather
than by tool name. Either way it verifies structure only: the required sections
(Objective, Complexity Tier, Acceptance Criteria, Allowed scope, Non-goals,
plus Required tests or TDD Scenarios for Tier 2 and 3, or Defect/Evidence/
Required correction on a corrective pass) and a narrow list of phrases that
point at conversation the worker never saw. Codex delegations get one more
check — the standing `-m gpt-5.6-luna` and `model_reasoning_effort=xhigh`
flags — that does not carry over to Copilot, which has no single fixed model
to check for; its model choice is a legitimate per-task judgment (see Copilot
CLI below), not something a script should gate. Everything the hook does check
is decidable by grep. Nothing on it is a judgment call, deliberately — a shell
script cannot weigh whether a criterion is verifiable, and a gate that fires on
ambiguous input is a gate that gets disabled.

`skills/delegation-prompt-reviewer` takes the judgment half: a fresh Claude
subagent pinned to Opus, read-only, run pre-flight on Tier 2 and Tier 3 units
on either worker. It does not re-check structure — that is settled by the time
it sees the prompt. It asks whether each criterion names observable evidence,
whether every load-bearing fact is on the page rather than assumed, whether the
scope is enumerable, whether the tier fits, and whether the prompt repeats a
recorded defect. It returns `SEND` or `REVISE` with the replacement text, and
never rewrites the prompt itself.

The distinction that matters: the hook is the only check in this repository
that runs whether or not the model complied. Everything else here — the tiers,
the default-FAIL rule, the reviewer stages — is a policy the model is asked to
follow.

`templates/prompt-defects.md` is what makes this a loop rather than a gate, and
the record is shared: a pattern recorded from a Codex unit applies to a Copilot
unit and vice versa, since both are read at every session start regardless of
worker. On any failure the same subagent runs in attribution mode and answers
one question: would a competent worker following this prompt exactly have
produced this failure? Yes means prompt defect, recorded as a reusable pattern;
no means implementation defect, fixed by a corrective pass and recorded
nowhere. Unclear defaults to prompt defect, because a misfiled implementation
defect costs one wasted row while a misfiled prompt defect costs the same
failure on every future task.

The record carries a `Seen` count, and a pattern seen twice is promoted: it
stops being a per-task correction and gets written into the project's
`CLAUDE.md` conventions. Anything that has to be explained to a worker twice is
a convention that was never written down. Unlike `criteria.md` and
`progress.md`, this file outlives the task.

Operationally: the hook denies the tool call outright and returns the reason to
the orchestrator, listing what is missing; the fix is to rewrite the prompt,
not to route around the hook. If `jq` is not installed it fails open — it
prints a warning that prompts are not being validated and allows the call,
since a broken hook that blocks every delegation is worse than an absent one.
The registered command uses a path relative to the project root
(`sh .agents/hooks/validate-delegation.sh`); if the hook does not appear to
fire, replace it with an absolute path and confirm the registration with
`/hooks`. Both `opus5-codex-orchestrator/settings.json` and
`opus5-copilot-orchestrator/settings.json` register the identical `Bash`
matcher; if the Copilot CLI is invoked under a different binary name than
`copilot` in your environment, update the `*"copilot -p"*` match inside
`hooks/validate-delegation.sh` itself, since that is where the two workers
are told apart.

### State files

`.agents/criteria.md`, `.agents/progress.md`, `.agents/prompt-defects.md`, and
`.agents/repo-facts.md` live in the target project, seeded from `templates/`,
and are committed as part of the work. They are external memory, not scratch
files. The orchestrator is their only writer.

`criteria.md` and `progress.md` are scoped to one task. `progress.md` records
completed units, each unit's commit sha, decisions and rejected approaches, and
the single concrete next action. A new session's first act is to read the state
files and resume from that next action rather than re-planning. This closes
context loss: sessions accumulate instead of resetting when the orchestrator's
context window ends.

`prompt-defects.md` and `repo-facts.md` outlive the task. The first is
described under the prompt feedback loop above; the second below.

### Repository facts

`.agents/repo-facts.md` holds durable, non-obvious facts about the repository
itself: an unwritten convention, what registers what, a module boundary, an env
var the test suite needs, why an obvious approach does not work. Subagents
discover these constantly and their context then ends, so the next subagent
re-derives them from scratch. Anything one ripgrep would answer stays out — the
file is read at the start of every session, so a cheap fact costs more than it
saves. Task-specific decisions belong in `progress.md`.

Subagents stay read-only here too. A reviewer or test-builder returns facts in
its report and the orchestrator transcribes them, the same pattern as
`criteria.md`.

Staleness is the risk, and a facts file that lies is worse than none. Each row
records the paths it describes and the commit sha it was observed at. When
`git diff --name-only <sha>..HEAD -- <paths>` is non-empty the fact is
unverified: re-confirm it before relying on it and update the sha, or correct
it. Do not delete a stale fact — a corrected fact is worth more than a missing
one. Staleness is derived rather than stored, so the marker cannot itself go
stale.

This is a facts record rather than a graph index deliberately. Multi-hop
relationship traversal is not the bottleneck in most repositories — ripgrep and
the file tree are faster and never go stale. An index buys traversal speed and
pays for it in maintenance and staleness; what is actually scarce is the
expensively discovered fact that no amount of searching produces.

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
including corrective passes and the `integration-test-builder` stage. There is
no silent switch to Terra, Sol, a lower reasoning effort, or Ultra — Ultra can
introduce Codex-managed subagents and duplicate the orchestrator role. If Luna
or xhigh is unavailable, the delegation stops and reports the blocker. Moving
to Terra or Sol is an escalation rather than a downgrade, and it is the user's
call.

Luna is the low-cost, weakest of the three tiers. Running it for all Codex work
is a deliberate cost choice; the acceptance criteria, strict TDD, and xhigh
effort carry the weight instead of raw model capability, and the final gate
sits on the Claude side.

| Stage | Runs on |
|---|---|
| implementation | Codex `gpt-5.6-luna` at xhigh |
| corrective pass | the same Codex session |
| `integration-test-builder` | a separate Codex session |
| `integration-reviewer` | a fresh Claude subagent pinned to Opus — not Codex |

This is the Codex worker's policy only. The Copilot worker keeps its own
`luna`/`terra`/`sol` tier table with `terra` as the default.

### Copilot CLI

Copilot CLI is used for environments where GitHub Copilot is the preferred
worker, or where Codex is unavailable. It carries the same contract as Codex —
tiers, default-FAIL criteria, the read-only reviewer, the prompt gates, spec-
driven test building, and both cross-task records — described in detail in
`skills/copilot-delegate/SKILL.md` and `opus5-copilot-orchestrator/CLAUDE.md`.

Copilot is invoked the same way Codex is: directly from the shell, as a Bash
subprocess (`copilot -p ...`), with Claude reading its stdout/stderr. There is
no MCP server or bridge process — see `opus5-copilot-orchestrator/README.md`
for setup details.

Copilot has no single fixed model the way Codex is pinned to Luna. `--model`
selects a tier per call, and escalation is evidence-based, not automatic:

| Model | Use for |
|---|---|
| `luna` | Mechanical edits, renames, test scaffolding — and `integration-test-builder`, spec-driven or self-directed |
| `terra` | **Default** — bounded implementation against clear acceptance criteria |
| `sol` | Non-obvious algorithms, concurrency, tricky migrations, anything `terra` failed at twice |

`integration-reviewer` does not run through any of these tiers. As on the
Codex path, it is a fresh Claude subagent pinned to Opus — never the Copilot
worker, at any tier — for the same reason: it is the one stage that writes
nothing, so it can sit on the Claude side without breaching the rule that
Claude does not write application source, and the final gate should not run on
a worker tier chosen for cost.

Model selection is plan-gated on a Copilot account: see the caveats in
`opus5-copilot-orchestrator/CLAUDE.md` and `opus5-copilot-orchestrator/README.md`
before trusting the table on a free-tier account.

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
`.agents/criteria.md`, `.agents/progress.md`, `.agents/prompt-defects.md`, or
`.agents/repo-facts.md` — the orchestrator writes those from the installed
templates.

On both the `codex` and `copilot` paths the script also installs the
delegation hook to `.agents/hooks/validate-delegation.sh`, marks it
executable, and registers it by writing `.claude/settings.json` with an
identical `Bash` matcher. An existing `.claude/settings.json` is never
overwritten: the fragment is written to
`.claude/settings.json.orchestrator-fragment` instead, and the script prints a
message to merge its `hooks.PreToolUse` entry by hand.

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
