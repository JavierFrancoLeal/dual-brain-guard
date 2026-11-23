#!/usr/bin/env node
/**
 * Dual-Brain Guard — Zero-Dependency Stdio MCP Server (Advisory State & Check Interface)
 * Exposes 4 tools to any MCP-compatible host (Claude Code, Cursor, Gemini CLI, Antigravity, DSH):
 *   - dual_brain_status
 *   - dual_brain_record_mutation
 *   - dual_brain_record_audit
 *   - dual_brain_check_commit
 * Note: MCP tools are advisory; use the CLI hook adapters or DSH host adapter for mechanical interception.
 */
import readline from "node:readline";
import {
  createInitialState,
  evaluateCommitGate,
  evaluateStopGate,
  recordAudit,
  recordMutation,
} from "./core.mjs";

const state = createInitialState();

const TOOLS = [
  {
    name: "dual_brain_status",
    description: "Inspect the current Dual-Brain Guard state (mutation sequence, last independent audit sequence, and stop-gate readiness).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "dual_brain_record_mutation",
    description: "Record a substantive code/file mutation so the guard requires a subsequent independent cross-audit.",
    inputSchema: {
      type: "object",
      properties: { summary: { type: "string", description: "Short summary of the mutation" } },
      required: ["summary"],
    },
  },
  {
    name: "dual_brain_record_audit",
    description: "Record a completed independent second-brain audit (clears commit and stop gates until the next mutation).",
    inputSchema: {
      type: "object",
      properties: {
        auditor: { type: "string", description: "Independent auditor model or tool name (e.g. deepseek-v4, gemini-pro, claude-opus)" },
        passed: { type: "boolean", description: "Whether the audit passed without unresolved blockers" },
      },
      required: ["auditor"],
    },
  },
  {
    name: "dual_brain_check_commit",
    description: "Check whether a git command is allowed under the current Dual-Brain Guard state.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string", description: "The git shell command to evaluate" } },
      required: ["command"],
    },
  },
];

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function handleRequest(req) {
  if (!req || typeof req !== "object" || Array.isArray(req)) {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
  }
  const { id, method, params } = req;
  if (method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "dual-brain-guard", version: "1.1.1" },
      },
    });
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    let payload;
    if (name === "dual_brain_status") {
      payload = { ...state, stopGatePreview: evaluateStopGate({ ...state }) };
    } else if (name === "dual_brain_record_mutation") {
      recordMutation(state, args.summary || "mutation");
      payload = { recorded: true, lastMutationSeq: state.lastMutationSeq };
    } else if (name === "dual_brain_record_audit") {
      recordAudit(state, args.auditor || "second-brain", { failed: args.passed === false });
      payload = { recorded: true, lastAuditSeq: state.lastAuditSeq, auditFailedCount: state.auditFailedCount };
    } else if (name === "dual_brain_check_commit") {
      payload = evaluateCommitGate(state, "bash", { command: args.command || "" });
    } else {
      return send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    }
    return send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
    });
  }
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    handleRequest(JSON.parse(trimmed));
  } catch (err) {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse error: ${err.message}` } });
  }
});
