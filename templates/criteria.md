# Acceptance Criteria

Task: <task name>
Created: <date>

## Contract

Every criterion below starts at **FAIL** and stays FAIL until the
integration-reviewer returns a PASS verdict for it with cited evidence. A
Tier 1 unit runs no reviewer; its criteria move to PASS only on the
orchestrator's own diff review, recorded with the same evidence standard.

- Absence of evidence is FAIL, not PASS.
- Materiality is not the reviewer's call. Every criterion in this table gets
  a verdict; only the orchestrator may move one to "Deferred / out of scope".
- "Looks correct", "the tests are green", and the implementation worker's own
  completion report are not evidence.
- Only the orchestrator writes this file. The reviewer returns a verdict; it
  does not edit this file, and it has no write access to the repository.
- A criterion moves FAIL -> PASS only on a reviewer PASS. If later work
  invalidates it, move it back to FAIL and re-verify.
- Deleting a criterion is not a way to satisfy it. Move it to
  "Deferred / out of scope" with a reason instead.
- The task is complete only when every criterion is PASS or explicitly
  deferred.

## Criteria

| # | Unit | Criterion | Status | Evidence |
|---|------|-----------|--------|----------|
| 1 | U1   | <independently verifiable completion condition> | FAIL | — |
| 2 | U1   | <...> | FAIL | — |
| 3 | U2   | <...> | FAIL | — |

Evidence column: the command that was run and its observed result, the test
name that covers the criterion, or the specific file and line inspected. A
restatement of the criterion is not evidence.

## Deferred / out of scope

Criteria deliberately not verified in this task, each with the reason.
