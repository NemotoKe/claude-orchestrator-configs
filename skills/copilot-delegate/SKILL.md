---
name: copilot-delegate
description: >-
  Delegate bounded implementation work to the GitHub Copilot CLI worker via
  the `copilot` MCP tool instead of editing source files directly. Use ONLY
  when the user explicitly asks for this — "Copilotに投げて", "Copilotにやら
  せて", "delegate this to Copilot", "use Copilot to implement this" — not
  automatically for ordinary coding requests. Prefer `codex-delegate` when
  Codex is available; reach for this one specifically when Codex is not
  usable in the current environment (no ChatGPT subscription, no
  usage-based OpenAI billing) but Copilot CLI is. Carries the same contract
  as `codex-delegate`: default-FAIL acceptance criteria in
  `.agents/criteria.md`, handoff state in `.agents/progress.md`, complexity
  tiers that select the verification pipeline, and a read-only reviewer.
  Requires the `copilot` MCP server (the bridge in
  opus5-copilot-orchestrator/bridge/) to be registered and connected
  (`claude mcp list`); if it is missing, tell the user instead of falling
  back to editing directly.
---

# Copilot delegation

You are acting as orchestrator for this one delegated task. The Copilot CLI
worker is the implementation worker — it modifies source, adds tests, and
runs them; you inspect the diff and verify. This mirrors `codex-delegate`;
read that skill's structure if you need the fuller rationale on the
default-FAIL contract, the per-unit loop, and the responsibility boundary.
The differences below come from how the `copilot` MCP bridge actually works,
not from a different philosophy.

You are also the only writer of the two state files. The worker does not
touch them, and neither does the reviewer.

## Before delegating

1. Read `.agents/progress.md` and `.agents/criteria.md` if they exist. If
   they do, resume from the recorded "Next action" instead of re-planning
   from scratch, and treat the criteria table as the authoritative checklist.
   If they do not exist, create them from `templates/progress.md` and
   `templates/criteria.md`.
2. Confirm the `copilot` MCP tool is available and connected. If not, stop
   and tell the user — do not silently implement the change yourself.
3. Confirm the working directory is inside a git repository. The bridge
   refuses to run otherwise, by design — the worker edits files in place,
   and git is what makes that reviewable and revertible.
4. Inspect the repository enough to write a task the worker can execute
   without asking you anything. It starts with no context from this
   conversation — restate file paths, prior decisions, and constraints
   explicitly.
5. Define acceptance criteria before calling the tool, and write them to
   `.agents/criteria.md` at `FAIL` before the first delegation.

## State files

Two files under `.agents/` carry state across worker calls and across
sessions. Formats: `templates/criteria.md`, `templates/progress.md`.

- `.agents/criteria.md` — every acceptance criterion starts at `FAIL` and
  moves to `PASS` only on an integration-reviewer PASS verdict with cited
  evidence. Absence of evidence is FAIL. The worker's own completion report
  is not evidence. You are the only writer.
- `.agents/progress.md` — the handoff record. Update it after each accepted
  unit: units complete, current unit, criteria PASS count, last commit sha,
  next action, decisions and rejected approaches, blockers. A new session's
  first act is to read both files and continue from "Next action".

Each accepted unit gets its own git commit, and its sha is recorded in
`.agents/progress.md`. The state update is then committed separately.

## Complexity tiers

`break-down-task-creator` classifies every unit. The tier selects the
verification pipeline below.

| Tier | Applies to | Pipeline |
|---|---|---|
| 1 — direct | No behavioral change: docs, comments, formatting, config values with no runtime effect, renames that do not change call-site semantics | implement only; you verify by reading the diff. No test-builder, no reviewer. |
| 2 — standard | Bounded behavioral change inside one component, already covered by existing test infrastructure | implement → integration-reviewer. Insert integration-test-builder only if the reviewer returns FAIL (unverifiable). |
| 3 — full | Crosses component boundaries, or touches persistence, an external API, concurrency, a migration, auth, or anything security-relevant | implement → integration-test-builder → integration-reviewer. |

Default to Tier 2 when unsure. Escalate on observed evidence at any time;
never de-escalate mid-unit. Any unit whose criteria touch persistence, an
external boundary, concurrency, or security is Tier 3 regardless of diff
size.

## Build the delegated task

Before writing or sending an implementation task, use the
`break-down-task-creator` skill to turn the rough request into a concise,
self-contained implementation prompt. Treat its output as the task body and
preserve its objective, requirements, constraints, acceptance criteria, TDD
scenarios, and non-goals.

Its output declares the unit's complexity tier and its acceptance criteria.
Transcribe those criteria into `.agents/criteria.md` — one row per criterion,
all at `FAIL` — before the first `copilot` call for that unit. Send one unit
per invocation.

Add only Copilot-specific invocation details around that prompt, such as the
selected model or reasoning effort. Do not make the task depend on Copilot, a
particular model, or a reasoning mode unless that is an explicit requirement.

## Calling the tool

Use the `copilot` MCP tool's `prompt` argument for a self-contained
engineering task, in the same shape as Codex delegation:

