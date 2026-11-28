# Dual-Brain Guard (`@franco/dual-brain-guard`)

[![CI](https://github.com/JavierFrancoLeal/dual-brain-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/JavierFrancoLeal/dual-brain-guard/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

**Harness-agnostic mechanical Dual-Brain cross-audit guard for AI coding agents.**  
*By [Javier Franco](https://github.com/JavierFrancoLeal) · `v1.2.0` · Zero External Dependencies · Apache-2.0*

> **Prompt-only review rules get skipped.** Dual-Brain Guard mechanically blocks `git commit`, `git push`, destructive git operations, and unaudited turn completion until an independent second brain audits the real diff *after* your last edit.  
> 📖 **Read the field-notes essay:** [Why Single-Agent Code Reviews Fail](./docs/ESSAY_WHY_SINGLE_AGENT_REVIEWS_FAIL.md)  
> 🧠 **Multi-LLM Pairing Guide:** [How to Pair Two Opposite LLMs (Field-Tested & Benchmark Predictions)](./docs/TANDEM_PAIRING_GUIDE.md)  
> 📊 **Empirical Study & ROI (`2.80B` Tokens):** [Dual-Brain Hall of Fame & 7.3× Offload ROI Study](./docs/EMPIRICAL_HALL_OF_FAME_AND_ROI.md) (`node src/roi-simulator.mjs`)

![Dual-Brain Guard Terminal Demo](./assets/demo-terminal.svg)

---

## Works With Every Major AI Coding Harness

| Harness | Enforcement Mode | Adapter |
| :--- | :--- | :--- |
| **Claude Code** | **Mechanical** (`PreToolUse` / `PostToolUse` / `Stop`, exit `2` blocks) | [`src/adapters/claude-code.hooks.json`](./src/adapters/claude-code.hooks.json) |
| **OpenAI Codex CLI** | **Mechanical** (`PreToolUse` / `PostToolUse` / `Stop` + `apply_patch`) | [`src/adapters/codex.hooks.json`](./src/adapters/codex.hooks.json) · [`codex.AGENTS.md`](./src/adapters/codex.AGENTS.md) |
| **Gemini CLI** | **Mechanical** (`BeforeTool` / `AfterTool` / `AfterAgent`, exit `2` blocks) | [`src/adapters/gemini-cli.hooks.json`](./src/adapters/gemini-cli.hooks.json) |
| **DeepSeek Harness (DSH)** | **Mechanical** (private `WeakMap<Agent, State>` host adapter) | [`src/adapters/dsh.mjs`](./src/adapters/dsh.mjs) |
| **Cursor / Any MCP Host** | **Advisory state & commit-check** via stdio MCP server (`dual-brain-mcp`) | [`src/mcp-server.mjs`](./src/mcp-server.mjs) |
| **Universal Second-Brain Auditor** | **OpenAI-compatible runner** (`openai`, `grok`, `deepseek`, `qwen`, `kimi`, `glm`, `openrouter`, `ollama`, or `--base-url`) | [`src/auditors/openai-compatible.mjs`](./src/auditors/openai-compatible.mjs) (`dual-brain-audit`) |

---

## Battle-Tested Mechanical Guarantees

- **Evasive git protection:** catches `git --no-pager commit`, `git -C repo push`, `git branch -f -D`, `git remote -v add`, `git reset`, `gh pr merge` — while allowing read-only `git status`, `git diff`, `git log`, `git tag -l`.
- **Anti-spoofing audit detection:** rejects `--help`, `--version`, backgrounded `&` commands, and false-green error strings (`isError: false` with `"failed to launch"`).
- **Edit ≠ Audit:** delegating an edit to a second brain advances `lastMutationSeq`, never `lastAuditSeq`.
- **Non-sticky per-turn opt-out:** explicit user opt-outs (`skip audit`, `solo mode`) apply *only* to the current turn and reset automatically on the next turn.
- **Anti-recursion & bounded fail-safe:** yields inside subagents / `DUAL_BRAIN_ORIGIN=auditor`, caps stop-gate steers (`2/turn`), and yields cleanly after 2 consecutive auditor launch failures.

---

## Quick Start (Zero Dependencies, Node `>= 18`)

```bash
git clone https://github.com/JavierFrancoLeal/dual-brain-guard.git
cd dual-brain-guard
npm test
```

### Use as a Hook Runner (Claude Code / Gemini CLI / Antigravity)
Copy [`src/adapters/claude-code.hooks.json`](./src/adapters/claude-code.hooks.json) or [`src/adapters/gemini-cli.hooks.json`](./src/adapters/gemini-cli.hooks.json) into your settings, or run directly:
```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}' | node src/cli.mjs pre-tool
```

### Use the Universal OpenAI-Compatible Second-Brain Auditor (`dual-brain-audit`)
Pipe any `git diff` to an independent model family (zero external dependencies; enforces HTTPS or strict localhost):
```bash
git diff | npx --yes @franco/dual-brain-guard dual-brain-audit --provider deepseek
# Supported presets: openai, grok, deepseek, qwen, kimi, glm, openrouter, ollama
# Or any custom endpoint:
git diff | node src/auditors/openai-compatible.mjs --base-url https://api.x.ai/v1 --api-key-env XAI_API_KEY --model grok-3
```
Any `VERDICT: BLOCK` response keeps the commit/push gate closed until fixed.

### Use as a Stdio MCP Server (Cursor / Claude Code / Any MCP Host)
```json
{
  "mcpServers": {
    "dual-brain-guard": {
      "command": "node",
      "args": ["/path/to/dual-brain-guard/src/mcp-server.mjs"]
    }
  }
}
```

---

## Open-Source Agent Governance Suite

| Repository | Role | Status |
| :--- | :--- | :--- |
| **[`casebook`](https://github.com/JavierFrancoLeal/casebook)** | Bounded-entropy 4-tier constitutional memory, Open Symptoms Radar & 5-to-1 compaction oracle | **`v1.0.1` Live** |
| **[`dual-brain-guard`](https://github.com/JavierFrancoLeal/dual-brain-guard)** | Harness-agnostic mechanical Proposer != Verifier cross-model guard (`CLI + MCP + hooks`) | **`v1.1.1` Live** |
| **[`autonomy-ladder`](https://github.com/JavierFrancoLeal/autonomy-ladder)** | Evidence-based Traffic-Light autonomy grader (`🟢 / ⚑ / 🟡 / 🔴` & `A/B/C/D` trust scores) | **`v1.0.2` Live** |
| **[`governed-browser`](https://github.com/JavierFrancoLeal/governed-browser)** | Constitutional commit-click brake (`🛑 RED` on Send/Pay/Delete) & SHA-256 hash-chained audit trail | **`v1.0.1` Live** |
| **[`forensic-contracts`](https://github.com/JavierFrancoLeal/forensic-contracts)** | 5-line `@forensic-contract` linter, `@blast-radius` cage enforcer & literal `sourcePin` verifier | **`v1.0.1` Live** |
| **[`agent-governance`](https://github.com/JavierFrancoLeal/agent-governance)** | Complete 26-plugin DeepSeek Harness governance suite (mother repository) | **`v1.0.0` Live** |
| **[`best-security-governance-architects`](https://github.com/JavierFrancoLeal/best-security-governance-architects)** | CPU-first pre-merge security & governance suite (`ECOSYSTEM_CONTRACT v1.2.0`) | **`v1.2.0` Live** |
| **[`best-ui-ux-designers`](https://github.com/JavierFrancoLeal/best-ui-ux-designers)** | Adversarial UI/UX design judgment suite — 12 Barbell design minds & 4 Via Negativa auditors | **`v1.2.0` Live** |
| **[`contrast-guard`](https://github.com/JavierFrancoLeal/contrast-guard)** | Zero-dependency WCAG 2.1 + perceptual CIELAB ΔE contrast & anti-camouflage auditor (CLI + headless Chrome CDP) | **`v1.0.0` Live** |

---

## License

Apache License 2.0 — see [LICENSE](./LICENSE).
