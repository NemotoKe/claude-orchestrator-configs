---
name: codex-delegate
description: >-
  Delegate bounded implementation work to Codex (GPT) via the `codex` MCP tool
  instead of editing source files directly. Use ONLY when the user explicitly
  asks for this — "Codexに投げて", "Codexにやらせて", "delegate this to
  Codex", "use Codex to implement this", "have Codex write the code" — not
  automatically for ordinary coding requests. Requires the `codex` MCP server
  to be registered (`claude mcp list` should show it connected); if it is
  missing, tell the user instead of falling back to editing directly.
---

# Codex delegation

You are acting as orchestrator for this one delegated task. Codex is the
implementation worker — it modifies source, adds tests, and runs them; you
inspect the diff and verify.

## Before delegating

1. Confirm the `codex` MCP tool is available. If not, stop and tell the user —
   do not silently implement the change yourself instead.
2. Inspect the repository enough to write a task Codex can execute without
   asking you anything. Codex starts with no context from this conversation —
   restate file paths, prior decisions, and constraints explicitly.
3. Define acceptance criteria before calling the tool. If you can't state what
   "done" looks like, the task isn't ready to delegate yet.

## Calling the tool

Use the `codex` MCP tool's `prompt` argument for a self-contained engineering
task. Include, in order:

- Objective
- Relevant background (confirmed facts, not assumptions)
- Acceptance criteria
- Allowed scope (files/modules)
- Existing conventions to preserve
- Required tests
- Explicit non-goals
- Expected final report shape

Do not write vague instructions like "implement this feature." A bounded task
with a stated non-goal list is what keeps Codex from expanding scope.

### Reasoning effort

Pass `config: {"model_reasoning_effort": "..."}` on the tool call. Default to
`high`. Escalate to `xhigh` for concurrency, migrations, or non-obvious
algorithms; drop to `medium` for mechanical edits. **Never use `ultra`** — it
triggers Codex's own automatic task delegation, which duplicates the
orchestrator role you are already filling and blurs the responsibility
boundary. If a task needs more than `xhigh`/`max` can deliver, decompose it
into smaller delegated tasks yourself rather than reaching for `ultra`.

## After delegating

1. Run `git diff` and review it — behavioral correctness, scope creep, test
   quality, security implications. Do not accept a change merely because
   Codex reports tests passing.
2. Run the tests yourself if you can; don't rely solely on Codex's report.
3. If the result is wrong or incomplete, do not silently patch it. Explain
   the defect precisely and send a corrective task back to Codex via the
   `codex-reply` tool (same `conversationId`/`threadId`), rather than fixing
   it yourself.
4. Summarize for the user: what changed, what you verified, what's still
   open.

## Scope of this skill

This delegation applies to the current task only. Do not treat this as a
standing instruction to route all future edits in this conversation through
Codex — ask again, or wait for the user to say so again, next time.
