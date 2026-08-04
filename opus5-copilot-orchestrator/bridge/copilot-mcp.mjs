#!/usr/bin/env node
// Zero-dependency MCP stdio server that exposes the GitHub Copilot CLI as a
// delegation target, so an orchestrating agent can hand it bounded coding tasks.
//
// Everything environment-specific (binary name, flag spellings, model slugs)
// lives in config.json — this file should not need editing to adapt.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const configPath = process.env.COPILOT_MCP_CONFIG ?? join(here, "config.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const SERVER_INFO = { name: "copilot-mcp", title: "Copilot CLI", version: "0.1.0" };
const PROTOCOL_VERSION = "2025-06-18";

// sessionId -> { cwd, model } so a reply lands on the same worker thread.
const sessions = new Map();

// Worker runs are serialized: two Copilot processes editing one working tree
// corrupt each other's changes, and a reply must observe the session its parent
// call registered. Concurrent tool calls queue instead of racing.
let queue = Promise.resolve();
function serialize(fn) {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => {},
    () => {},
  );
  return run;
}

function template(parts, vars) {
  return parts.map((p) => p.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ""));
}

function findGitRoot(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveModel(alias) {
  if (!alias) return config.models[config.defaultModel] ?? config.defaultModel;
  return config.models[alias] ?? alias; // allow raw slugs to pass through
}

function buildInvocation({ prompt, model, effort, sessionId, allowAllTools }) {
  const argv = [];
  let finalPrompt = prompt;

  const eff = config.effort ?? { mode: "off" };
  if (eff.mode === "prompt" && effort) {
    finalPrompt = template([eff.promptPrefix], { effort })[0] + finalPrompt;
  }

  if (sessionId && config.args.resume?.length) {
    argv.push(...template(config.args.resume, { sessionId }));
  }
  if (model && config.args.model?.length) {
    argv.push(...template(config.args.model, { model }));
  }
  if (eff.mode === "flag" && effort && eff.flag?.length) {
    argv.push(...template(eff.flag, { effort }));
  }
  if (allowAllTools && config.args.allowAllTools?.length) {
    argv.push(...config.args.allowAllTools);
  }
  argv.push(...(config.args.extra ?? []));
  argv.push(...template(config.args.prompt, { prompt: finalPrompt }));

  return argv;
}

function runCopilot(argv, cwd) {
  return new Promise((resolveRun) => {
    let child;
    try {
      child = spawn(config.command, argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      return resolveRun({ code: -1, stdout: "", stderr: String(err) });
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, config.timeoutMs ?? 1_800_000);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolveRun({ code: -1, stdout, stderr: `${stderr}\nspawn error: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr, timedOut });
    });
  });
}

function extractSessionId(text) {
  if (!config.sessionIdPattern) return null;
  const m = new RegExp(config.sessionIdPattern, "i").exec(text);
  return m ? m[1] : null;
}

async function callCopilot(args, isReply) {
  const cwd = resolve(args.cwd ?? process.cwd());

  if (config.requireGitRepo && !findGitRoot(cwd)) {
    return {
      isError: true,
      text:
        `Refusing to run: ${cwd} is not inside a git repository.\n` +
        `The worker edits files directly, so it is restricted to directories where ` +
        `changes can be reviewed and reverted with git. Run \`git init\`, pass a ` +
        `different \`cwd\`, or set "requireGitRepo": false in config.json.`,
    };
  }

  const sessionId = isReply ? args.sessionId : undefined;
  if (isReply && !sessions.has(sessionId)) {
    // Not fatal — the CLI may still resume a session this process didn't start.
    sessions.set(sessionId, { cwd, model: null });
  }

  const model = isReply
    ? sessions.get(sessionId)?.model ?? resolveModel(args.model)
    : resolveModel(args.model);

  const effort = args.effort ?? config.effort?.default;
  if (effort && config.effort?.allowed && !config.effort.allowed.includes(effort)) {
    return {
      isError: true,
      text: `Unknown effort "${effort}". Allowed: ${config.effort.allowed.join(", ")}`,
    };
  }

  const allowAllTools = args.allowAllTools ?? config.defaultAllowAllTools ?? false;
  const argv = buildInvocation({ prompt: args.prompt, model, effort, sessionId, allowAllTools });

  const { code, stdout, stderr, timedOut } = await runCopilot(argv, cwd);

  const newSessionId = extractSessionId(stdout) ?? sessionId ?? null;
  if (newSessionId) sessions.set(newSessionId, { cwd, model });

  const header = [
    `command: ${config.command} ${argv.join(" ")}`,
    `cwd: ${cwd}`,
    `model: ${model}`,
    effort ? `effort: ${effort}` : null,
    newSessionId ? `sessionId: ${newSessionId}` : null,
    `exit: ${timedOut ? "timeout" : code}`,
  ]
    .filter(Boolean)
    .join("\n");

  const body = [stdout.trim(), stderr.trim() ? `--- stderr ---\n${stderr.trim()}` : ""]
    .filter(Boolean)
    .join("\n\n");

  return {
    isError: timedOut || code !== 0,
    text: `${header}\n\n${body || "(no output)"}`,
  };
}

const TOOLS = [
  {
    name: "copilot",
    description:
      "Delegate a bounded implementation task to the Copilot CLI worker. Provide a " +
      "self-contained engineering task: objective, background, acceptance criteria, " +
      "allowed scope, and non-goals. Returns the worker's report and a sessionId for " +
      "follow-up work.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The full task specification." },
        model: {
          type: "string",
          description:
            "Model alias: 'terra' (balanced default, everyday implementation), " +
            "'luna' (fast/cheap — mechanical edits, review, verification), " +
            "'sol' (frontier — hardest problems). A raw model slug also works.",
        },
        effort: {
          type: "string",
          description: "Reasoning depth: low | medium | high | xhigh | max.",
        },
        cwd: { type: "string", description: "Working directory. Must be inside a git repository." },
        allowAllTools: {
          type: "boolean",
          description: "Let the worker use all tools without prompting. Defaults to config.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "copilot_reply",
    description:
      "Continue an existing Copilot worker session — e.g. to delegate corrective work " +
      "after reviewing a diff. Use the sessionId returned by a prior `copilot` call.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session id from a previous call." },
        prompt: { type: "string", description: "The follow-up instruction." },
        cwd: { type: "string", description: "Working directory. Must be inside a git repository." },
      },
      required: ["sessionId", "prompt"],
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return; // notifications carry no id and expect no response

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, { tools: TOOLS });

    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (name !== "copilot" && name !== "copilot_reply") {
        return replyError(id, -32602, `Unknown tool: ${name}`);
      }
      try {
        const { isError, text } = await serialize(() =>
          callCopilot(args, name === "copilot_reply"),
        );
        return reply(id, { content: [{ type: "text", text }], isError });
      } catch (err) {
        return reply(id, {
          content: [{ type: "text", text: `Bridge error: ${err?.stack ?? err}` }],
          isError: true,
        });
      }
    }

    default:
      if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // ignore malformed frames rather than killing the server
    }
    handle(msg).catch((err) => {
      if (msg.id !== undefined) replyError(msg.id, -32603, String(err));
    });
  }
});
process.stdin.on("end", () => process.exit(0));
