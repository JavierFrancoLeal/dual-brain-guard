/**
 * DeepSeek Harness (DSH) Host Adapter for Dual-Brain Guard.
 * Stores state in a private WeakMap<Agent, State> in host memory so shell/file tools cannot tamper with it.
 */
import {
  beginTurn,
  classifyToolOutcome,
  createInitialState,
  evaluateCommitGate,
  evaluateStopGate,
} from "../core.mjs";

const stateMap = new WeakMap();

function getState(agent) {
  let st = stateMap.get(agent);
  if (!st) {
    st = createInitialState();
    stateMap.set(agent, st);
  }
  return st;
}

function isSubagent(agent) {
  const header = agent?.session?.header;
  return header?.origin === "subagent" || header?.parentSession !== undefined;
}

export function installDshGuard(agent, options = {}) {
  if (!agent?.ctx) return () => {};
  const env = options.env || process.env;
  if (env.DUAL_BRAIN_ORIGIN === "auditor" || env.DUAL_BRAIN_ORIGIN === "antigravity" || isSubagent(agent)) {
    return () => {};
  }

  const state = getState(agent);
  const disposers = [];

  disposers.push(
    agent.ctx.on("agent/pre-step", async (payload, next) => {
      const userText = (payload?.messages || [])
        .filter((m) => !m?.source || m.source.kind === "user")
        .map((m) => (typeof m.content === "string" ? m.content : (m.content || []).map((b) => b?.text || "").join("\n")))
        .join("\n");
      beginTurn(state, payload?.turn, userText);
      return next();
    }),
  );

  disposers.push(
    agent.ctx.on("tools/pre-execute", async (exec, next) => {
      const gate = evaluateCommitGate(state, exec?.name, exec?.arguments, { isNested: exec?.parent !== undefined });
      if (gate.decision === "allow") return next();
      if (gate.decision === "deny") {
        return { kind: "deny", reason: gate.reason, info: { code: gate.code, reason: gate.reason } };
      }
      return { kind: "ask", reason: gate.reason };
    }),
  );

  disposers.push(
    agent.ctx.on("tools/result", (exec, result) => {
      classifyToolOutcome(exec, result, state);
    }),
  );

  disposers.push(
    agent.ctx.on("agent/turn-stopping", ({ agent: stoppingAgent }) => {
      const gate = evaluateStopGate(state);
      if (gate.decision === "block") {
        (stoppingAgent || agent).steer({
          content: [{ type: "text", text: gate.reason }],
          source: { kind: "dual-brain-guard" },
        });
      }
    }),
  );

  return () => {
    for (const d of disposers) {
      try { if (typeof d === "function") d(); } catch {}
    }
    stateMap.delete(agent);
  };
}
