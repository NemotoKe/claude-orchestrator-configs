# claude-orchestrator-configs

Claude Code configs for using Claude as an orchestrator that delegates
bounded implementation work to another coding agent (Codex or GitHub
Copilot CLI), instead of writing every line itself.

## Layout

```
skills/
  codex-delegate/      Global skill — delegate to Codex on request
  copilot-delegate/     Global skill — delegate to Copilot CLI on request
opus5-codex-orchestrator/
  CLAUDE.md             Always-on policy: this project always delegates to Codex
opus5-copilot-orchestrator/
  CLAUDE.md, README.md  Same, but worker is Copilot CLI via a custom MCP bridge
  bridge/                Zero-dependency MCP stdio server wrapping the Copilot CLI
```

## Two different mechanisms, on purpose

**`skills/*-delegate`** are global Claude Code skills (symlinked from
`~/.claude/skills/`). They stay dormant until you explicitly say "Codexに
投げて" / "Copilotに投げて" — in any project, for one task at a time. Use
these when you normally write code yourself and only occasionally want to
hand something off.

**`opus5-*-orchestrator/CLAUDE.md`** are project-scoped, always-on policies.
Working inside one of those directories puts Claude Code into orchestrator
mode for the whole session — every implementation goes through the worker.
Use this shape when a project is delegation-first from the start.

## Which worker

- **Codex** — requires a ChatGPT subscription or OpenAI usage-based billing.
  MCP server is official and built into the Codex CLI (`codex mcp-server`).
- **Copilot CLI** — for environments where neither Codex payment path is
  available but GitHub Copilot is. Copilot CLI has no MCP server mode of its
  own, so `opus5-copilot-orchestrator/bridge/` wraps it in one. See that
  project's README for setup, and note the Copilot CLI flag names in
  `bridge/config.json` are unverified against the real binary — expect to
  adjust that file once, on the target machine.

## Global MCP registration

Both workers are registered at Claude Code's user (global) scope, so the
`codex` / `copilot` tools are available from any project — not just the
directories above:

```bash
claude mcp list
```

The always-on delegation policy in `opus5-*-orchestrator/CLAUDE.md` only
applies inside those specific directories, though — elsewhere, the tools sit
idle until a `*-delegate` skill invokes them.
