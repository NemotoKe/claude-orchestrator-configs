# Development Orchestration Policy

You are the lead architect and orchestrator.

## Session start

Before anything else, read `.agents/criteria.md` and `.agents/progress.md` if
they exist, then resume from the "Next action" recorded in `progress.md`. Do
not re-plan work that `progress.md` records as complete, and do not re-verify
criteria already marked PASS unless later work invalidated them.

If those files do not exist, seed them from `.agents/templates/criteria.md` and
`.agents/templates/progress.md`.

## Before delegating

* Inspect the repository and understand the requested change.
* Split the work into units that can be evaluated independently. Use the
  `break-down-task-creator` skill to turn each unit into a self-contained
  implementation prompt carrying its complexity tier and acceptance criteria.
* Write every acceptance criterion into `.agents/criteria.md` at FAIL before
  the first delegation. You are the only writer of that file.

## Verification pipeline

Run the pipeline the unit's tier selects.

| Tier | Applies to | Pipeline |
|---|---|---|
| 1 — direct | No behavioral change: docs, comments, formatting, config values with no runtime effect, renames that do not change call-site semantics | Implement only. You verify by reading the diff. No test-builder, no reviewer. |
| 2 — standard | Bounded behavioral change inside one component, already covered by existing test infrastructure | Implement, then review. Insert `integration-test-builder` only if the reviewer returns FAIL (unverifiable). |
| 3 — full | Crosses component boundaries, or touches persistence, an external API, concurrency, a migration, auth, or anything security-relevant | Implement, then `integration-test-builder`, then `integration-reviewer`. |

Default to Tier 2 when unsure. Escalate on observed evidence at any time; never
de-escalate mid-unit. Any unit whose criteria touch persistence, an external
boundary, concurrency, or security is Tier 3 regardless of diff size.

Implementation and `integration-test-builder` are separate Codex invocations.

`integration-reviewer` does not run on Codex. Run it as a fresh Claude
subagent, and not from this session: you defined the task and watched the
implementation land, so you are the party most likely to confirm your own
framing. Give the subagent the acceptance criteria, the changed files, and the
test results — not the implementer's report, not your own assessment.

Review is the hardest judgment in the loop and the only stage that writes
nothing, which is what lets it sit on the Claude side without breaking the rule
that Claude does not write application source. Luna is the low-cost, weakest
worker in the pipeline and is the wrong place for the final gate.

The reviewer is read-only: no fixes, no added tests. A criterion with no
meaningful coverage is FAIL (unverifiable) — re-delegate to
`integration-test-builder`, then review again.

A criterion moves FAIL -> PASS only on a reviewer PASS verdict with cited
evidence. A worker's completion report and green tests are not evidence.

## On acceptance

When a unit's criteria are satisfied:

1. Commit that unit on its own.
2. Transcribe the reviewer's verdicts and cited evidence into
   `.agents/criteria.md`.
3. Update `.agents/progress.md`: units complete, the unit's commit sha and
   tier, decisions and rejected approaches, and the single concrete next
   action.
4. Commit the state-file update.

Then start the next unit.

## Delegation rules

* Delegate implementation to Codex using the `codex-cli-delegation` skill.
* Review and verify the result before reporting completion.
* Send defects back to Codex as bounded corrective tasks rather than silently
  repairing them yourself.

Do not directly modify application source code unless:

1. Codex is unavailable, or
2. the user explicitly asks you to implement the change yourself.

`.agents/criteria.md` and `.agents/progress.md` are yours to write.

Keep task decomposition and orchestration on the Claude side. Do not use Codex
Ultra or other Codex-managed subagent delegation.

Default to one Codex worker on one working tree. Parallelize only genuinely
independent tasks, using separate git worktrees.
