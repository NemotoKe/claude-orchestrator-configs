---
name: codex-cli-delegation
description: Delegate independently evaluable, bounded implementation tasks to Codex CLI using gpt-5.6-luna with xhigh reasoning, while the outer agent owns repository inspection, task decomposition, acceptance criteria, complexity tiering, diff review, per-unit commits, and the .agents/criteria.md and .agents/progress.md state files that carry work across sessions. Final verification runs as a fresh read-only Claude subagent rather than on Codex. Use when the user explicitly asks to delegate implementation to Codex CLI.
---

# Codex CLI delegation

You are the orchestrator. Codex CLI is the implementation worker.

You define the task, inspect the result, and verify it independently. Do not
silently implement or repair Codex's changes yourself.

## Session start

Do this before anything else, including repository inspection.

1. Check for existing state:

   ```bash
   ls .agents/progress.md .agents/criteria.md .agents/prompt-defects.md \
      .agents/repo-facts.md
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

5. Read `.agents/prompt-defects.md` if it exists. It records prompt failure
   patterns from earlier work — including earlier tasks — and every prompt you
   write this session must avoid them.

6. Read `.agents/repo-facts.md` if it exists, and treat any fact whose `Paths`
   changed since its `Observed at` sha as unverified — confirm it before
   relying on it. Put the facts a unit depends on into the delegated prompt;
   the worker cannot read this file's authority, only what you restate.

These files are the memory across sessions. `.agents/criteria.md` and
`.agents/progress.md` track this task; `.agents/prompt-defects.md` and
`.agents/repo-facts.md` outlive it. The orchestrator is the only writer of all
four.

## Recording repository facts

Subagents discover durable facts about the repository in the course of their
work — how a seam is actually wired, what the test suite requires to run, why
the obvious approach does not work. That knowledge dies with their context, and
the next subagent pays to rediscover it.

Subagents do not write it down; that would cost them the read-only property
their independence rests on. They report, and you transcribe — the same
arrangement as `.agents/criteria.md`.

When a reviewer, test-builder, or prompt reviewer reports a fact that is
durable, non-obvious, and not task-specific, add it to `.agents/repo-facts.md`
with the paths it describes and the current commit sha, and commit it with the
other state files.

Be strict about what qualifies. This file is read at the start of every future
session, so a fact that is obvious, redundant, or recoverable by one ripgrep is
a permanent tax on context that buys nothing. Prefer few high-value entries.
Task-specific findings belong in `.agents/progress.md` instead.

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

## Check the prompt before sending it

The prompt decides everything downstream. A bad one is not caught cheaply — it
is caught by a failed implementation round, which is the most expensive place
to find it. Two gates run before the prompt leaves.

### The hook — structure

`.agents/hooks/validate-delegation.sh` runs as a `PreToolUse` hook on every
Bash call and denies the tool call outright when a Codex prompt is missing
required sections, references conversation context the worker does not have, or
drops the model and effort flags.

It is not advisory. Every other rule in this repository is a policy you are
asked to follow; this one runs whether or not you followed it. If it denies a
call, rewrite the prompt — do not restructure the command to slip past the
check, and do not implement the change yourself instead.

It only checks what a script can decide without judgment. Passing it means the
prompt is well-formed, not that it is good.

### The reviewer — semantics

For Tier 2 and Tier 3 units, run `delegation-prompt-reviewer` in a fresh Claude
subagent pinned to Opus before sending. It judges what the hook cannot: whether
each criterion names evidence that could actually be produced, whether a
load-bearing fact is assumed rather than stated, whether the scope is really
bounded, whether the declared tier fits. It returns `SEND` or `REVISE` with
concrete replacement text.

Tier 1 skips it — a unit that changes no behavior has too little prompt surface
to audit.

Give it the prompt and `.agents/prompt-defects.md`. Do not give it your
reasoning for the decomposition; you are asking whether the prompt stands on
its own, and your rationale is exactly what the worker will not have.

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

1. Run the reviewer in a fresh Claude subagent using the
   `integration-reviewer` skill (read `skills/integration-reviewer/SKILL.md`
   when using the repository-local copy). See "Reviewer invocation".
2. When every criterion comes back `PASS`, accept the unit.
3. When any criterion comes back `FAIL (unverifiable)`, start a separate Luna
   xhigh invocation using the `integration-test-builder` skill (read
   `skills/integration-test-builder/SKILL.md` when using the repository-local
   copy) in spec-driven mode, carrying the reviewer's test specification for
   each uncovered criterion. Then re-review in a **new** subagent — see
   "Spec-driven test building". The unit stays Tier 2.
4. When any criterion comes back plain `FAIL`, send a corrective pass to the
   implementation session, then re-run the reviewer in a fresh session.

### Tier 3 — full

1. Start a separate Luna xhigh invocation using the `integration-test-builder`
   skill (read `skills/integration-test-builder/SKILL.md` when using the
   repository-local copy) in self-directed mode — no reviewer has run yet, so
   there is no specification to carry. Give it only the current unit's
   requirements, acceptance criteria, changed files, and relevant test results.
   Have it add or improve independently executable integration tests and run
   them.
2. Run the reviewer in a fresh Claude subagent using the
   `integration-reviewer` skill. See "Reviewer invocation".
3. When every criterion comes back `PASS`, accept the unit.
4. When any criterion comes back `FAIL (unverifiable)`, re-run the test-builder
   in spec-driven mode for the uncovered criteria only, carrying the reviewer's
   test specification. Then re-review in a **new** subagent — see "Spec-driven
   test building".
5. When any criterion comes back plain `FAIL`, send a corrective pass to the
   implementation session, then re-run the reviewer in a fresh session.

### Spec-driven test building

When the reviewer returns `FAIL (unverifiable)`, it has already worked out what
evidence is missing and what test would produce it. Carry that specification to
the test-builder instead of letting it re-derive the answer.

The reviewer runs on Opus and designs the test; the test-builder runs on Luna
and implements it. Deciding *what* to test is the judgment most prone to
producing a test that mirrors the implementation, and it does not belong on the
weakest model in the pipeline. Constructing the test from a precise spec does.

Pass the spec through verbatim — boundary to exercise, setup required,
observable to assert, and the "must fail when" mutation. That last field is
what proves the test discriminates; a test-builder that skips it has produced a
test that may pass regardless of the code. If the test-builder reports the spec
is unimplementable, do not have it build something adjacent — take that back to
a reviewer as a finding about observability.

**The re-review must be a different subagent than the spec author.** A reviewer
cannot honestly ask "could this test pass despite a wrong implementation?"
about a test it designed. Start a new fresh subagent and give it no indication
that the test came from a prior reviewer's spec. This is the same self-grading
hole the read-only rule closed, in a subtler form — the reviewer that wrote the
spec has an answer it is invested in.

Designing a spec does not compromise the reviewer's independence. What must
stay independent is independence *from the implementation*, and the spec is
derived from the criterion and the requirements — which is exactly what
`integration-test-builder` is already required to do.

### Reviewer invocation

The reviewer does not run on Codex. Run it as a **fresh Claude subagent pinned
to Opus**.

Pin the model explicitly rather than letting the subagent inherit it. An
inherited model makes the strength of the final gate depend on how the
orchestrator session happened to be started, and a gate that quietly weakens is
worse than a gate you know is weak.

Do not tier the reviewer's model the way the pipeline is tiered. The reviewer
is what catches a unit that was classified too low; if it weakened along with
the tier, a misclassified unit would get both the thinner pipeline and the
weaker gate at once. Tiering already limits the cost — a Tier 1 unit never
invokes the reviewer at all.

Review is the hardest judgment in the loop — deciding whether a test could pass
despite a wrong implementation, whether a mock hides the behavior that matters,
and whether cited evidence actually supports a criterion. Luna is the low-cost
tier and is the weakest worker in the pipeline, so it is the wrong place to put
the final gate. The reviewer is also the one stage that writes nothing, which is
what makes it eligible to move to the Claude side without breaking the rule that
Claude does not write application source.

Do not review from the orchestrator session. You defined the task, chose the
scope, and watched the implementation land; you are the party most likely to
confirm your own framing. The subagent must start with a context that has never
seen any of that.

The reviewer is read-only. State this in its prompt:

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
results — and nothing else. Do not give it the implementer's completion report,
its conclusions, its session id, your own assessment of the change, or the
reasoning behind the task decomposition. Every one of those imports the
conclusion you are asking it to check independently.

If it edits anything anyway, treat the run as invalid, restore the files, and
re-review in a new subagent.

### Applies to every tier

* Each Codex invocation carries exactly one unit.
* Implementation and `integration-test-builder` are always separate Codex
  invocations with fresh sessions. `integration-reviewer` is a separate Claude
  subagent, also with a fresh context.
* Do not apply this loop recursively to test-builder or reviewer tasks.
* A unit is complete only when its criteria are PASS in `.agents/criteria.md`.

## Model and reasoning effort

| Stage | Runs on |
|---|---|
| implementation | Codex `gpt-5.6-luna` at `model_reasoning_effort=xhigh` |
| corrective pass | the same Codex session, same model and effort |
| `integration-test-builder` | a separate Codex session, same model and effort |
| `integration-reviewer` | a fresh Claude subagent pinned to Opus — not Codex |

Use `gpt-5.6-luna` with `model_reasoning_effort=xhigh` for every task Codex
performs.

Luna is the low-cost tier and the weakest of the three; Terra and Sol are
stronger. Running Luna for all Codex work is a deliberate cost choice, not a
claim that it is the best available worker — which is why xhigh effort, strict
TDD, and the acceptance criteria carry the weight instead of raw model
capability, and why the final gate sits on the Claude side rather than here.

Do not switch models or lower the reasoning effort on your own. Moving to Terra
or Sol is an escalation, not a downgrade, and it is the user's call: report the
specific failure that would justify it rather than escalating silently. Do not
use Ultra at all — it may introduce Codex-managed subagents, which duplicates
the outer orchestrator role. If Luna or xhigh is unavailable, stop and report
the blocker.

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

## Attribute the failure before correcting it

Every failure — a reviewer `FAIL`, a `FAIL (unverifiable)`, or anything needing
a corrective pass — gets attributed first. Run `delegation-prompt-reviewer` in
Mode B, in a fresh Opus subagent, and ask one question: would a competent
worker following this prompt exactly have produced this failure?

* **No — implementation defect.** The prompt was adequate. Send the corrective
  pass below. Record nothing.
* **Yes — prompt defect.** The worker did what the prompt said. Send the
  corrective pass *and* add the pattern to `.agents/prompt-defects.md`.

Skipping this step is what turns a feedback loop back into a treadmill. A
prompt defect patched only by a corrective pass costs the same round again on
the next unit, and on the next task, because nothing recorded why it happened.

Give the subagent the prompt as sent, what the worker produced, and the
failure. Not your view of what went wrong — that is the conclusion you are
asking it to reach independently.

When it returns a prompt defect:

1. Add the pattern to `.agents/prompt-defects.md`, or increment `Seen` on the
   matching row. Record the reusable shape of the mistake, not this unit's
   specifics.
2. If `Seen` reaches 2, promote it: write the rule into the project's
   `CLAUDE.md` conventions and record the promotion. Anything explained to a
   worker twice is a convention that was never written down.
3. Commit the update with the rest of the state files.

Default to prompt defect when the cause is genuinely unclear. A misfiled
implementation defect wastes one row; a misfiled prompt defect repeats itself
indefinitely.

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