- Objective
- Relevant background (confirmed facts, not assumptions)
- Acceptance criteria
- Allowed scope (files/modules)
- Existing conventions to preserve
- Required tests
- Explicit non-goals
- Expected final report shape

### Choosing a model — requires Copilot Pro (or higher)

Pass `model` as `luna`, `terra`, or `sol` (aliases resolved by the bridge —
see `bridge/config.json` in `opus5-copilot-orchestrator`):

| Model | Use for |
|---|---|
| `luna` | Mechanical edits, renames, test scaffolding, diff review, verification |
| `terra` | **Default** — bounded implementation against clear acceptance criteria |
| `sol` | Non-obvious algorithms, concurrency, tricky migrations |

Escalate on evidence, not anticipation: `terra` first, `sol` only after a
concrete failure.

> **Plan-gated, not a naming issue.** On a Copilot free/individual account
> every explicit `--model` value was rejected — not because the name was
> wrong, but because `gh api /copilot_internal/user` showed
> `premium_interactions.entitlement: 0`: the free tier has zero quota for
> premium models, full stop. This table is written for a **Copilot Pro (or
> higher)** account where that entitlement is nonzero, and is **unverified**
> end-to-end even there. Before trusting it: `gh api /copilot_internal/user
> --jq .quota_snapshots.premium_interactions` and confirm `entitlement > 0`,
> then run one real `copilot` call with an explicit `model` and check
> `exit: 0` in the result before relying on it for actual work. If the
> account is still on the free tier, skip `model` entirely (falls back to
> `auto`) — don't retry different spellings; the plan is the blocker, not
> the string.

### Reasoning effort — needs an explicit model, not `auto`

Pass `effort` as `none` / `minimal` / `low` / `medium` / `high` / `xhigh` /
`max`. Default to `medium`. **This bridge has no `ultra`-equivalent and no
auto-delegation mode** — Copilot CLI doesn't expose one, so there is nothing
to avoid here the way there is with Codex's `ultra`.

**Confirmed 2026-08-04: `effort` only works together with an explicit
`model`.** Passing it while `model` resolves to `auto` fails outright —
`Error: Model "auto" does not support reasoning effort configuration`. So
`effort` is gated by the same Pro-plan requirement as `model` above: on a
free-tier account, don't set `effort` — there's no model to attach it to.

## After delegating

1. Run `git diff` and review it — behavioral correctness, scope creep, test
   quality, security implications. Do not accept a change merely because the
   worker reports tests passing.
2. Run the tests yourself if you can.
3. Run the unit's tier pipeline (below).
4. If the result is wrong or incomplete, do not silently patch it. Explain
   the defect precisely and send a corrective task via `copilot_reply` with
   the `sessionId` from the original call, rather than fixing it yourself.
   If the bridge's `resume` flag is disabled in the target config, `sessionId`
   won't actually resume worker context — restate the needed background in
   the follow-up prompt rather than assuming it carried over.
5. Accept the unit and record state (below).
6. Summarize for the user: what changed, what you verified, what's still
   open.

## Running the tier pipeline

Tier 1 — no delegated verification. Read the diff yourself, confirm it
changes no behavior, and accept or send a correction. If it turns out to
change behavior, escalate to Tier 2 and run the reviewer.

Tier 2 and Tier 3 — each verification stage is its own `copilot` call with a
fresh session, never a `copilot_reply` on the implementation session. A
reviewer that inherits the implementer's session inherits its conclusions.
Send `luna` for verification work; it is the cheapest tier and does not need
to plan.

- Tier 3, and Tier 2 after a `FAIL (unverifiable)`: one call carrying the
  `integration-test-builder` skill, given only the current unit's
  requirements, acceptance criteria, changed files, and test results.
- Both tiers: one call carrying the `integration-reviewer` skill, asked to
  return the skill's per-criterion verdict table against
  `.agents/criteria.md`, by criterion number.

The reviewer prompt must state explicitly:

- it has no write access to the repository — no production edits, no new or
  amended tests, no fixtures, no fixing a defect it finds;
- a criterion with no meaningful coverage is returned as
  `FAIL (unverifiable)`, naming the missing evidence and the test that would
  produce it — it does not close that gap itself;
- it does not write `.agents/criteria.md`; it returns verdicts and you
  transcribe them.

A `FAIL (unverifiable)` is a FAIL. Re-delegate to `integration-test-builder`,
then re-run the reviewer. Do not promote the criterion because the
implementation looks correct.

## Accepting a unit

Accept only when every criterion for the unit is PASS with cited evidence
(Tier 1: when your diff review confirms no behavioral change). Then, in
order:

1. Commit the unit on its own.
2. Transcribe the reviewer's verdict rows into `.agents/criteria.md` —
   status and evidence, one row per criterion, no rewording or renumbering.
3. Update `.agents/progress.md`: units complete, commit sha, tier, changed
   files, how it was verified, criteria PASS count, the next action, and any
   decision or rejected approach the next session must not retry.
4. Commit the state update.

Then start the next unit.

## Scope of this skill

This delegation applies to the current task only. Do not treat this as a
standing instruction to route all future edits in this conversation through
Copilot — ask again, or wait for the user to say so again, next time.
