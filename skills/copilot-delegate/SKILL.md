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
  usage-based OpenAI billing) but Copilot CLI is. Requires the `copilot` MCP
  server (the bridge in opus5-copilot-orchestrator/bridge/) to be registered
  and connected (`claude mcp list`); if it is missing, tell the user instead
  of falling back to editing directly.
---

# Copilot delegation

You are acting as orchestrator for this one delegated task. The Copilot CLI
worker is the implementation worker — it modifies source, adds tests, and
runs them; you inspect the diff and verify. This mirrors `codex-delegate`;
read that skill's structure if you need the fuller rationale. The differences
below come from how the `copilot` MCP bridge actually works, not from a
different philosophy.

## Before delegating

1. Confirm the `copilot` MCP tool is available and connected. If not, stop
   and tell the user — do not silently implement the change yourself.
2. Confirm the working directory is inside a git repository. The bridge
   refuses to run otherwise, by design — the worker edits files in place,
   and git is what makes that reviewable and revertible.
3. Inspect the repository enough to write a task the worker can execute
   without asking you anything. It starts with no context from this
   conversation — restate file paths, prior decisions, and constraints
   explicitly.
4. Define acceptance criteria before calling the tool.

## Build the delegated task

Before writing or sending an implementation task, use the
`break-down-task-creator` skill to turn the rough request into a concise,
self-contained implementation prompt. Treat its output as the task body and
preserve its objective, requirements, constraints, acceptance criteria, TDD
scenarios, and non-goals.

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
3. If the result is wrong or incomplete, do not silently patch it. Explain
   the defect precisely and send a corrective task via `copilot_reply` with
   the `sessionId` from the original call, rather than fixing it yourself.
   If the bridge's `resume` flag is disabled in the target config, `sessionId`
   won't actually resume worker context — restate the needed background in
   the follow-up prompt rather than assuming it carried over.
4. Summarize for the user: what changed, what you verified, what's still
   open.

## Scope of this skill

This delegation applies to the current task only. Do not treat this as a
standing instruction to route all future edits in this conversation through
Copilot — ask again, or wait for the user to say so again, next time.
