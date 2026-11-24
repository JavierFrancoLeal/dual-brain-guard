---
tier: 3
schema: case-law-v1
purpose: Cold Case-Law Archive & Open Symptoms Radar for Dual-Brain Guard (NEVER auto-loaded; query via grep on failure)
total_cases: 3
open_symptoms: 1
tags:
  - dsh-hooks
  - node-zlib
  - ledger-sync
error_strings:
  - "isRealDshAudit"
  - "zstdDecompressSync"
  - "LAST_TURN"
---

# Dual-Brain Guard — Cold Case-Law Archive (`CASE-100`, `CASE-107`, `CASE-110`) & Open Symptoms Radar

---

## Compiled Cases (`status: compiled` — enforced mechanically in Tier 2, `0 tok` prose overhead)

- **CASE-100** `[node-zlib]` · `vendor-quirk` · `status: compiled` · **Home:** `UPSTREAM_NODEJS_ZSTD_MULTIFRAME_ARTICLE.md` (EOF coverage assert)
  - **Root cause:** Node.js `<= v24.21.0` `zlib.zstdDecompressSync` / `createZstdDecompress` silently stopped after Frame #1 on RFC 8878 multi-frame concatenated `.zstd` logs (`99.98%` silent loss across 237 DSH sessions).
  - **Fix:** Upgrade to Node.js `>= v24.22.0` (`nodejs/node#65865`) or scan frame boundaries with explicit EOF byte-coverage assertions.
- **CASE-107** `[dsh-hooks]` · `class-pattern` · `status: compiled` · **Home:** `src/core.mjs`, `test/dual-brain-guard.test.mjs`
  - **Root cause:** Quoted `--patch`/`--profile` strings bypassed `isRealDshAudit()`, and `\s*` inside negative lookahead `(?!\s*\/dev\/null\b)` caused regex backtracking edge cases in shell tamper guards.
  - **Fix:** Enforced shell-aware parsing + deterministic adversarial bypass test suite (`10/10` tests).

---

## Open Symptoms Radar (`status: open` — unresolved mysteries indexed for future serendipity/transferability)

- **CASE-110** `[ledger-sync]` · `status: open` · **Observed:** Both `~/.dsh/dialogue.md` (`LAST_TURN: #28` vs `#40`) and `lsq-bridge/.dsh/dialogue.md` (`LAST_TURN: #6` vs `#48`) drifted when turns were appended in mixed heading formats.
  - **Hypotheses:** Manual/semi-automated appends update the tail without atomically rewriting the top `LAST_TURN:` header.
  - **Trigger to close:** Add a deterministic `verify-ledger-header` check asserting `LAST_TURN == max(turn_id)`.
