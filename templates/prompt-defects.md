# Prompt Defects

The feedback record for delegated prompts. Unlike `criteria.md` and
`progress.md`, this file outlives the task — it is what makes the next prompt
better than the last one instead of repeating the same mistake at a new
address.

## How an entry gets here

When a unit fails — a reviewer `FAIL`, a `FAIL (unverifiable)`, or any
corrective pass — classify the cause before fixing it:

- **Implementation defect** — the prompt was right and the worker got it
  wrong. Send a corrective pass. Nothing is recorded here.
- **Prompt defect** — the worker did what the prompt said, and the prompt was
  wrong, ambiguous, or incomplete. Record it here.

That distinction is the whole mechanism. A prompt defect patched only by a
corrective pass recurs on the next unit, and the next task, indefinitely — the
loop never closes because nothing learned anything.

Default to prompt defect when the cause is unclear. A worker that
misread an instruction is evidence about the instruction.

## Open defects

| # | Date | Pattern | What the prompt said | What it should have said | Seen |
|---|------|---------|----------------------|--------------------------|------|
| 1 | | | | | 1 |

`Pattern` is the reusable shape of the mistake, not this unit's specifics —
"acceptance criterion stated a behavior with no observable output" rather than
"criterion 3 was vague".

`Seen` counts how many times the pattern has caused a failure. Increment it
instead of adding a duplicate row.

## Promotion rule

A pattern at `Seen` >= 2 stops being a per-task correction and becomes a
standing rule: write it into the project's `CLAUDE.md` conventions, then record
the promotion below. Anything that has to be explained to a worker twice is a
convention that was never written down.

## Promoted

| Pattern | Promoted to | Date |
|---------|-------------|------|
