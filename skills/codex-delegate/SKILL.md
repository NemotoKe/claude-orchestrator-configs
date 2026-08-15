---
name: codex-cli-delegation
description: Delegate independently evaluable, bounded implementation tasks to Codex CLI using gpt-5.6-luna with xhigh reasoning, while the outer agent owns repository inspection, task decomposition, acceptance criteria, complexity tiering, diff review, independent verification, per-unit commits, and the .agents/criteria.md and .agents/progress.md state files that carry work across sessions. Use when the user explicitly asks to delegate implementation to Codex CLI.
---

# Codex CLI delegation

You are the orchestrator. Codex CLI is the implementation worker.

You define the task, inspect the result, and verify it independently. Do not
silently implement or repair Codex's changes yourself.

## Session start

Do this before anything else, including repository inspection.

1. Check for existing state:

   ```bash
   ls .agents/progress.md .agents/criteria.md
   ```

2. If either file exists, read both before acting. Resume from the "Next
   action" recorded in `.agents/progress.md`. Treat `.agents/criteria.md` as
   the authoritative status of every criterion. Do not re-plan, do not
   re-derive units, and do not redo units already recorded as complete.
3. Read "Decisions and constraints discovered" and "Blocked / unresolved" in
   `.agents/progress.md` before choosing an approach, so a rejected approach is
   not retried.
4. Only when neither file exists, build a fresh plan and continue with "Before
   delegation".

These two files are the memory across sessions. The orchestrator is their only
writer.

## Before delegation

1. Confirm Codex is available:

   ```bash
   command -v codex
   codex --version
   codex login status
   ```

   If unavailable, stop and tell the user.

2. Inspect the repository enough to make the delegated task self-contained.
   Codex has no context from this conversation.

3. Split the request into the smallest coherent units that can be evaluated
   independently. Each unit should have one primary observable outcome, its
   own acceptance criteria, and its own relevant tests or checks.

4. Define explicit acceptance criteria before delegation.

## Build the delegated task

Before writing or sending each implementation task, use the
`break-down-task-creator` skill to turn that task unit into a concise,
self-contained implementation prompt. Treat its output as the task body and
preserve its objective, requirements, constraints, acceptance criteria, TDD
scenarios, and non-goals.

Do not combine unrelated outcomes into one delegation. If units depend on one
another, state the dependency and delegate them in order; still give each unit
an independently verifiable completion condition. Send only one unit in each
Codex invocation. Add only Codex-specific invocation details around the prompt.

`break-down-task-creator` also assigns each unit a complexity tier (1 direct,
2 standard, 3 full). Carry that tier with the unit; it selects the pipeline in
the per-unit execution loop. If a unit arrives without a tier, treat it as
Tier 2.

## Create the criteria file

After `break-down-task-creator` has produced the units and their acceptance
criteria, and before delegating the first unit:

1. Copy `templates/criteria.md` to `.agents/criteria.md`, creating `.agents/`
   if needed.
2. Fill in the task name and date, and add one row per acceptance criterion
   with the unit it belongs to.
3. Leave every criterion at `FAIL` with an empty evidence cell.

Do not delegate any unit until this file exists. A criterion that is not in the
file is not tracked and cannot be accepted.

## Delegate

Run Codex from the repository root with `codex exec`.

```bash
cat <<'EOF' | codex exec \
  --sandbox workspace-write \
  --json \
  -m gpt-5.6-luna \
  -c model_reasoning_effort=xhigh \
  -
<SELF-CONTAINED TASK>
EOF
```

Include:

* Objective
* Relevant background and paths
* Acceptance criteria
* Allowed scope
* Required tests
* Non-goals

Keep the task bounded. Do not delegate vague requests such as "implement this
feature."

Capture the session/thread ID from the JSON output for corrective passes.

## Per-unit execution loop

Process implementation units in dependency order. Do not start the next unit
until the current unit has been accepted and recorded (see "Accepting a unit").

The unit's tier selects the pipeline:

