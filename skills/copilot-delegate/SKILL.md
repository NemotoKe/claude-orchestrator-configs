---
name: copilot-delegate
description: >-
  Delegate bounded implementation work to the GitHub Copilot CLI worker via
  `copilot -p` from the shell instead of editing source files directly. Use
  ONLY when the user explicitly asks for this — "Copilotに投げて", "Copilotに
  やらせて", "delegate this to Copilot", "use Copilot to implement this" —
  not automatically for ordinary coding requests. Prefer `codex-delegate`
  when Codex is available; reach for this one specifically when Codex is not
  usable in the current environment (no ChatGPT subscription, no
  usage-based OpenAI billing) but Copilot CLI is. Carries the same contract
  as `codex-delegate`: default-FAIL acceptance criteria in
  `.agents/criteria.md`, handoff state in `.agents/progress.md`, recorded
  prompt defects in `.agents/prompt-defects.md`, durable repository facts in
  `.agents/repo-facts.md`, complexity tiers that select the verification
  pipeline, a structural pre-flight hook, and a read-only reviewer. The
  reviewer runs as a fresh Claude subagent pinned to Opus, not on Copilot CLI.
  Requires the `copilot` CLI to be installed and authenticated
  (`command -v copilot`, `copilot --help`); if it is missing, tell the user
  instead of falling back to editing directly.
---

# Copilot delegation

You are acting as orchestrator for this one delegated task. The Copilot CLI
worker is the implementation worker — it modifies source, adds tests, and
runs them; you inspect the diff and verify. This mirrors `codex-delegate` in
every load-bearing respect; read that skill's structure if you need the fuller
rationale. The differences below come from how the `copilot` CLI actually
works — `--resume <sessionId>` instead of `codex exec resume`, a session id
you read out of the CLI's own output instead of structured JSON, no fixed
mandatory model — not from a different philosophy.

You are also the only writer of the state files. The worker does not touch
them, and neither does the reviewer.

## Session start

Do this before anything else, including repository inspection.

1. Check for existing state:

   ```bash
   ls .agents/progress.md .agents/criteria.md .agents/prompt-defects.md \
      .agents/repo-facts.md
   ```

2. If `.agents/progress.md` or `.agents/criteria.md` exists, read both before
   acting. Resume from the "Next action" recorded in `.agents/progress.md`.
   Treat `.agents/criteria.md` as the authoritative status of every criterion.
   Do not re-plan, do not re-derive units, and do not redo units already
   recorded as complete.
3. Read "Decisions and constraints discovered" and "Blocked / unresolved" in
   `.agents/progress.md` before choosing an approach, so a rejected approach
   is not retried.
4. Read `.agents/prompt-defects.md` if it exists. It records prompt failure
   patterns from earlier work — including earlier tasks — and every prompt
   you write this session must avoid them.
5. Read `.agents/repo-facts.md` if it exists, and treat any fact whose `Paths`
   changed since its `Observed at` sha as unverified — confirm it before
   relying on it. Put the facts a unit depends on into the delegated prompt;
   the worker cannot read this file's authority, only what you restate.
6. Only when neither `progress.md` nor `criteria.md` exists, build a fresh
   plan. Seed both from `.agents/templates/progress.md` and
   `.agents/templates/criteria.md`.

These files are the memory across sessions. `.agents/criteria.md` and
`.agents/progress.md` track this task; `.agents/prompt-defects.md` and
`.agents/repo-facts.md` outlive it. The orchestrator is the only writer of all
four.

## Before delegating

1. Confirm Copilot CLI is available and authenticated:

   ```bash
   command -v copilot
   copilot --help
   ```

   If unavailable, stop and tell the user — do not silently implement the
   change yourself.

2. Confirm the working directory is inside a git repository. Nothing enforces
   this for you the way a bridge would — the worker edits files in place, and
   git is what makes that reviewable and revertible, so check it yourself
   before delegating.
3. Inspect the repository enough to write a task the worker can execute
   without asking you anything. It starts with no context from this
   conversation — restate file paths, prior decisions, and constraints
   explicitly.
4. Split the request into the smallest coherent units that can be evaluated
   independently. Each unit should have one primary observable outcome, its
   own acceptance criteria, and its own relevant tests or checks.

## Build the delegated task

Before writing or sending an implementation task, use the
`break-down-task-creator` skill to turn the rough request into a concise,
self-contained implementation prompt. Treat its output as the task body and
preserve its objective, requirements, constraints, acceptance criteria, TDD
scenarios, and non-goals.

Its output also declares the unit's complexity tier (1 direct, 2 standard, 3
full). Carry that tier with the unit; it selects the pipeline below. If a unit
arrives without a tier, treat it as Tier 2.

