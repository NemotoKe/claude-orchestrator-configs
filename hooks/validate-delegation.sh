#!/bin/sh
# PreToolUse hook: structurally validate delegation prompts, for both the
# Codex CLI path (Bash `codex exec`) and the Copilot CLI path (the `copilot`
# MCP bridge's `copilot` / `copilot_reply` tools).
#
# Everything else in this repository is a policy the model is asked to follow.
# This is the one check that runs whether or not the model complied, which is
# why it enforces only what a script can decide without judgment: required
# sections and phrases that prove the prompt is not self-contained. Codex also
# gets a standing model/effort flag check, because Codex delegation has one
# mandatory model. Copilot has no equivalent fixed model — terra is the
# default and sol is an evidence-based escalation, both legitimate — so that
# check does not port; the model choice there is `delegation-prompt-reviewer`
# and orchestrator judgment, not something a script can gate.
#
# Semantic quality — whether a criterion is actually verifiable, whether the
# scope is genuinely bounded — is `delegation-prompt-reviewer`'s job. Do not
# add judgment calls here. A gate that fires on ambiguous input gets disabled,
# and a disabled gate checks nothing.
#
# Reads the PreToolUse payload on stdin; emits a permission decision on stdout.

set -u

payload=$(cat)

# Without jq there is no reliable way to read the command out of the payload.
# Fail open with a visible warning rather than blocking every call in the
# session — a broken hook that stops all work is worse than an absent one.
if ! command -v jq >/dev/null 2>&1; then
    printf '%s\n' '{"systemMessage":"validate-delegation: jq not found — delegation prompts are NOT being validated."}'
    exit 0
fi

tool_name=$(printf '%s' "$payload" | jq -r '.tool_name // ""')

# Identify which worker this call targets, and where its prompt text lives.
# Codex: a Bash call piping a heredoc into `codex exec`. Copilot: an MCP tool
# call on the bridge's `copilot` / `copilot_reply` tools, matched by tool-name
# suffix so this survives the bridge being registered under a different MCP
# server name than "copilot".
worker=""
command_text=""

if [ "$tool_name" = "Bash" ]; then
    command_text=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
    case "$command_text" in
        *"codex exec"*) worker="codex" ;;
        *) exit 0 ;;
    esac
else
    case "$tool_name" in
        *"__copilot_reply") worker="copilot-reply" ;;
        *"__copilot") worker="copilot" ;;
        *) exit 0 ;;
    esac
    command_text=$(printf '%s' "$payload" | jq -r '.tool_input.prompt // ""')
fi

missing=""
leaks=""
flags=""

has() {
    printf '%s' "$command_text" | grep -qi -- "$1"
}

require() {
    has "$1" || missing="$missing
  - $2"
}

case "$worker" in
    codex)
        case "$command_text" in
            *"codex exec resume"*)
                kind="Codex corrective pass"
                require "Defect:" "Defect:"
                require "Evidence:" "Evidence:"
                require "Required correction:" "Required correction:"
                ;;
            *)
                kind="Codex delegation"
                require "Objective" "Objective"
                require "Tier [123]" "Complexity Tier (declare Tier 1, 2, or 3)"
                require "Acceptance Criteria" "Acceptance Criteria"
                require "Allowed scope" "Allowed scope"
                require "Non-goals" "Non-goals"

                # Tier 1 changes no behavior, so it carries no tests and no TDD
                # scenarios. Requiring them of every unit would make the hook
                # wrong for the one tier that legitimately omits them.
                if has "Tier [23]"; then
                    has "Required tests" || has "TDD Scenarios" ||
                        missing="$missing
  - Required tests or TDD Scenarios (mandatory for Tier 2 and Tier 3)"
                fi
                ;;
        esac

        # The standing policy for every Codex task, including corrective passes.
        has "\-m gpt-5\.6-luna" || has "\-\-model gpt-5\.6-luna" ||
            flags="$flags
  - missing: -m gpt-5.6-luna"
        has "model_reasoning_effort=xhigh" ||
            flags="$flags
  - missing: -c model_reasoning_effort=xhigh"
        ;;
    copilot-reply)
        kind="Copilot corrective pass"
        require "Defect:" "Defect:"
        require "Evidence:" "Evidence:"
        require "Required correction:" "Required correction:"
        ;;
    copilot)
        kind="Copilot delegation"
        require "Objective" "Objective"
        require "Tier [123]" "Complexity Tier (declare Tier 1, 2, or 3)"
        require "Acceptance Criteria" "Acceptance Criteria"
        require "Allowed scope" "Allowed scope"
        require "Non-goals" "Non-goals"

        if has "Tier [23]"; then
            has "Required tests" || has "TDD Scenarios" ||
                missing="$missing
  - Required tests or TDD Scenarios (mandatory for Tier 2 and Tier 3)"
        fi
        ;;
esac

# Phrases that only make sense to someone who was in the conversation. The
# worker starts with none of it, so each one is a prompt that cannot be
# executed as written. Kept deliberately narrow: "the above" and "as before"
# are omitted because they legitimately refer to earlier lines of the prompt
# itself, and a gate with false positives is a gate that gets turned off.
for phrase in \
    "as discussed" \
    "as we discussed" \
    "we decided" \
    "per our conversation" \
    "as mentioned earlier" \
    "as I said" \
    "you already know" \
    "先ほど" \
    "さっき" \
    "同上"
do
    has "$phrase" && leaks="$leaks
  - \"$phrase\""
done

[ -z "$missing" ] && [ -z "$leaks" ] && [ -z "$flags" ] && exit 0

reason="Blocked this $kind: the prompt is structurally incomplete.
"
[ -n "$missing" ] && reason="${reason}
Missing required sections:${missing}
"
[ -n "$leaks" ] && reason="${reason}
References to context the worker does not have:${leaks}
The worker starts with no memory of this conversation. State the fact instead
of pointing at it.
"
[ -n "$flags" ] && reason="${reason}
Model or effort flags:${flags}
"
reason="${reason}
Rewrite the prompt and send it again. Do not implement the change yourself,
and do not work around this by inlining the prompt differently."

jq -n --arg r "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $r
  }
}'
