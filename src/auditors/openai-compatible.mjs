#!/usr/bin/env node
/**
 * Dual-Brain Guard — Universal OpenAI-Compatible Second-Brain Auditor Runner (Zero Dependencies)
 *
 * Works out of the box with ANY OpenAI-compatible Chat Completions endpoint:
 *   openai | grok | deepseek | qwen | kimi | glm | openrouter | ollama | custom (--base-url)
 *
 * Usage:
 *   git diff | dual-brain-audit --provider deepseek
 *   git diff | dual-brain-audit --provider grok --model grok-4
 *   git diff | dual-brain-audit --base-url https://api.example.com/v1 --api-key-env MY_KEY --model my-model
 *   dual-brain-audit --provider ollama --model qwen2.5-coder:32b --diff ./changes.patch
 */
import fs from "node:fs";
import path from "node:path";

export const PRESETS = Object.freeze({
  openai: {
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    model: "gpt-4.1",
  },
  grok: {
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    model: "grok-3",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    model: "deepseek-reasoner",
  },
  qwen: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    model: "qwen-max",
  },
  kimi: {
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnv: "MOONSHOT_API_KEY",
    model: "moonshot-v1-128k",
  },
  glm: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyEnv: "ZHIPU_API_KEY",
    model: "glm-4-plus",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    model: "deepseek/deepseek-r1",
  },
  ollama: {
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKeyEnv: "",
    model: "qwen2.5-coder:32b",
    allowNoKey: true,
  },
});

const DEFAULT_SYSTEM_PROMPT = [
  "You are an independent, skeptical Second-Brain adversarial code auditor (NO edits).",
  "Review ONLY against the provided diff, files, and constraints — never guess external APIs from memory.",
  "Report: (1) Concrete bugs, security holes, or broken assumptions (cite file/line),",
  "(2) Over-engineering or blast-radius violations, (3) Missing verification tests.",
  "End with a clear verdict line: VERDICT: PASS or VERDICT: BLOCK.",
].join(" ");

export function resolveAuditorConfig(opts = {}, env = process.env) {
  const providerKey = String(opts.provider || env.DUAL_BRAIN_PROVIDER || "").trim().toLowerCase();
  const preset = providerKey ? PRESETS[providerKey] : null;
  if (providerKey && !preset) {
    throw new Error(
      `Unknown --provider "${providerKey}". Supported presets: ${Object.keys(PRESETS).join(", ")} (or pass --base-url).`,
    );
  }

  const baseUrl = String(opts.baseUrl || env.DUAL_BRAIN_BASE_URL || preset?.baseUrl || "").replace(/\/+$/, "");
  const model = String(opts.model || env.DUAL_BRAIN_MODEL || preset?.model || "").trim();
  const apiKeyEnv = String(opts.apiKeyEnv ?? env.DUAL_BRAIN_API_KEY_ENV ?? preset?.apiKeyEnv ?? "").trim();

  if (!baseUrl) throw new Error("Missing --base-url (or --provider preset / DUAL_BRAIN_BASE_URL).");
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid --base-url: "${baseUrl}"`);
  }
  const isLocalHost =
    parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "localhost" || parsedUrl.hostname === "::1";
  if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && isLocalHost)) {
    throw new Error(
      `Refused insecure/non-HTTPS --base-url "${baseUrl}" (only https:// or http://localhost|127.0.0.1 allowed).`,
    );
  }

  const allowNoKey = Boolean(opts.allowNoKey || preset?.allowNoKey || isLocalHost);
  const apiKey = apiKeyEnv ? String(env[apiKeyEnv] || "").trim() : "";

  if (!model) throw new Error("Missing --model (or --provider preset / DUAL_BRAIN_MODEL).");
  if (!allowNoKey && !apiKey) {
    throw new Error(`Missing API key in environment variable ${apiKeyEnv || "<unspecified>"}.`);
  }

  const rawTimeout = Number(opts.timeoutMs ?? env.DUAL_BRAIN_TIMEOUT_MS ?? 90000);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout >= 1000 ? Math.floor(rawTimeout) : 90000;

  return {
    provider: providerKey || "custom",
    baseUrl,
    model,
    apiKeyEnv,
    apiKey,
    allowNoKey,
    timeoutMs,
  };
}

export async function runOpenAICompatibleAudit({
  config,
  input,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
  fetchImpl = globalThis.fetch,
}) {
  if (!input || !String(input).trim()) {
    throw new Error("Empty audit input: pipe a diff/prompt on stdin or pass --diff <file> / --prompt <text>.");
  }

  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: String(input) },
        ],
      }),
    });

    const rawBody = await res.text();
    if (!res.ok) {
      throw new Error(`Auditor HTTP ${res.status} (${config.provider}/${config.model}): ${rawBody.slice(0, 300)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error(`Auditor returned non-JSON body (${config.provider}/${config.model}).`);
    }
    const rawContent = parsed?.choices?.[0]?.message?.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map((part) => (typeof part === "string" ? part : String(part?.text || ""))).join("")
      : String(rawContent || "");
    if (!content.trim()) {
      throw new Error(`Auditor returned empty completion (${config.provider}/${config.model}).`);
    }
    return {
      provider: config.provider,
      model: parsed?.model || config.model,
      content,
      usage: parsed?.usage || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseCliArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--list-presets") opts.listPresets = true;
    else if (arg === "--provider" && argv[i + 1]) opts.provider = argv[++i];
    else if (arg === "--base-url" && argv[i + 1]) opts.baseUrl = argv[++i];
    else if (arg === "--api-key-env" && argv[i + 1]) opts.apiKeyEnv = argv[++i];
    else if (arg === "--model" && argv[i + 1]) opts.model = argv[++i];
    else if (arg === "--diff" && argv[i + 1]) opts.diffFile = argv[++i];
    else if (arg === "--prompt" && argv[i + 1]) opts.prompt = argv[++i];
    else if (arg === "--timeout-ms" && argv[i + 1]) opts.timeoutMs = Number(argv[++i]);
  }
  return opts;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      `Usage: dual-brain-audit [--provider <${Object.keys(PRESETS).join("|")}>] [--base-url <url>] [--api-key-env <ENV>] [--model <id>] [--diff <file>] [--prompt <text>]`,
    );
    process.exit(0);
  }
  if (opts.listPresets) {
    console.log(JSON.stringify(PRESETS, null, 2));
    process.exit(0);
  }

  try {
    const config = resolveAuditorConfig(opts);
    const stdinText = process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8");
    const fileText = opts.diffFile ? fs.readFileSync(opts.diffFile, "utf8") : "";
    const combined = [opts.prompt, fileText, stdinText].filter((s) => s && String(s).trim()).join("\n\n");
    const result = await runOpenAICompatibleAudit({ config, input: combined });
    process.stdout.write(`${result.content.trim()}\n`);
  } catch (err) {
    process.stderr.write(`auditor failed: ${err?.message || String(err)}\n`);
    process.exit(1);
  }
}