Do not combine unrelated outcomes into one delegation. If units depend on one
another, state the dependency and delegate them in order; still give each unit
an independently verifiable completion condition. Send one unit per `copilot`
invocation. Add only Copilot-specific invocation details around the prompt.

## Check the prompt before sending it

The prompt decides everything downstream. A bad one is not caught cheaply — it
is caught by a failed implementation round, which is the most expensive place
to find it. Two gates run before the prompt leaves.

### The hook — structure

`.agents/hooks/validate-delegation.sh` runs as a `PreToolUse` hook on every
Bash call and denies the tool call outright when a `copilot -p` prompt is
missing required sections or references conversation context the worker does
not have. It shares the same script as the Codex path, telling the two
workers apart by command text instead of tool name; Codex's mandatory
model/effort flag check does not apply here, since Copilot has no single
fixed model to check for.

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

## State files

Two files under `.agents/` carry state across worker calls and across
sessions, plus two that carry state across tasks. Formats:
`.agents/templates/*.md`.

- `.agents/criteria.md` — every acceptance criterion starts at `FAIL` and
  moves to `PASS` only on an integration-reviewer PASS verdict with cited
  evidence. Absence of evidence is FAIL. The worker's own completion report
  is not evidence. You are the only writer.
- `.agents/progress.md` — the handoff record. Update it after each accepted
  unit: units complete, current unit, criteria PASS count, last commit sha,
  next action, decisions and rejected approaches, blockers. A new session's
  first act is to read both files and continue from "Next action".
- `.agents/prompt-defects.md` — outlives the task. See "Attribute the failure
  before correcting it".
- `.agents/repo-facts.md` — outlives the task. See "Recording repository
  facts".

Each accepted unit gets its own git commit, and its sha is recorded in
`.agents/progress.md`. The state update is then committed separately.

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

## Create the criteria file

After `break-down-task-creator` has produced the units and their acceptance
criteria, and before delegating the first unit:

1. Copy `.agents/templates/criteria.md` to `.agents/criteria.md`, creating
   `.agents/` if needed.
2. Fill in the task name and date, and add one row per acceptance criterion
   with the unit it belongs to.
3. Leave every criterion at `FAIL` with an empty evidence cell.

Do not delegate any unit until this file exists. A criterion that is not in
the file is not tracked and cannot be accepted.

## Delegate

Run Copilot from the repository root with `copilot -p`. The prompt is a shell
argument, not stdin, so build it as a variable first:

```bash
TASK=$(cat <<'EOF'
<SELF-CONTAINED TASK>
EOF
)
copilot -p "$TASK" \
  --model gpt-5.6-terra \
  --effort medium \
  --allow-all-tools
```

Include:

* Objective
* Relevant background and paths
* Complexity tier
* Acceptance criteria
* Allowed scope
* Required tests
* Non-goals

Read the session id out of the command's own output before you need it for a
corrective pass — see "Capturing the session id" below. Do not assume `terra`
and `medium` fit every unit; choose per "Choosing a model" and "Reasoning
effort".

### Capturing the session id

There is no wrapper extracting this for you. Copilot CLI prints a resume hint
to **stderr** (verified 2026-08-03 against copilot 1.0.77) as a line
containing `--resume=<id>`; with `--output-format json` it instead appears as
`"sessionId":"<id>"` in the stdout result line. Read the Bash tool's output
after every `copilot -p` call and record the id — you will need it verbatim
for a corrective pass. If it is not visible, re-run with `--output-format
json` if your installed version supports it.

### Choosing a model — requires Copilot Pro (or higher)

