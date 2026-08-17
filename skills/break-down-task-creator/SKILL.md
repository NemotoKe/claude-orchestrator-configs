---
name: break-down-task-creator
description: Transform rough engineering tasks into concise, self-contained implementation prompts for coding agents or subagents, each declaring a complexity tier and default-FAIL acceptance criteria, with strict Test-Driven Development as the required implementation process for Tier 2 and Tier 3 units.
---

# Break Down Task Creator

## Purpose

Transform a rough engineering task into a high-signal, self-contained implementation prompt for a coding agent or subagent.

Keep the prompt independent of any particular model, provider, CLI, or reasoning
mode. The caller may add worker-specific invocation details after generating the
prompt, but the task itself must remain portable across implementation agents.

The generated prompt must declare the unit's complexity tier and emit acceptance
criteria in default-FAIL form.

The generated prompt must drive implementation using Test-Driven Development
(TDD) for Tier 2 and Tier 3 units.

## Core Principles

### 1. Outcome over implementation

Specify:

- desired behavior
- constraints
- invariants
- acceptance criteria

Do not prescribe implementation details unless they are actual requirements.

### 2. Repository first

Before making changes, inspect the relevant production code, existing tests, conventions, and abstractions.

Prefer the repository's existing design unless it conflicts with the requested behavior.

### 3. TDD is the implementation process

Required for Tier 2 and Tier 3 units.

Tier 1 units are exempt: they change no behavior, so there is no Red → Green
cycle to run. The exemption follows from the absence of behavior, not from
testing being inconvenient. If a unit classified Tier 1 turns out to change
behavior, it was misclassified — escalate it and TDD applies.

All behavioral changes must follow:

1. **Red** — add or modify a test that expresses the required behavior and verify that it fails for the expected reason.
2. **Green** — make the smallest production-code change necessary to make the test pass.
3. **Refactor** — improve the implementation while keeping all tests green.

Do not implement production behavior first and add tests afterward.

For bugs, first reproduce the bug with a failing regression test.

For refactoring tasks, establish characterization tests when existing behavior is insufficiently protected.

If a meaningful automated test cannot reasonably be written, explain why before making the implementation change.

### 4. Small increments

Prefer multiple small Red → Green cycles over implementing the entire task before running tests.

Each cycle should introduce one coherent behavior.

### 5. Preserve behavior outside scope

Existing behavior outside the task must remain unchanged.

Do not perform unrelated refactoring.

---

## Complexity Tiers

Classify every implementation unit into exactly one tier. The classification is
made here, not left to the implementation agent's intuition and not re-derived
downstream.

The tier selects which verification agents run after implementation. A unit
classified too low silently loses the verification it needed: no reviewer means
no PASS verdict, and no evidence means its criteria stay FAIL.

| Tier | Applies to | Pipeline |
|---|---|---|
| 1 — direct | No behavioral change: docs, comments, formatting, config values with no runtime effect, renames that do not change call-site semantics | implement only; the orchestrator verifies by reading the diff. No test-builder, no reviewer. |
| 2 — standard | Bounded behavioral change inside one component, already covered by existing test infrastructure | implement → integration-reviewer. Insert integration-test-builder only if the reviewer returns `FAIL (unverifiable)`. |
| 3 — full | Crosses component boundaries, or touches persistence, an external API, concurrency, a migration, auth, or anything security-relevant | implement → integration-test-builder → integration-reviewer. |

Rules:

- Default to Tier 2 when the tier is unclear.
- Any unit whose criteria touch persistence, an external boundary, concurrency,
  or security is Tier 3 regardless of how small the diff is.
- Escalate on observed evidence at any time. Never de-escalate mid-unit.
- Classify a unit by the highest tier any part of it reaches.

---

## Prompt Structure

### Objective

Describe the desired end state in 1–3 sentences.

### Complexity Tier

Declare exactly one tier — `Tier 1 — direct`, `Tier 2 — standard`, or
`Tier 3 — full` — with a one-line justification naming the rule that produced
it. Classify per "Complexity Tiers" above.

### Context

Include only repository or domain context that materially affects implementation.

### Requirements

List the required observable behavior.

### Constraints

Specify invariants and boundaries such as:

- preserve public APIs
- maintain backward compatibility
- avoid new dependencies
- preserve unrelated behavior

### Acceptance Criteria

Define completion conditions in the shape the orchestrator transcribes directly
into `.agents/criteria.md`. Target format: `.agents/templates/criteria.md`.

Each criterion is:

- numbered, starting at 1
- one observable outcome — not a list, not a conjunction
- independently verifiable, without checking another criterion first
- tagged with its unit id (U1, U2, ...)

Emit one row per criterion:

`| <n> | <unit id> | <criterion> | FAIL | — |`

Use the unit id the caller assigned. If the caller supplied none, label the unit
U1 and say so, so the orchestrator can renumber.

Every criterion starts at **FAIL**. A criterion moves to PASS only when the
integration-reviewer returns a PASS verdict for it with cited evidence; for a
Tier 1 unit, which runs no reviewer, only on the orchestrator's diff review.
Never emit a criterion already marked PASS, and never emit a status other than
FAIL.

Do not emit a criterion whose evidence cannot be described. For each one, state
what would demonstrate it: the command and its observed result, the test that
covers it, or the file and line to inspect. A criterion with no describable
evidence is restated until it has one, or moved to Non-goals.

### TDD Scenarios

Translate the acceptance criteria into behavioral scenarios to drive implementation.

Focus on:

- normal behavior
- boundary conditions
- regression cases
- important failure paths

Do not prescribe exact test code unless necessary.

Omit this section for Tier 1 units — no behavior changes, so there is nothing to
drive.

### Non-goals

Explicitly identify adjacent work that should not be performed when useful.

---

## Implementation Instructions

Inspect the relevant repository code and existing tests before changing anything.

For a Tier 2 or Tier 3 unit, implement the task using strict TDD.

For a Tier 1 unit, make the change directly and report the diff for the
orchestrator to review. Do not add tests for behavior that did not change. If
implementing the unit requires a behavioral change, stop and report the
misclassification instead of proceeding.

For each behavioral increment:

1. Add or modify the smallest test that captures the next required behavior.
2. Run it and confirm it fails for the expected reason.
3. Change production code minimally until the test passes.
4. Run the relevant test suite.
5. Refactor only while tests remain green.
6. Continue with the next behavior.

Do not:

- write the complete production implementation before tests
- weaken assertions merely to make tests pass
- change existing tests to accommodate incorrect behavior
- mock away the behavior being tested
- perform unrelated cleanup

Reuse existing test conventions, helpers, fixtures, and abstractions where appropriate.

If repository evidence contradicts an assumption in the prompt, follow the repository's actual design while preserving the requested behavior.

## Completion Report

At completion, report:

- declared complexity tier, and any escalation made during the unit
- changed files
- implemented behavior
- Red → Green cycles performed (Tier 2 and Tier 3)
- tests added or changed
- tests/checks executed
- relevant design decisions
- unresolved issues

## Output Rules

Return only the implementation prompt.

Keep it concise and execution-oriented.

Include information that constrains correctness, not information the implementation agent can cheaply discover itself.
