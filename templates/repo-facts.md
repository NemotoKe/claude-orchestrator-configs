# Repository Facts

The durable record of what this repository is actually like. Subagents discover
non-obvious facts about the codebase and then their context ends; without this
file the next subagent pays to learn the same thing again. Like
`prompt-defects.md` and unlike `criteria.md` and `progress.md`, this file
outlives the task.

Read it at the start of every session, and hand the relevant rows to a worker
or reviewer as context rather than making it rediscover them.

## What belongs here

A fact earns a row when it is **durable** and **expensive to discover**:

- A convention the code follows that is nowhere stated — naming, layering, an
  ordering that matters.
- Wiring: what registers what, where a thing is constructed, what the real
  entry point is.
- A boundary: which module owns a concern, what is not allowed to call what.
- Test-infrastructure requirements: an env var the suite needs, a fixture that
  must be built first, a command that must run before tests pass.
- Why an obvious approach does not work, and what happened when it was tried.

## What does not belong here

- Anything recoverable by reading one file or running one ripgrep. If it is one
  search away it is cheaper to search than to maintain.
- Anything task-specific: this unit's decisions, what to do next, why an
  approach was rejected *for this task*. That is `progress.md`.
- Restatements of the framework's own documentation, or of `CLAUDE.md`.

## Contract

- Only the orchestrator writes this file. Subagents report facts in their
  return; the orchestrator judges them and transcribes them here. Subagents
  stay read-only, exactly as with `criteria.md`.
- Record a fact only after it has been observed, with the paths it came from.
  A guess is not a fact.
- Every row records the commit sha the fact was observed at. Without the sha
  there is no way to tell a current fact from a stale one.
- Prefer few, high-value rows. See "Cost of volume".

## Facts

| # | Fact | Paths | Observed at | Reported by |
|---|------|-------|-------------|-------------|
| F1 | <the non-obvious thing, stated so a worker can act on it> | <path/one.ts, path/two/> | <sha> | <integration-reviewer \| delegation-prompt-reviewer \| integration-test-builder \| orchestrator> |

`#` is a stable id. Cite it (`F1`) from a delegated prompt or another state
file; do not renumber rows when one is removed.

`Fact` is one or two sentences, stated as a claim about the repository, not as
advice. "Migrations run before the app container starts, so a schema change
needs both files updated" — not "remember to update both files".

`Paths` are the files or directories the fact describes. They are what makes
the fact checkable: they are the thing compared against `Observed at`. A fact
with no paths cannot be verified and should not be recorded.

`Observed at` is the commit sha at which the fact was seen to hold.

`Reported by` is the subagent or stage that surfaced it, so a fact can be
weighed against what that stage was in a position to see.

## Staleness

A fact whose `Paths` have changed since its `Observed at` sha is **unverified**.
Unverified is not false and not true — it means the fact has not been checked
against the current code.

Check with:

```bash
git diff --name-only <observed-sha>..HEAD -- <paths>
```

Empty output: the fact still stands, use it. Any output: re-confirm the fact
against the current code before relying on it, then either

- update `Observed at` to the current sha, or
- correct the `Fact` text and update `Observed at`.

Do not pass an unverified fact to a worker as established context, and do not
delete a fact because it went stale. A corrected fact is worth more than a
missing one — the cost of discovering it was already paid, and re-confirming is
cheaper than re-deriving. Delete a row only when the thing it describes no
longer exists.

Staleness is derived, never stored: there is no status column, because a status
column would itself go stale. The sha and the paths are the whole mechanism.

## Cost of volume

This file is read at the start of every session, so every row is paid for
again on every future session. A fact that is obvious to anyone reading the
code, that duplicates another row, or that a single ripgrep would answer is a
net loss, however true it is.

Before adding a row, ask whether a competent worker seeing this repository for
the first time would have to spend real effort to learn it. If not, leave it
out. Prune rows that stopped earning their place.