| Tier | Pipeline |
|---|---|
| 1 — direct | implement only; accepted on the orchestrator's own diff review. No test-builder, no reviewer. |
| 2 — standard | implement -> reviewer. Pull in `integration-test-builder` only when the reviewer returns `FAIL (unverifiable)`. |
| 3 — full | implement -> `integration-test-builder` -> `integration-reviewer`. |

Tier rules:

* Default to Tier 2 when the tier is missing or unclear.
* Escalate at any point on observed evidence — a diff that crosses component
  boundaries, or a change that turns out to touch persistence, an external API,
  concurrency, a migration, auth, or anything security-relevant. Any such unit
  is Tier 3 regardless of diff size.
* Never de-escalate a unit's tier mid-unit. Finish it at the higher tier.

Every tier starts the same way: delegate the implementation prompt generated
from `break-down-task-creator` to `gpt-5.6-luna` with xhigh reasoning (when
using the repository-local copy, read `skills/break-down-task-creator/SKILL.md`
first), capture the session id, then review the diff yourself as described in
"Review and verify". The tiers differ in what follows.

### Tier 1 — direct

1. Confirm from the diff that the change is non-behavioral and matches the
   unit's criteria. Anything behavioral means the unit was misclassified:
   escalate to Tier 2 or 3 and continue there.
2. Accept the unit on your own diff review, or send a corrective pass.

Do not invoke the test-builder or the reviewer for a Tier 1 unit.

### Tier 2 — standard

1. Start a separate Luna xhigh invocation with a fresh session using the
   `integration-reviewer` skill (read `skills/integration-reviewer/SKILL.md`
   when using the repository-local copy). See "Reviewer invocation".
2. When every criterion comes back `PASS`, accept the unit.
3. When any criterion comes back `FAIL (unverifiable)`, start a separate Luna
   xhigh invocation using the `integration-test-builder` skill (read
   `skills/integration-test-builder/SKILL.md` when using the repository-local
   copy), scoped to the uncovered criteria, then re-run the reviewer in another
   fresh session. The unit stays Tier 2.
4. When any criterion comes back plain `FAIL`, send a corrective pass to the
   implementation session, then re-run the reviewer in a fresh session.

### Tier 3 — full

1. Start a separate Luna xhigh invocation using the `integration-test-builder`
   skill (read `skills/integration-test-builder/SKILL.md` when using the
   repository-local copy). Give it only the current unit's requirements,
   acceptance criteria, changed files, and relevant test results. Have it add
   or improve independently executable integration tests and run them.
2. Start another separate Luna xhigh invocation using the
   `integration-reviewer` skill in a fresh session. See "Reviewer invocation".
3. When every criterion comes back `PASS`, accept the unit.
4. When any criterion comes back `FAIL (unverifiable)`, re-run the test-builder
   for the uncovered criteria only, then re-run the reviewer in another fresh
   session.
5. When any criterion comes back plain `FAIL`, send a corrective pass to the
   implementation session, then re-run the reviewer in a fresh session.

### Reviewer invocation

The reviewer is read-only. State this in the delegated prompt:

* It has no write access to the repository. It must not edit source, tests,
  configuration, or the state files.
* It returns a verdict, not a change: one row per acceptance criterion with
  `PASS`, `FAIL`, or `FAIL (unverifiable)`, plus cited evidence.
* A criterion no test covers is `FAIL (unverifiable)`. It must not add or fix a
  test to make that criterion verifiable; the orchestrator re-delegates that to
  `integration-test-builder`.
* Evidence is the command run and its observed result, the test name covering
  the criterion, or the file and line inspected. A restatement of the criterion
  is not evidence.

Give it the unit's acceptance criteria, the changed files, and the test
results. Do not give it the implementer's completion report, conclusions, or
session id. If it edits anything anyway, treat the run as invalid, restore the
files, and re-review in a new fresh session.

### Applies to every tier

* Each Codex invocation carries exactly one unit.
* Implementation, `integration-test-builder`, and `integration-reviewer` are
  always separate invocations with fresh sessions.