Pass `--model` as one of these slugs (confirm with `copilot --help` that your
account's model list actually contains them):

| Alias | Slug | Use for |
|---|---|---|
| luna | `gpt-5.6-luna` | Mechanical edits, renames, test scaffolding — and `integration-test-builder`, spec-driven or self-directed |
| terra | `gpt-5.6-terra` | **Default** — bounded implementation against clear acceptance criteria |
| sol | `gpt-5.6-sol` | Non-obvious algorithms, concurrency, tricky migrations |

Escalate on evidence, not anticipation: `terra` first, `sol` only after a
concrete failure.

`integration-reviewer` does not run through `copilot` at all — see "Reviewer
invocation" below.

> **Plan-gated, not a naming issue.** On a Copilot free/individual account
> every explicit `--model` value was rejected — not because the slug was
> wrong, but because `gh api /copilot_internal/user` showed
> `premium_interactions.entitlement: 0`: the free tier has zero quota for
> premium models, full stop. This table is written for a **Copilot Pro (or
> higher)** account where that entitlement is nonzero, and is **unverified**
> end-to-end even there. Before trusting it: `gh api /copilot_internal/user
> --jq .quota_snapshots.premium_interactions` and confirm `entitlement > 0`,
> then run one real `copilot -p` call with an explicit `--model` and check
> exit 0 before relying on it for actual work. If the account is still on the
> free tier, omit `--model` entirely — don't retry different spellings; the
> plan is the blocker, not the string.

### Reasoning effort — needs an explicit model, not the default

Pass `--effort` as `none` / `minimal` / `low` / `medium` / `high` / `xhigh` /
`max`. Default to `medium`. There is no `ultra`-equivalent and no
auto-delegation mode to avoid here the way there is with Codex's `ultra` —
Copilot CLI doesn't expose one.

**Confirmed 2026-08-04: `--effort` only works together with an explicit
`--model`.** Passing it while the model resolves to the CLI's auto default
fails outright — `Error: Model "auto" does not support reasoning effort
configuration`. So `--effort` is gated by the same Pro-plan requirement as
`--model` above: on a free-tier account, leave `--effort` off — there's no
model to attach it to.

## Per-unit execution loop

Process implementation units in dependency order. Do not start the next unit
until the current unit has been accepted and recorded (see "Accepting a
unit").

Every tier starts the same way: delegate the implementation prompt to
`terra` (escalating to `sol` only on observed failure, per "Choosing a
model"), capture the session id from the CLI's own output, then review the
diff yourself as described in "After delegating". The tiers differ in what
follows.

### Tier 1 — direct

1. Confirm from the diff that the change is non-behavioral and matches the
   unit's criteria. Anything behavioral means the unit was misclassified:
   escalate to Tier 2 or 3 and continue there.
2. Accept the unit on your own diff review, or send a corrective pass.

Do not invoke the test-builder or the reviewer for a Tier 1 unit.

### Tier 2 — standard

1. Run the reviewer in a fresh Claude subagent using the
   `integration-reviewer` skill. See "Reviewer invocation".
2. When every criterion comes back `PASS`, accept the unit.
3. When any criterion comes back `FAIL (unverifiable)`, invoke `copilot -p`
   with `--model gpt-5.6-luna` using the `integration-test-builder` skill in
   spec-driven mode, carrying the reviewer's test specification for each
   uncovered criterion. Then re-review in a **new** subagent — see
   "Spec-driven test building". The unit stays Tier 2.
4. When any criterion comes back plain `FAIL`, send a corrective pass with
   `copilot -p ... --resume <sessionId>`, then re-run the reviewer in a fresh
   subagent.

### Tier 3 — full

1. Invoke `copilot -p` with `--model gpt-5.6-luna` using the
   `integration-test-builder` skill in self-directed mode — no reviewer has
   run yet, so there is no specification to carry. Give it only the current
   unit's requirements, acceptance criteria, changed files, and relevant test
   results. Have it add or improve independently executable integration
   tests and run them.
2. Run the reviewer in a fresh Claude subagent using the
   `integration-reviewer` skill. See "Reviewer invocation".
3. When every criterion comes back `PASS`, accept the unit.
4. When any criterion comes back `FAIL (unverifiable)`, re-run the
   test-builder (`--model gpt-5.6-luna`) in spec-driven mode for the
   uncovered criteria only, carrying the reviewer's test specification. Then
   re-review in a **new** subagent — see "Spec-driven test building".
5. When any criterion comes back plain `FAIL`, send a corrective pass with
   `copilot -p ... --resume <sessionId>`, then re-run the reviewer in a fresh
   subagent.

### Spec-driven test building

When the reviewer returns `FAIL (unverifiable)`, it has already worked out
what evidence is missing and what test would produce it. Carry that
specification to the test-builder instead of letting it re-derive the answer.

The reviewer runs on Opus and designs the test; the test-builder runs on
Copilot CLI's `luna` and implements it. Deciding *what* to test is the
judgment most prone to producing a test that mirrors the implementation, and
it does not belong on the cheapest tier in the pipeline. Constructing the test
from a precise spec does.

Pass the spec through verbatim — boundary to exercise, setup required,
observable to assert, and the "must fail when" mutation. That last field is
what proves the test discriminates; a test-builder that skips it has produced
a test that may pass regardless of the code. If the test-builder reports the
spec is unimplementable, do not have it build something adjacent — take that
back to a reviewer as a finding about observability.

**The re-review must be a different subagent than the spec author.** A
reviewer cannot honestly ask "could this test pass despite a wrong
implementation?" about a test it designed. Start a new fresh subagent and give
it no indication that the test came from a prior reviewer's spec. This is the
same self-grading hole the read-only rule closed, in a subtler form — the
reviewer that wrote the spec has an answer it is invested in.

Designing a spec does not compromise the reviewer's independence. What must
stay independent is independence *from the implementation*, and the spec is
derived from the criterion and the requirements — which is exactly what
`integration-test-builder` is already required to do.

### Reviewer invocation

The reviewer does not run through `copilot`. Run it as a **fresh Claude
subagent pinned to Opus**.

Pin the model explicitly rather than letting the subagent inherit it. An
inherited model makes the strength of the final gate depend on how the
orchestrator session happened to be started, and a gate that quietly weakens
is worse than a gate you know is weak.

Do not tier the reviewer's model the way the pipeline is tiered. The reviewer
is what catches a unit that was classified too low; if it weakened along with
the tier, a misclassified unit would get both the thinner pipeline and the
weaker gate at once. Tiering already limits the cost — a Tier 1 unit never
invokes the reviewer at all.

Review is the hardest judgment in the loop — deciding whether a test could
pass despite a wrong implementation, whether a mock hides the behavior that
matters, and whether cited evidence actually supports a criterion. Even at
`sol`, the Copilot worker tiers exist for implementation work, not to host an
independent final gate, and the reviewer is the one stage that writes
nothing — which is what makes it eligible to move to the Claude side instead
of running through the worker at all.

Do not review from the orchestrator session. You defined the task, chose the
scope, and watched the implementation land; you are the party most likely to
confirm your own framing. The subagent must start with a context that has
never seen any of that.

The reviewer is read-only. State this in its prompt:

* It has no write access to the repository. It must not edit source, tests,
  configuration, or the state files.
* It returns a verdict, not a change: one row per acceptance criterion with
  `PASS`, `FAIL`, or `FAIL (unverifiable)`, plus cited evidence.
* A criterion no test covers is `FAIL (unverifiable)`. It must not add or fix
  a test to make that criterion verifiable; the orchestrator re-delegates
  that to `integration-test-builder`.
* Evidence is the command run and its observed result, the test name
  covering the criterion, or the file and line inspected. A restatement of
  the criterion is not evidence.

Give it the unit's acceptance criteria, the changed files, and the test
results — and nothing else. Do not give it the implementer's completion
report, its conclusions, its session id, your own assessment of the change,
or the reasoning behind the task decomposition. Every one of those imports the
conclusion you are asking it to check independently.

If it edits anything anyway, treat the run as invalid, restore the files, and
re-review in a new subagent.

### Applies to every tier

* Each `copilot` invocation carries exactly one unit.
* Implementation and `integration-test-builder` are always separate `copilot`
  invocations with fresh sessions (never a `--resume` chained off a prior
  call for a new stage). `integration-reviewer` is a separate Claude subagent,
  also with a fresh context.
* Do not apply this loop recursively to test-builder or reviewer tasks.
* A unit is complete only when its criteria are PASS in `.agents/criteria.md`.

## After delegating

1. Run `git diff` and review it — behavioral correctness, scope creep, test
   quality, security implications. Do not accept a change merely because the
   worker reports tests passing.
2. Run the tests yourself if you can.
3. Run the unit's tier pipeline (above).
4. If the result is wrong or incomplete, attribute the failure first — see
   "Attribute the failure before correcting it" — then send a corrective task
   via `copilot -p ... --resume <sessionId>` rather than fixing it yourself.
   Model and effort are not inherited across `--resume` the way a bridge
   might have done it — restate `--model` and `--effort` on the corrective
   call if you want the same tier, and restate any needed background in the
   prompt, since `--resume` continues the worker's own session state but not
   anything this orchestrator session knows.
5. Accept the unit and record state (below).
6. Summarize for the user: what changed, what you verified, what's still
   open.

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

## Attribute the failure before correcting it

Every failure — a reviewer `FAIL`, a `FAIL (unverifiable)`, or anything
needing a corrective pass — gets attributed first. Run
`delegation-prompt-reviewer` in Mode B, in a fresh Opus subagent, and ask one
question: would a competent worker following this prompt exactly have
produced this failure?

* **No — implementation defect.** The prompt was adequate. Send the
  corrective pass via `copilot -p ... --resume <sessionId>`. Record nothing.
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

`.agents/prompt-defects.md` is shared across both delegation paths — a pattern
recorded from a Codex unit applies here too, and vice versa. Read it at
session start regardless of which worker this session uses.

## Corrective pass

If the implementation is wrong or incomplete, send a precise correction to
the same session instead of fixing it yourself:

```bash
TASK=$(cat <<'EOF'
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
)
copilot -p "$TASK" \
  --resume <SESSION_ID> \
  --model gpt-5.6-terra \
  --effort medium
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

Copilot CLI owns source edits, tests, implementation-level execution, and
corrective changes.

## Final report

Tell the user:

* what changed
* which model/effort was used
* each accepted unit with its tier and commit sha
* what you independently verified
* the criteria PASS count and which criteria are still FAIL
* anything still unresolved, and the next action recorded in
  `.agents/progress.md`

## Scope of this skill

This delegation applies to the current task only. Do not treat this as a
standing instruction to route all future edits in this conversation through
Copilot — ask again, or wait for the user to say so again, next time.
