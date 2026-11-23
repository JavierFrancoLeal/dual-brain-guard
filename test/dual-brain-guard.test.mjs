import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  beginTurn,
  classifyToolOutcome,
  createInitialState,
  evaluateCommitGate,
  evaluateStopGate,
  isMutatingGitCommand,
  isRealAuditCliCommand,
  isShellMutation,
  recordMutation,
} from "../src/core.mjs";
import { installDshGuard } from "../src/adapters/dsh.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "src", "cli.mjs");
const MCP = path.join(ROOT, "src", "mcp-server.mjs");

function runCli(args, { input = "", env = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("1. Hardened git detector blocks evasive write commands and allows read-only commands", () => {
  assert.equal(isMutatingGitCommand('git --no-pager commit -m "x"'), true);
  assert.equal(isMutatingGitCommand("git -C /repo push origin main"), true);
  assert.equal(isMutatingGitCommand("git branch -f -D feature"), true);
  assert.equal(isMutatingGitCommand("git remote -v add evil https://x"), true);
  assert.equal(isMutatingGitCommand("git reset --hard HEAD~1"), true);
  assert.equal(isMutatingGitCommand("gh pr merge 42"), true);
  assert.equal(isMutatingGitCommand("git status"), false);
  assert.equal(isMutatingGitCommand("git diff --stat"), false);
  assert.equal(isMutatingGitCommand("git tag -l"), false);
});

test("2. Shell mutation & anti-spoofing audit CLI detectors", () => {
  assert.equal(isShellMutation("sed -i '' 's/a/b/' app.js"), true);
  assert.equal(isShellMutation("echo hi > out.txt"), true);
  assert.equal(isShellMutation("ls -la > /dev/null"), false);
  assert.equal(isRealAuditCliCommand('dsh --profile headless "audit diff"'), true);
  assert.equal(isRealAuditCliCommand('agy --mode plan -p "audit diff"'), true);
  assert.equal(isRealAuditCliCommand('claude -p "review diff"'), true);
  assert.equal(isRealAuditCliCommand("dsh --profile headless --help"), false);
  assert.equal(isRealAuditCliCommand('agy --mode plan -p "audit" &'), false);
});

test("3. Core state machine: edit -> commit blocked -> audit -> commit allowed", () => {
  const st = createInitialState();
  beginTurn(st, 1, "Refactor auth module");
  classifyToolOutcome({ name: "edit_file", arguments: { path: "src/auth.ts" } }, { isError: false }, st);

  assert.equal(evaluateCommitGate(st, "bash", { command: 'git commit -m "auth"' }).decision, "block");
  assert.equal(evaluateCommitGate(st, "bash", { command: 'git commit -m "auth"' }, { isNested: true }).decision, "deny");
  assert.equal(evaluateStopGate(st).decision, "block");

  // Second-brain edit is a MUTATION, never an audit!
  classifyToolOutcome({ name: "antigravity", arguments: { action: "edit" } }, { isError: false, text: "Edited auth.ts" }, st);
  assert.equal(evaluateCommitGate(st, "bash", { command: "git push origin main" }).decision, "block");

  // Failed audit with isError:false refusal text must NOT clear gate
  classifyToolOutcome({ name: "antigravity", arguments: { action: "audit" } }, { isError: false, text: "antigravity failed to launch: ENOENT" }, st);
  assert.equal(evaluateCommitGate(st, "bash", { command: "git push origin main" }).decision, "block");

  // Clean independent audit clears both gates
  classifyToolOutcome({ name: "antigravity", arguments: { action: "audit" } }, { isError: false, text: "status: completed\nPASS" }, st);
  assert.equal(evaluateCommitGate(st, "bash", { command: "git push origin main" }).decision, "allow");
  assert.equal(evaluateStopGate(st).decision, "allow");
});

test("4. Explicit per-turn opt-out resets cleanly on the next turn (never sticky)", () => {
  const st = createInitialState();
  beginTurn(st, 1, "Quick typo fix skip audit");
  recordMutation(st, "edit: README.md");
  assert.equal(evaluateCommitGate(st, "bash", { command: 'git commit -m "typo"' }).decision, "allow");

  beginTurn(st, 2, "Now touch payments.ts");
  recordMutation(st, "edit: payments.ts");
  assert.equal(evaluateCommitGate(st, "bash", { command: 'git commit -m "pay"' }).decision, "block");
});

test("5. CLI Hook Runner blocks unaudited git push (exit 2) and allows after audit-ok (exit 0)", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbg-cli-"));
  const env = { DUAL_BRAIN_STATE_DIR: stateDir, DUAL_BRAIN_SESSION: "test-sess-1" };
  try {
    // Post-tool records Write mutation
    const p1 = runCli(["post-tool"], {
      env,
      input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "app.ts" } }),
    });
    assert.equal(p1.status, 0);

    // Pre-tool blocks git push with exit 2
    const p2 = runCli(["pre-tool"], {
      env,
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push origin main" } }),
    });
    assert.equal(p2.status, 2);
    assert.match(p2.stderr, /DUAL-BRAIN COMMIT\/PUSH GATE/);

    // Stop gate blocks unaudited turn with exit 2
    const p3 = runCli(["stop"], { env, input: JSON.stringify({}) });
    assert.equal(p3.status, 2);
    assert.match(p3.stderr, /DUAL-BRAIN STOP GATE/);

    // Record independent audit via post-tool shell CLI
    const p4 = runCli(["post-tool"], {
      env,
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: 'claude -p "audit git diff"' } }),
    });
    assert.equal(p4.status, 0);

    // Pre-tool & stop now pass with exit 0!
    const p5 = runCli(["pre-tool"], {
      env,
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push origin main" } }),
    });
    assert.equal(p5.status, 0);
    const p6 = runCli(["stop"], { env, input: JSON.stringify({}) });
    assert.equal(p6.status, 0);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("6. Stdio MCP server responds to initialize, tools/list, and enforces commit gate over JSON-RPC", async () => {
  const child = spawn(process.execPath, [MCP], { stdio: ["pipe", "pipe", "pipe"] });
  const responses = [];
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) responses.push(JSON.parse(line));
    }
  });

  const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dual_brain_record_mutation", arguments: { summary: "edit core.mjs" } } });
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "dual_brain_check_commit", arguments: { command: "git push origin main" } } });
  send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "dual_brain_record_audit", arguments: { auditor: "deepseek-v4", passed: true } } });
  send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "dual_brain_check_commit", arguments: { command: "git push origin main" } } });
  child.stdin.end();

  await new Promise((resolve) => child.on("close", resolve));
  assert.equal(responses.length, 6);
  assert.equal(responses[0].result.serverInfo.name, "dual-brain-guard");
  assert.equal(responses[1].result.tools.length, 4);
  const blocked = JSON.parse(responses[3].result.content[0].text);
  assert.equal(blocked.decision, "block");
  const allowed = JSON.parse(responses[5].result.content[0].text);
  assert.equal(allowed.decision, "allow");
});

