# claude-orchestrator-configs

Claude Code configs for using Claude as an orchestrator that delegates bounded
implementation work to another coding agent — Codex CLI or GitHub Copilot CLI —
instead of implementing everything itself.

## Layout

```text
skills/
  codex-delegate/              Global skill — delegate one task to Codex CLI
  copilot-delegate/            Global skill — delegate one task to Copilot CLI

opus5-codex-orchestrator/
  CLAUDE.md                    Always-on policy: delegate implementation to Codex CLI

opus5-copilot-orchestrator/
  CLAUDE.md                    Always-on policy: delegate implementation to Copilot CLI
  README.md                    Setup and usage
  bridge/                      MCP stdio bridge wrapping the Copilot CLI
```

## Two delegation modes

### Global skills

`skills/*-delegate` are global Claude Code skills, typically symlinked from:

```text
~/.claude/skills/
```

They remain dormant until delegation is explicitly requested, for example:

```text
Codexに投げて
Copilotに投げて
```

Use these when Claude normally handles implementation itself and you only want
to delegate individual tasks.

### Project orchestrators

`opus5-*-orchestrator/CLAUDE.md` defines a project-scoped, always-on delegation
policy.

When Claude Code is started inside one of these projects, Claude acts as the
orchestrator for the whole session:

```text
Claude Opus
    ↓
task definition / scope / acceptance criteria
    ↓
Codex CLI or Copilot CLI
    ↓
implementation + tests
    ↓
Claude review / verification
```

Use this mode when the project is delegation-first by design.

## Workers

### Codex CLI

Codex is invoked directly from Claude through the shell using non-interactive
commands such as:

```bash
codex exec --sandbox workspace-write --json ...
```

Claude owns task definition, model selection, scope control, diff review, and
independent verification.

Codex owns implementation, source edits, tests, and corrective passes.

No Codex MCP server is required.

The delegation skill can select different Codex models depending on the task,
with Terra as the default implementation worker and escalation to stronger
models only when justified by an observed failure.

### Copilot CLI

Copilot CLI is used for environments where GitHub Copilot is the preferred
worker.

Unlike the Codex setup in this repository, Copilot is exposed to Claude through
the custom MCP bridge under:

```text
opus5-copilot-orchestrator/bridge/
```

See that project's README for setup details.

## Usage

To copy one orchestrator configuration into another project, run the setup
script from that project's root. The script accepts `codex` or `copilot` and
copies the matching `CLAUDE.md`, the common skills, and only the selected
agent's delegation skill into `.agents/skills`:

```bash
/path/to/claude-orchestrator-configs/setup-project.sh codex
# or
/path/to/claude-orchestrator-configs/setup-project.sh copilot
```

The destination is the current directory. Existing files with the same names
are overwritten. `.agents/skills` is the project-local skills location shared
by Codex and Copilot CLI.

For occasional delegation, install or symlink the desired skill into Claude
Code's global skills directory and explicitly request delegation.

For delegation-first development, start Claude Code inside one of the
`opus5-*-orchestrator` projects.

The two mechanisms are intentionally separate:

```text
global skill
  -> explicit, one-task delegation

project CLAUDE.md
  -> always-on orchestration
```

A delegation rule only applies where it is configured. Installing the global
skill does not make every project delegation-first.
