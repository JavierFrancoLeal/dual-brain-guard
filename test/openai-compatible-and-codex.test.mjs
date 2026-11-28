import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRESETS,
  resolveAuditorConfig,
  runOpenAICompatibleAudit,
} from "../src/auditors/openai-compatible.mjs";
import {
  createInitialState,
  classifyToolOutcome,
  evaluateCommitGate,
  isRealAuditCliCommand,
} from "../src/core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

test("PRESETS covers OpenAI, Grok, DeepSeek, Qwen, Kimi, GLM, OpenRouter, and Ollama", () => {
  for (const key of ["openai", "grok", "deepseek", "qwen", "kimi", "glm", "openrouter", "ollama"]) {
    assert.ok(PRESETS[key], `Missing preset: ${key}`);
    assert.ok(PRESETS[key].baseUrl.startsWith("http"), `Invalid baseUrl for ${key}`);
    assert.ok(PRESETS[key].model.length > 0, `Missing default model for ${key}`);
  }
});

test("resolveAuditorConfig validates missing API keys and allows keyless localhost Ollama", () => {
  assert.throws(
    () => resolveAuditorConfig({ provider: "grok" }, {}),
    /Missing API key in environment variable XAI_API_KEY/,
  );
  const grokCfg = resolveAuditorConfig({ provider: "grok" }, { XAI_API_KEY: "test-key" });
  assert.equal(grokCfg.baseUrl, "https://api.x.ai/v1");
  assert.equal(grokCfg.apiKey, "test-key");

  const ollamaCfg = resolveAuditorConfig({ provider: "ollama" }, {});
  assert.equal(ollamaCfg.allowNoKey, true);
  assert.equal(ollamaCfg.apiKey, "");

  const customCfg = resolveAuditorConfig(
    { baseUrl: "https://my.gateway/v1/", apiKeyEnv: "CUSTOM_KEY", model: "qwen-3", timeoutMs: "NaN" },
    { CUSTOM_KEY: "secret-1" },
  );
  assert.equal(customCfg.baseUrl, "https://my.gateway/v1");
  assert.equal(customCfg.model, "qwen-3");
  assert.equal(customCfg.timeoutMs, 90000);

  // SSRF & localhost-spoof protection
  assert.throws(
    () => resolveAuditorConfig({ baseUrl: "http://localhost.attacker.com/v1", model: "x" }, {}),
    /Refused insecure\/non-HTTPS/,
  );
  assert.throws(
    () => resolveAuditorConfig({ baseUrl: "http://169.254.169.254/latest/meta-data", model: "x" }, {}),
    /Refused insecure\/non-HTTPS/,
  );
});

test("runOpenAICompatibleAudit works end-to-end against a real local HTTP server", async () => {
  let capturedAuth = "";
  let capturedBody = null;
  const server = http.createServer((req, res) => {
    capturedAuth = req.headers.authorization || "";
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      capturedBody = JSON.parse(raw);
      if (req.url === "/v1/chat/completions" && capturedBody.model === "fail-model") {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "rate limited" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: capturedBody.model,
          choices: [{ message: { content: "1. No bugs found.\nVERDICT: PASS" } }],
          usage: { total_tokens: 42 },
        }),
      );
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const cfg = resolveAuditorConfig(
      { baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "TEST_KEY", model: "deepseek-reasoner" },
      { TEST_KEY: "tok-xyz" },
    );
    const out = await runOpenAICompatibleAudit({ config: cfg, input: "diff --git a/a.js b/a.js\n+const x = 1;" });
    assert.equal(capturedAuth, "Bearer tok-xyz");
    assert.equal(capturedBody.model, "deepseek-reasoner");
    assert.match(out.content, /VERDICT: PASS/);

    const failCfg = resolveAuditorConfig(
      { baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "TEST_KEY", model: "fail-model" },
      { TEST_KEY: "tok-xyz" },
    );
    await assert.rejects(() => runOpenAICompatibleAudit({ config: failCfg, input: "diff" }), /HTTP 429/);
  } finally {
    server.close();
  }
});

test("Codex CLI adapter hooks.json is valid and core recognizes dual-brain-audit + apply_patch", () => {
  const codexHooks = JSON.parse(
    fs.readFileSync(path.join(ROOT, "src/adapters/codex.hooks.json"), "utf8"),
  );
  assert.ok(Array.isArray(codexHooks.hooks.PreToolUse));
  assert.ok(Array.isArray(codexHooks.hooks.PostToolUse));
  assert.ok(Array.isArray(codexHooks.hooks.Stop));

  // Verify core.mjs recognizes dual-brain-audit and rejects --help / --list-presets / background &
  assert.equal(isRealAuditCliCommand("git diff | dual-brain-audit --provider deepseek"), true);
  assert.equal(isRealAuditCliCommand("dual-brain-audit --help"), false);
  assert.equal(isRealAuditCliCommand("dual-brain-audit --list-presets"), false);
  assert.equal(isRealAuditCliCommand("dual-brain-audit --provider grok &"), false);

  // Simulate Codex apply_patch -> git push blocked -> VERDICT: BLOCK still blocked -> VERDICT: PASS allowed
  const state = createInitialState();
  classifyToolOutcome({ name: "apply_patch", arguments: { path: "src/app.js" } }, { isError: false }, state);
  assert.equal(evaluateCommitGate(state, "shell", { command: "git push origin main" }).decision, "block");

  classifyToolOutcome(
    { name: "shell", arguments: { command: "git diff | dual-brain-audit --provider deepseek" } },
    { isError: false, text: "Found SQLi.\nVERDICT: BLOCK" },
    state,
  );
  assert.equal(evaluateCommitGate(state, "shell", { command: "git push origin main" }).decision, "block");

  classifyToolOutcome(
    { name: "shell", arguments: { command: "git diff | dual-brain-audit --provider deepseek" } },
    { isError: false, text: "VERDICT: PASS" },
    state,
  );
  assert.equal(evaluateCommitGate(state, "shell", { command: "git push origin main" }).decision, "allow");
});
