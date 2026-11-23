# Why Single-Agent Code Reviews Fail (and How Mechanical Dual-Brain Gates Fix Them)

*Field notes from building a bidirectional mechanical cross-audit guard across independent AI coding agents — by [Javier Franco](https://github.com/JavierFrancoLeal).*

---

## 1. The Illusion of "Please Double-Check Your Work"

Ask any frontier coding agent to *"carefully review your own diff before committing"* and it will happily reply: **"Everything looks clean and verified!"** — right before pushing a broken shell script, a wrong tensor shape, or a stripped Android native module.

This isn't a prompting failure. It is a structural property of single-model autoregression: **the model that generated a mistake shares 100 % of the priors that produced it.**

Prompt-only guardrails (*"Always ask a second agent before `git push`"*) fail for a second reason: under long context or multi-step tool loops, models silently skip optional checklist prose whenever they feel confident.

The only reliable fix is **mechanical enforcement outside the model's prompt** — a host-level state machine that tracks every file/shell mutation and **physically blocks `git commit`, `git push`, and turn completion** until an independent second brain has audited the real diff *after* the last mutation.

---

## 2. Five Real Failure Modes We Hit Building Dual-Brain Enforcement

While hardening `dual-brain-guard` in production across hundreds of real coding sessions, we discovered five subtle bypasses that broke naive hook scripts:

1. **B1 — Calling a second brain to *edit* is a mutation, never an audit:** Early on, delegating `second_brain(action="edit")` accidentally cleared the audit gate simply because the second brain ran. Any tool that writes files must advance `lastMutationSeq`, never `lastAuditSeq`.
2. **B2 — False-green tool failures (`isError: false`):** Many CLI wrappers return exit `0` / `isError: false` with plain text like `"failed to launch: ENOENT"` or `"requires a Git repository"`. Checking only `isError` lets crashed audits silently unlock `git push`. You must classify refusal/error text *and* cap consecutive failures with a bounded fail-safe (`MAX_FAILED_AUDITS_FAILSAFE = 2`).
3. **M4 — Nested tool deadlocks:** Returning an interactive `"ask"` approval prompt inside a nested programmatic tool call (`exec.parent !== undefined`) deadlocks headless sub-calls. Nested calls must receive a clean deterministic `"deny"` with an error code (`DUAL_BRAIN_AUDIT_REQUIRED`).
4. **M6 — Sticky opt-outs:** If a user says *"skip audit"* on a quick 1-line typo fix, a naive boolean flag stays `true` for the rest of the session — silently disabling governance on a critical refactor two turns later. Opt-outs MUST reset on every new user turn (`beginTurn`).
5. **Evasive git & spoofed audit commands:** Simple regexes like `/git commit/` miss `git --no-pager commit`, `git -C /repo push`, `git branch -f -D`, and `gh pr merge` — while naive audit detectors get fooled by `auditor --help` or backgrounded `auditor ... &`.

---

## 3. Redundancy ≠ Independence (The Correlated Blind-Spot Lesson)

Even with two distinct models, **if you only ask the second brain to verify your diff without grounding it in reality, both models can share the same blind spot** (for example, both trusting a `"14B"` model name without summing the `34.55 GB` of safetensors on disk).

Dual-Brain Guard works best paired with **[Casebook](https://github.com/JavierFrancoLeal/casebook)**:
- **Dual-Brain Guard** enforces *when* an independent cross-audit must run (mechanically, zero exceptions).
- **Casebook** enforces *how* it verifies (*reality verifies the rule*: real execution, disk bytes, structural invariants).

---

## 4. Harness-Agnostic by Design

`dual-brain-guard` ships with **zero external npm dependencies** and runs everywhere:
- **Claude Code / Gemini CLI / Antigravity / Cursor:** `PreToolUse`, `PostToolUse`, and `Stop` hook runner (`dual-brain-guard pre-tool | post-tool | stop`, exit `2` to block).
- **Any MCP Host:** zero-dependency stdio MCP server (`dual-brain-mcp`).
- **DeepSeek Harness (DSH):** native `WeakMap<Agent, State>` host adapter (`src/adapters/dsh.mjs`).

---

*Part 2 of the Open-Source Agent Engineering Trilogy by Javier Franco: **[`casebook`](https://github.com/JavierFrancoLeal/casebook)** (memory) · **[`dual-brain-guard`](https://github.com/JavierFrancoLeal/dual-brain-guard)** (mechanical cross-audit) · `autonomy-ladder` (evidence-based autonomy).*
