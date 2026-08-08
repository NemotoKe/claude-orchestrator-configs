---
name: codex-cli-delegation
description: Delegate one bounded implementation task to Codex CLI while the outer agent owns repository inspection, task decomposition, acceptance criteria, model selection, diff review, and independent verification. Use when the user explicitly asks to delegate implementation to Codex CLI.
---

# Codex CLI delegation

You are the orchestrator. Codex CLI is the implementation worker.

You define the task, inspect the result, and verify it independently. Do not
silently implement or repair Codex's changes yourself.

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

3. Define explicit acceptance criteria before delegation.

## Delegate

Run Codex from the repository root with `codex exec`.

```bash
cat <<'EOF' | codex exec \
  --sandbox workspace-write \
  --json \
  -m gpt-5.6-terra \
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

## Model selection

| Model           | Use                                           |
| --------------- | --------------------------------------------- |
| `gpt-5.6-luna`  | Mechanical work, tests, review                |
| `gpt-5.6-terra` | Default implementation                        |
| `gpt-5.6-sol`   | Difficult reasoning or repeated Terra failure |

Escalate based on observed failure, not anticipated difficulty.

Max is allowed when more reasoning is useful.

Do not use Ultra. Ultra may introduce Codex-managed subagents, which duplicates
the outer orchestrator role. Decompose the task instead.

A typical escalation path is:

```text
Terra -> Terra Max -> Sol -> Sol Max
```

Raw `model_reasoning_effort` is separate from `/model` modes. Do not assume Max
or Ultra maps directly to a raw reasoning-effort value.

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

## Corrective pass

If the implementation is wrong or incomplete, send a precise correction to the
same session instead of fixing it yourself:

```bash
cat <<'EOF' | codex exec resume <SESSION_ID> -
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

## Responsibility boundary

The orchestrator owns task definition, scope, acceptance criteria, model
selection, review, and verification.

Codex owns source edits, tests, implementation-level execution, and corrective
changes.

## Final report

Tell the user:

* what changed
* which model/mode was used
* what you independently verified
* whether acceptance criteria passed
* anything still unresolved

This skill applies only to the current explicitly delegated task.

