/**
 * Dual-Brain Guard — Harness-Agnostic Core State Machine & Detectors (Zero Dependencies)
 * Mechanically enforces independent cross-model / cross-substrate verification before
 * mutating git commands (commit/push/merge/reset) and before closing turns with unaudited edits.
 */

export const BYPASS_RE =
  /(?<!\b(?:do\s+not|don't|never|no)\s+)\b(skip\s+(?:audit|dual-?brain|second-?brain|verifier)|no\s+audit|solo\s+mode|sin\s+(?:dsh|antigravity|gemini)|modo\s+solo)\b/i;

export const FILE_WRITE_TOOLS = new Set([
  "write",
  "edit",
  "replace",
  "apply_patch",
  "write_file",
  "edit_file",
  "multiedit",
  "multi_edit",
  "notebook_edit",
  "create_file",
  "replace_file_content",
  "multi_replace_file_content",
]);

export const STR_REPLACE_TOOLS = new Set([
  "str_replace_editor",
  "str_replace_based_edit_tool",
]);

export const DELEGATION_TOOLS = new Set([
  "subagent",
  "subagent_fork",
  "invoke_subagent",
  "workflow",
  "run_workflow",
  "send_message",
]);

export const SHELL_TOOLS = new Set([
  "bash",
  "shell",
  "run_command",
  "run_shell_command",
  "terminal_send",
  "pwsh",
  "execute_command",
]);

// Hardened git global options & write/read-only classifiers
const GIT_GLOBAL_OPTS =
  "(?:\\s+(?:(?:-C|--git-dir|--work-tree|-c)\\s+\\S+|--(?:git-dir|work-tree|namespace)=\\S+|--no-pager|-P|--paginate|--bare|--literal-pathspecs|--no-replace-objects))*";

export const GIT_WRITE_RE = new RegExp(
  `(?:^|[\\s;&|(])(?:git${GIT_GLOBAL_OPTS}\\s+(?:commit|push|merge|rebase|cherry-pick|am|revert|reset|rm|mv|clean|apply|stash\\s+(?:push|pop|apply|drop|clear)|branch(?:\\s+-[A-Za-z-]+)*\\s+(?:-[dDmMcC]|--delete|--move|--copy)|remote(?:\\s+-v)*\\s+(?:add|remove|rm|rename|set-url|prune)|worktree\\s+(?:add|remove|prune)|fetch\\s+[^;&|\\n]*--prune|tag(?!\\s+(?:-l|--list)\\b)(?:\\s+\\S+))\\b|gh\\s+pr\\s+merge\\b)`,
  "i",
);

export const GIT_READONLY_ONLY_RE = new RegExp(
  `^\\s*git${GIT_GLOBAL_OPTS}\\s+(?:status|diff|log|show|rev-parse|ls-files|tag(?:\\s+(?:-l|--list)\\b[^;&|]*)?|branch(?:\\s+(?:-a|-r|-v|-vv|--list|--show-current)\\b)*|remote(?:\\s+-v)?)\\s*$`,
  "i",
);

export const SHELL_MUTATION_RE =
  /(?:^|[\s;&|])(mv\s+|cp\s+|rm\s+|mkdir\s+|touch\s+|ln\s+|sed\s+-i|perl\s+-i|tee\s+|npm\s+install|pip3?\s+install|curl\s+[^;&|\n]*(?:-o|--output)\s+|wget\s+[^;&|\n]*-O\s+|git(?:\s+(?:--?[A-Za-z0-9-]+(?:=\S+)?|-C\s+\S+|-c\s+\S+))*\s+(?:add|commit|push|merge|rebase|cherry-pick|am|revert|reset|rm|mv|clean|apply|clone|checkout\s+-b|branch(?:\s+-[A-Za-z-]+)*\s+(?:-[dDmMcC]|--delete|--move|--copy)|remote(?:\s+-v)*\s+(?:add|remove|rm|rename|set-url|prune)|tag(?!\s+(?:-l|--list)\b)(?:\s+\S+)))|(?<![0-9&])>{1,2}(?!\s*&)(?!\s*\/dev\/null\b)/i;

// Generic second-brain CLI audit detectors (supports dsh, agy, claude, codex, gemini, or custom regex)
const AUDIT_CLI_NOOP_RE = /(?:^|\s)(?:--help|-h|--version|-V)\b/;
const SHELL_BG_END_RE = /(?:^|[^>&])&\s*$/;
const DEFAULT_AUDIT_CLI_RE =
  /(?:^|(?:&&|\|\||[;|\n(])\s*)(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*)(?:(?:nohup|time|command|\/usr\/bin\/env|env)\s+)*(?:(?:(?:\/|~\/)[^\s;&|]*\/)?(dsh|agy|codex|claude|gemini))\s+([^;&|\n]+)/;

export const AUDIT_FAILURE_TEXT_RE =
  /(?:^\s*(?:antigravity|dsh|auditor)(?::|\s+(?:edit|audit|plan|models))?\s+(?:failed\b|refused\b|requires\b|unknown\s+action\b)|(?:^|\n)status:\s*(?:error|failed|exit_[1-9]\d*)\b)/i;

export const MAX_STEERS_PER_TURN = 2;
export const MAX_FAILED_AUDITS_FAILSAFE = 2;

export function createInitialState() {
  return {
    seq: 0,
    lastMutationSeq: 0,
    lastMutationSummary: "",
    lastAuditSeq: 0,
    lastAuditAuditor: "",
    auditFailedCount: 0,
    bypassRequested: false,
    lastTurnSeen: -1,
    forcedCountInTurn: 0,
  };
}

export function isMutatingGitCommand(cmd) {
  if (!cmd || GIT_READONLY_ONLY_RE.test(cmd)) return false;
  return GIT_WRITE_RE.test(cmd);
}

export function isShellMutation(cmd) {
  if (!cmd) return false;
  return SHELL_MUTATION_RE.test(cmd);
}

export function isAuditFailureText(text) {
  if (!text || !String(text).trim()) return true;
  return AUDIT_FAILURE_TEXT_RE.test(String(text));
}

export function isRealAuditCliCommand(cmd, customAuditRe = null) {
  if (!cmd || SHELL_BG_END_RE.test(cmd.trim())) return false;
  if (customAuditRe) {
    return customAuditRe.test(cmd) && !AUDIT_CLI_NOOP_RE.test(cmd);
  }
  const m = DEFAULT_AUDIT_CLI_RE.exec(cmd);
  if (!m) return false;
  const after = cmd.slice(m.index + m[0].length);
  if (after.startsWith("&") && !after.startsWith("&&") && !/>$/.test(m[0])) return false;
  const bin = m[1];
  const args = m[2] || "";
  if (AUDIT_CLI_NOOP_RE.test(args)) return false;
  if (bin === "agy") {
    return /(?:^|\s)--mode(?:=|\s+)plan\b/.test(args) && /(?:^|\s)(?:-p|--print|--prompt)\b/.test(args);
  }
  if (bin === "dsh") {
    return /(?:^|\s)--profile(?:=|\s+)headless\b/.test(args);
  }
  if (bin === "claude" || bin === "gemini" || bin === "codex") {
    return /(?:^|\s)(?:-p|--print|--prompt|exec)\b/.test(args);
  }
  return false;
}

export function extractShellCommand(toolName, args) {
  if (!args || typeof args !== "object") return "";
  if (String(toolName).toLowerCase() === "terminal_send") {
    return String(args.text ?? args.input ?? args.command ?? "");
  }
  return String(args.command ?? args.cmd ?? args.CommandLine ?? args.script ?? "");
}

export function beginTurn(state, turn, userText = "") {
  const t = Number(turn);
  if (Number.isFinite(t) && t !== state.lastTurnSeen) {
    state.lastTurnSeen = t;
    state.forcedCountInTurn = 0;
    state.bypassRequested = BYPASS_RE.test(String(userText || ""));
  } else if (userText && BYPASS_RE.test(String(userText))) {
    state.bypassRequested = true;
  }
  return state;
}

export function recordMutation(state, summary) {
  state.seq += 1;
  state.lastMutationSeq = state.seq;
  state.lastMutationSummary = String(summary || `seq ${state.seq}`).slice(0, 120);
  state.forcedCountInTurn = 0;
  return state;
}

export function isToolResultFailed(result) {
  if (!result || typeof result !== "object") return false;
  if (result.isError === true || result.is_error === true || result.interrupted === true) return true;
  const code = result.exit_code ?? result.exitCode ?? result.returnCode ?? result.return_code ?? result.status;
  if (typeof code === "number" && code !== 0) return true;
  if (result.error && typeof result.error === "object") return true;
  return false;
}

export function recordAudit(state, auditor, { failed = false } = {}) {
  if (failed) {
    state.auditFailedCount += 1;
    return state;
  }
  state.seq += 1;
  state.lastAuditSeq = state.seq;
  state.lastAuditAuditor = String(auditor || "second-brain");
  state.auditFailedCount = 0;
  return state;
}

export function classifyToolOutcome(exec, result, state, options = {}) {
  const toolName = String(exec?.name || "").toLowerCase();
  const args = exec?.arguments && typeof exec.arguments === "object" ? exec.arguments : {};
  const isError = isToolResultFailed(result);
  const text = typeof result?.text === "string"
    ? result.text
    : String(result?.stdout ?? result?.output ?? result?.value?.text ?? result?.value ?? "");

  // 1. Explicit cross-audit tool (e.g., dual_brain_record_audit, antigravity)
  if (toolName === "antigravity" || toolName === "dual_brain_record_audit") {
    const action = String(args.action || "audit").toLowerCase();
    const failed = isError || isAuditFailureText(text);
    if (action === "edit") {
      // Editing via a second brain is still a MUTATION, never an audit!
      if (!failed) recordMutation(state, `${toolName}(edit)`);
      return state;
    }
    if (action === "audit" || toolName === "dual_brain_record_audit") {
      recordAudit(state, args.auditor || toolName, { failed });
      return state;
    }
    return state;
  }

  // 2. Shell tools (check failed audit CLI explicitly before ignoring failed non-audit tools)
  if (SHELL_TOOLS.has(toolName)) {
    const cmd = extractShellCommand(toolName, args);
    if (isRealAuditCliCommand(cmd, options.auditCliRe || null)) {
      const failed = isError || (text ? isAuditFailureText(text) : false);
      recordAudit(state, `cli:${cmd.trim().split(/\s+/)[0]}`, { failed });
      return state;
    }
    if (isError) return state;
    if (isShellMutation(cmd)) {
      recordMutation(state, `${toolName}: ${cmd.slice(0, 80)}`);
    }
    return state;
  }

  // Failed non-audit tool calls did not mutate state
  if (isError) return state;

  // 3. First-class file write tools
  if (FILE_WRITE_TOOLS.has(toolName)) {
    const target = String(args.file_path ?? args.path ?? args.Path ?? args.TargetFile ?? "");
    recordMutation(state, target ? `${toolName}: ${target}` : toolName);
    return state;
  }

  // 4. str_replace_editor (ignore read-only view)
  if (STR_REPLACE_TOOLS.has(toolName)) {
    const subcmd = String(args.command || "").toLowerCase();
    if (subcmd !== "view") {
      recordMutation(state, `${toolName}(${subcmd || "edit"}): ${String(args.path || "")}`);
    }
    return state;
  }

  // 5. Delegation tools
  if (DELEGATION_TOOLS.has(toolName)) {
    recordMutation(state, `${toolName}: ${String(args.role || args.description || args.task || "delegated").slice(0, 60)}`);
  }
  return state;
}

export function evaluateCommitGate(state, toolName, args, { isNested = false } = {}) {
  const lower = String(toolName || "").toLowerCase();
  if (!SHELL_TOOLS.has(lower) || state.bypassRequested) {
    return { decision: "allow" };
  }
  const cmd = extractShellCommand(lower, args);
  if (!isMutatingGitCommand(cmd)) {
    return { decision: "allow" };
  }
  const unaudited = state.lastAuditSeq === 0 || state.lastMutationSeq > state.lastAuditSeq;
  if (!unaudited) {
    return { decision: "allow" };
  }
  const reason =
    `[DUAL-BRAIN COMMIT/PUSH GATE] Mutating git command blocked without a subsequent independent cross-audit ` +
    `(lastMutationSeq=${state.lastMutationSeq}, lastAuditSeq=${state.lastAuditSeq}). ` +
    `Run a second-brain audit first or explicitly opt out for this turn.`;
  return {
    decision: isNested ? "deny" : "block",
    code: "DUAL_BRAIN_AUDIT_REQUIRED",
    reason,
  };
}

export function evaluateStopGate(state) {
  if (state.bypassRequested) return { decision: "allow" };
  if (state.auditFailedCount >= MAX_FAILED_AUDITS_FAILSAFE) return { decision: "allow", reason: "failsafe_yield" };
  if (state.forcedCountInTurn >= MAX_STEERS_PER_TURN) return { decision: "allow", reason: "max_steers_reached" };
  if (state.lastMutationSeq > state.lastAuditSeq) {
    state.forcedCountInTurn += 1;
    return {
      decision: "block",
      code: "DUAL_BRAIN_STOP_AUDIT_REQUIRED",
      attempt: state.forcedCountInTurn,
      maxAttempts: MAX_STEERS_PER_TURN,
      reason:
        `[DUAL-BRAIN STOP GATE] Unaudited substantive work detected (${state.lastMutationSummary || "mutation"}, ` +
        `mutationSeq=${state.lastMutationSeq}, lastAuditSeq=${state.lastAuditSeq}). ` +
        `Run an independent cross-audit before finishing this turn (${state.forcedCountInTurn}/${MAX_STEERS_PER_TURN}).`,
    };
  }
  return { decision: "allow" };
}
