#!/bin/sh

set -eu

usage() {
    cat <<'EOF'
Usage: setup-project.sh codex|copilot

Copy the selected orchestrator's CLAUDE.md and the applicable skills into
the current project directory under .agents/skills.
EOF
}

if [ "$#" -ne 1 ]; then
    usage >&2
    exit 2
fi

agent="$1"
case "$agent" in
    codex|copilot)
        ;;
    *)
        echo "Error: agent must be 'codex' or 'copilot'." >&2
        usage >&2
        exit 2
        ;;
esac

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
destination_dir=$(pwd -P)
source_claude="$script_dir/opus5-$agent-orchestrator/CLAUDE.md"
destination_claude="$destination_dir/CLAUDE.md"
source_skills="$script_dir/skills"
destination_skills="$destination_dir/.agents/skills"

if [ ! -f "$source_claude" ]; then
    echo "Error: source file not found: $source_claude" >&2
    exit 1
fi

if [ ! -d "$source_skills" ]; then
    echo "Error: source directory not found: $source_skills" >&2
    exit 1
fi

cp "$source_claude" "$destination_claude"
echo "Copied CLAUDE.md for $agent."

mkdir -p "$destination_skills"

for skill_dir in "$source_skills"/*; do
    [ -d "$skill_dir" ] || continue

    skill_name=$(basename "$skill_dir")
    case "$agent:$skill_name" in
        codex:copilot-delegate|copilot:codex-delegate)
            continue
            ;;
    esac

    destination_skill="$destination_skills/$skill_name"
    if [ "$skill_dir" = "$destination_skill" ]; then
        echo "Skipped existing skill: .agents/skills/$skill_name"
        continue
    fi

    cp -R "$skill_dir" "$destination_skills/"
    echo "Copied skill: .agents/skills/$skill_name"
done

echo "Setup complete in: $destination_dir"
