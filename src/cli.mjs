#!/usr/bin/env node
/**
 * Dual-Brain Guard — Standalone CLI & Hook Runner (Zero Dependencies)
 * Works with Claude Code, Gemini CLI, Cursor, Antigravity, and shell wrappers.
 *
 * Commands:
 *   dual-brain-guard pre-tool   (reads hook JSON on stdin; exits 2 to block unaudited git commit/push)
 *   dual-brain-guard post-tool  (reads hook JSON on stdin; records mutations & second-brain audits)
 *   dual-brain-guard stop       (reads hook JSON on stdin; exits 2 to block unaudited turn completion)
 *   dual-brain-guard audit-ok --auditor <name>   (manually record an external audit pass)
 *   dual-brain-guard status     (prints current session state JSON)
 *   dual-brain-guard reset      (clears session state)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  beginTurn,
  classifyToolOutcome,
  createInitialState,
  evaluateCommitGate,
  evaluateStopGate,
  recordAudit,
} from "./core.mjs";

function getStatePath(sessionId) {
  const dir = process.env.DUAL_BRAIN_STATE_DIR || path.join(os.tmpdir(), "dual-brain-guard");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const hash = crypto.createHash("sha256").update(String(sessionId || process.cwd())).digest("hex").slice(0, 16);
  return path.join(dir, `session-${hash}.json`);
}

function loadState(stateFile) {
  try {
    return { ...createInitialState(), ...JSON.parse(fs.readFileSync(stateFile, "utf8")) };
  } catch {
    return createInitialState();
  }
}

function saveState(stateFile, state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
}

function readStdinJson() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const args = process.argv.slice(2);
const cmd = args[0] || "status";

// Anti-recursion: yield cleanly when invoked inside an auditor subprocess
if (process.env.DUAL_BRAIN_ORIGIN === "auditor" || process.env.DUAL_BRAIN_ORIGIN === "antigravity") {
  process.exit(0);
}

const payload = ["pre-tool", "post-tool", "stop"].includes(cmd) ? readStdinJson() : {};
const sessionIdx = args.indexOf("--session");
const sessionId =
  (sessionIdx !== -1 && args[sessionIdx + 1]) ||
  payload.session_id ||
  payload.conversation_id ||
  process.env.DUAL_BRAIN_SESSION ||
  process.cwd();

const stateFile = getStatePath(sessionId);
const state = loadState(stateFile);

if (cmd === "reset") {
  try { fs.unlinkSync(stateFile); } catch {}
  console.log("Dual-Brain Guard state reset.");
  process.exit(0);
}

if (cmd === "status") {
  console.log(JSON.stringify({ sessionId, stateFile, ...state }, null, 2));
  process.exit(0);
}

if (cmd === "audit-ok") {
  if (process.env.DUAL_BRAIN_TRUSTED_AUDITOR !== "1") {
    process.stderr.write("Refused: audit-ok requires DUAL_BRAIN_TRUSTED_AUDITOR=1 (host-only trusted wrapper).\n");
    process.exit(1);
  }
  const audIdx = args.indexOf("--auditor");
  const auditor = audIdx !== -1 && args[audIdx + 1] ? args[audIdx + 1] : "external-auditor";
  recordAudit(state, auditor, { failed: false });
  saveState(stateFile, state);
  console.log(JSON.stringify({ status: "recorded", auditor, lastAuditSeq: state.lastAuditSeq }));
  process.exit(0);
}

if (cmd === "pre-tool") {
  if (payload.user_prompt || payload.turn != null) {
    beginTurn(state, payload.turn ?? state.lastTurnSeen, payload.user_prompt || "");
  }
  const toolName = payload.tool_name || payload.name || "";
  const toolInput = payload.tool_input || payload.arguments || {};
  const gate = evaluateCommitGate(state, toolName, toolInput, { isNested: Boolean(payload.parent) });
  saveState(stateFile, state);
  if (gate.decision !== "allow") {
    process.stderr.write(`${gate.reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (cmd === "post-tool") {
  if (payload.user_prompt || payload.turn != null) {
    beginTurn(state, payload.turn ?? state.lastTurnSeen, payload.user_prompt || "");
  }
  const toolName = payload.tool_name || payload.name || "";
  const toolInput = payload.tool_input || payload.arguments || {};
  const toolResult = payload.tool_response || payload.result || { isError: Boolean(payload.is_error), text: payload.output || "" };
  classifyToolOutcome({ name: toolName, arguments: toolInput }, toolResult, state);
  saveState(stateFile, state);
  process.exit(0);
}

if (cmd === "stop") {
  if (payload.user_prompt || payload.turn != null) {
    beginTurn(state, payload.turn ?? state.lastTurnSeen, payload.user_prompt || "");
  }
  const gate = evaluateStopGate(state);
  saveState(stateFile, state);
  if (gate.decision !== "allow") {
    process.stderr.write(`${gate.reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

console.error(`Unknown command: ${cmd}. Use: pre-tool | post-tool | stop | audit-ok | status | reset`);
process.exit(1);
