# Dual-Brain Cross-Audit Rule (OpenAI Codex CLI)

- Never let the same model family grade its own diff.
- Before any `git commit`, `git push`, or closing a turn with code edits, pipe the real `git diff` to an independent second-brain family via `dual-brain-audit` (e.g., `--provider deepseek`, `--provider grok`, `--provider qwen`, `--provider openrouter`, or `--provider ollama`):
  ```bash
  git diff | dual-brain-audit --provider deepseek
  ```
- Fix any `VERDICT: BLOCK` finding before committing.
- Mechanical enforcement: copy `src/adapters/codex.hooks.json` into `.codex/hooks.json`.