* Do not apply this loop recursively to test-builder or reviewer tasks.
* A unit is complete only when its criteria are PASS in `.agents/criteria.md`.

## Model and reasoning effort

Use `gpt-5.6-luna` with `model_reasoning_effort=xhigh` for every delegated task,
including corrective passes and verification work performed by Codex.

Do not silently switch to Terra, Sol, a lower reasoning effort, or Ultra. Ultra
may introduce Codex-managed subagents, which duplicates the outer orchestrator
role. If Luna or xhigh is unavailable, stop and report the blocker instead of
downgrading the task.

## Review and verify

After Codex finishes:

```bash
git status --short
git diff --stat
git diff
```

Review:

* correctness
* acceptance criteria
* scope creep
* test quality
* security implications
* unrelated edits

Run relevant tests yourself when possible. Do not accept the change solely
because Codex reports success.

## Accepting a unit

Accept a unit only when the reviewer returned PASS for each of its criteria
with cited evidence, or, for Tier 1, when your own diff review confirms them.
Then do all four steps below, in order, before starting the next unit.

1. Commit the unit on its own.

   ```bash
   git add <unit files>
   git commit -m "<unit id>: <what changed>"
   ```

   One unit per commit. Do not batch units, and do not mix the state files into
   this commit.

2. Transcribe the reviewer's per-criterion verdicts into `.agents/criteria.md`.
   Move `FAIL` -> `PASS` only for criteria the reviewer passed with cited
   evidence, and copy that evidence into the evidence column. Every other
   criterion stays FAIL. For a Tier 1 unit, record your own diff review as the
   evidence. Deleting a criterion is never a way to satisfy it; move it to
   "Deferred / out of scope" with a reason instead.

3. Update `.agents/progress.md`:

   * the completed unit, its commit sha, and its tier
   * the new criteria PASS count (`n`/`total`)
   * the single concrete next action for the next session
   * decisions made, approaches tried and rejected, and environment facts the
     next session needs

4. Commit the state-file update.

   ```bash
   git add .agents/criteria.md .agents/progress.md
   git commit -m "<unit id>: record verdicts and progress"
   ```

A unit is complete only when its criteria are PASS in `.agents/criteria.md`.
Only then start the next unit.

## Corrective pass

If the implementation is wrong or incomplete, send a precise correction to the
same session instead of fixing it yourself:

```bash
cat <<'EOF' | codex exec resume \
  <SESSION_ID> \
  --json \
  -m gpt-5.6-luna \
  -c model_reasoning_effort=xhigh \
  -
Defect:
<WHAT IS WRONG>

Evidence:
<DIFF / TEST FAILURE / BEHAVIOR>

Required correction:
<BOUNDED FIX>

Preserve already-satisfied acceptance criteria.
Do not expand scope.
Run the relevant tests again.
EOF
```

Then review the diff and verify again.

A criterion that failed stays `FAIL` in `.agents/criteria.md` until a reviewer
PASS with cited evidence moves it. A completed corrective pass is not itself
grounds to mark it PASS.

If the unit cannot be finished — the corrective pass does not resolve it, the
blocker is external, or the session is ending — record the finding before
stopping:

* `.agents/criteria.md`: leave the failed criteria at FAIL, with the observed
  failure in the evidence column.
* `.agents/progress.md`: the failure, the concrete blocker, what was tried and
  rejected, and the next action.
* Commit the state-file update.

The finding must survive the session even when the work does not.

## Responsibility boundary

The orchestrator owns task definition, scope, acceptance criteria, model
selection, review, and verification.

Codex owns source edits, tests, implementation-level execution, and corrective
changes.

## Final report

Tell the user:

* what changed
* which model/mode was used
* each accepted unit with its tier and commit sha
* what you independently verified
* the criteria PASS count and which criteria are still FAIL
* anything still unresolved, and the next action recorded in
  `.agents/progress.md`

This skill applies only to the current explicitly delegated task.
