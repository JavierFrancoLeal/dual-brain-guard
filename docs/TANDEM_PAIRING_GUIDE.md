# Dual-Brain Tandem Pairing Guide (Multi-LLM Architecture)

> **Transparency Note:** We have battle-tested **Gemini (Antigravity) + DeepSeek (DSH)** extensively in real production engineering. The additional cross-vendor tandems below are **evidence-based predictions** derived from public coding and reasoning benchmarks ([SWE-bench](https://www.swebench.com/), [Aider Polyglot](https://aider.chat/docs/leaderboards/), [LiveCodeBench](https://livecodebench.github.io/), and [Artificial Analysis](https://artificialanalysis.ai/)) — they have **not** yet been field-tested by us.

---

## 1. The Core Pattern: "Proposer + Verifier" (Uncorrelated Failure Modes)

You do **not** run one model twice. You pair **two different models from two different labs, with opposite strengths and distinct failure modes**, and wire them to watch each other mechanically.

- **Brain 1 (Proposer / Explorer):** Generates, imagines, explores, synthesizes external docs, holds the big-picture map, and drafts the plan.
- **Brain 2 (Verifier / Executor):** Measures against real bytes on disk, reads the actual `git diff`, runs tests, and points to the exact failing line.

**Why two opposite models beat "one bigger model":** A single model's mistakes are self-correlated — it fails in the exact same way because it shares the same training distribution and blind spots. Crossing two models from two different labs collapses the probability that both fail identically on the same line. *Two pairs of eyes from two different people see more than two eyes from one.*

---

## 2. Our Production Tandem (Field-Tested): Gemini + DeepSeek

### Brain 1 — Gemini (Explorer & Synthesizer)
- **Why it owns exploration & synthesis:**
  - **Large context window:** Holds an entire architectural map, multi-document strategy, or long conversation without losing the thread.
  - **Multimodal vision:** Inspects screenshots, UI layouts, video frames, and visual regressions — things text-only verifiers cannot see.
  - **External-world grounding:** Strong at synthesizing live web documentation, cloud APIs, and ecosystem context ("anchoring outside reality").
- **Known failure mode:** More perceptual and broad than byte-exact. On long tasks it can drift on subtle deterministic edge cases or exact line-level behavior.

### Brain 2 — DeepSeek via DSH (Local Deterministic Verifier)
- **Why it owns verification & bounded execution:**
  - **Lives local next to the repo:** Operates directly on real files, real `git diff`, and real test runners — reasoning over **bytes on disk**, never memories.
  - **Bounded deterministic reasoning:** Excels at closed-world questions with verifiable answers (*"does this regex match this edge case?"*, *"does this handler mutate its input in-place?"*, *"does this bash guard fail under `set -e`?"*).
  - **Strict anti-hallucination constraint:** Never allowed to critique external APIs or unseen versions from memory. It receives the real file/diff/test and must cite the exact `file:line` or stay silent.
- **Known failure mode:** Weak external-world grounding if asked about brand-new APIs or live web context — which is precisely what this architecture **never asks it to do**.

---

## 3. Predicted Cross-Vendor Tandems (From Public Benchmarks)

Public leaderboards ([SWE-bench](https://www.swebench.com/), [Aider Polyglot](https://aider.chat/docs/leaderboards/), [LiveCodeBench](https://livecodebench.github.io/), and [Artificial Analysis](https://artificialanalysis.ai/)) consistently show distinct lab profiles across **multi-file architecture, multimodal vision, deterministic patch precision, and inference cost**. Based on those profiles, these cross-vendor pairings are strong candidates:

| Tandem (`Proposer` + `Verifier`) | Status | Why the Two Labs Complement Each Other | Best Use Case |
| :--- | :--- | :--- | :--- |
| **Gemini + DeepSeek** | **✅ Field-Tested** | Long-context multimodal explorer + ultra-low-cost, strict local deterministic diff/test verifier | Full-stack, mobile UI, GPU pipelines, architecture + surgical audits |
| **Claude + DeepSeek** | *Predicted (Benchmarks)* | Claude consistently ranks at the top of SWE-bench for multi-file refactoring; DeepSeek provides an independent open-weights adversarial check at low cost | Heavy backend/TypeScript refactoring with cost-controlled continuous audits |
| **Gemini + OpenAI Reasoning / Codex** | *Predicted (Benchmarks)* | Gemini anchors multimodal UI + long-context repo synthesis; OpenAI reasoning models rank at the top of Aider Polyglot & LiveCodeBench for algorithmic & patch precision | Complex algorithms, compilers, tricky concurrency, visual + logic apps |
| **Claude + Gemini** | *Predicted (Benchmarks)* | Claude writes surgical multi-file diffs; Gemini audits visual UI regressions, full-repo architectural drift, and live external API docs | Frontend/mobile apps where visual QA + external SDK accuracy matter |
| **Claude / OpenAI + Local Qwen / DeepSeek (Ollama)** | *Predicted (Benchmarks)* | Frontier cloud proposer paired with an open-weights local verifier (`qwen` / `deepseek` on Ollama) reasoning strictly over local bytes | High-privacy / air-gapped verification with zero second-cloud API cost |

---

## 4. Wiring Any LLM into `dual-brain-guard`

`dual-brain-guard` recognizes these second-brain CLIs out of the box:
`dsh`, `agy`, `claude`, `codex`, `gemini`, `aider`, `opencode`, `ollama`, `qwen`, and `llm`.

To pair **any custom auditor CLI or wrapper script**, set `DUAL_BRAIN_AUDIT_CMD_REGEX`:

```bash
export DUAL_BRAIN_AUDIT_CMD_REGEX='\bmy-local-verifier\b'
```

Every rule stays identical regardless of which two LLMs you pair: **different labs, opposite strengths, real bytes on disk, and mechanical enforcement.**