test("7. DSH host adapter enforces WeakMap isolation and anti-recursion", async () => {
  const listeners = new Map();
  const steers = [];
  const agent = {
    session: { header: { origin: "user" } },
    ctx: {
      on(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
        return () => {};
      },
    },
    steer(msg) { steers.push(msg); },
  };
  const dispose = installDshGuard(agent, { env: {} });
  for (const fn of listeners.get("tools/result") || []) {
    fn({ name: "write", arguments: { path: "index.js" } }, { isError: false });
  }
  for (const fn of listeners.get("agent/turn-stopping") || []) {
    fn({ agent });
  }
  assert.equal(steers.length, 1);
  assert.match(steers[0].content[0].text, /DUAL-BRAIN STOP GATE/);
  dispose();

  // Anti-recursion yields immediately when DUAL_BRAIN_ORIGIN=auditor
  const recListeners = new Map();
  installDshGuard({ ctx: { on(ev, fn) { recListeners.set(ev, fn); } } }, { env: { DUAL_BRAIN_ORIGIN: "auditor" } });
  assert.equal(recListeners.size, 0);
});

test("8. P0 regressions: MultiEdit, Gemini replace/run_shell_command, failed Bash audit, negated bypass, stop-counter reset", () => {
  // MultiEdit & Gemini replace tracked as mutations
  const st = createInitialState();
  beginTurn(st, 1, "Please do not skip audit on this refactor");
  assert.equal(st.bypassRequested, false, "'do not skip audit' must NOT trigger bypass");

  classifyToolOutcome({ name: "MultiEdit", arguments: { path: "a.ts" } }, { exit_code: 0 }, st);
  assert.equal(st.lastMutationSeq, 1);

  // Failed Bash audit (exit_code: 1 without isError) must NOT clear gate
  classifyToolOutcome(
    { name: "run_shell_command", arguments: { command: 'claude -p "audit diff"' } },
    { exit_code: 1, stderr: "timeout" },
    st,
  );
  assert.equal(st.lastAuditSeq, 0);
  assert.equal(st.auditFailedCount, 1);
  assert.equal(evaluateCommitGate(st, "run_shell_command", { command: "git push origin main" }).decision, "block");

  // Stop gate blocks twice, then a NEW mutation (Gemini replace) resets forcedCountInTurn!
  assert.equal(evaluateStopGate(st).decision, "block");
  assert.equal(evaluateStopGate(st).decision, "block");
  assert.equal(evaluateStopGate(st).decision, "allow"); // capped at 2 for same mutation
  classifyToolOutcome({ name: "replace", arguments: { path: "b.ts" } }, { exit_code: 0 }, st);
  assert.equal(evaluateStopGate(st).decision, "block", "New mutation must reset stop counter");
});
