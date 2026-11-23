#!/usr/bin/env node
/**
 * Dual-Brain Economic ROI Simulator (zero external dependencies)
 * --------------------------------------------------------------
 * Benchmarks Dual-Brain offloading (KV cache hit rate + UTC off-peak discipline)
 * against a single-model frontier baseline. Defaults are grounded in the
 * 2.80-billion-token Snapshot v1 empirical corpus (237 DSH + 23 Antigravity runs).
 */

import { pathToFileURL } from "node:url";

export const OBSERVED_CORPUS_DEFAULTS = {
  cacheReadTokens: 1_724_608_768,
  inputMissTokens: 20_508_476,
  outputTokens: 8_397_711,
  offPeakShare: 3968 / 6996, // 0.567181...
  offPeakDiscount: 0.5,
  dshRatesPer1M: { cacheHit: 0.07, inputMiss: 0.27, output: 1.1 },
  frontierRatesPer1M: { cacheHit: 0.3, inputMiss: 3.0, output: 15.0 },
};

function assertNonNegativeFinite(name, val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) {
    throw new RangeError(`${name} must be a non-negative finite number (got ${val})`);
  }
  return n;
}

export function simulateDualBrainRoi(params = {}) {
  const cfg = { ...OBSERVED_CORPUS_DEFAULTS, ...params };
  const cacheReadTokens = assertNonNegativeFinite("cacheReadTokens", cfg.cacheReadTokens);
  const inputMissTokens = assertNonNegativeFinite("inputMissTokens", cfg.inputMissTokens);
  const outputTokens = assertNonNegativeFinite("outputTokens", cfg.outputTokens);
  const dshRates = { ...OBSERVED_CORPUS_DEFAULTS.dshRatesPer1M, ...(params.dshRatesPer1M || {}) };
  const frontierRates = { ...OBSERVED_CORPUS_DEFAULTS.frontierRatesPer1M, ...(params.frontierRatesPer1M || {}) };

  const totalTokens = cacheReadTokens + inputMissTokens + outputTokens;
  const cacheHitRatePct =
    (100 * cacheReadTokens) / Math.max(1, cacheReadTokens + inputMissTokens);

  const dshStandardUsd =
    (cacheReadTokens / 1e6) * dshRates.cacheHit +
    (inputMissTokens / 1e6) * dshRates.inputMiss +
    (outputTokens / 1e6) * dshRates.output;

  const clampedOffPeak = Math.max(0, Math.min(1, Number(cfg.offPeakShare)));
  const dshWithOffPeakUsd = dshStandardUsd * (1 - cfg.offPeakDiscount * clampedOffPeak);

  const frontierEquivalentUsd =
    (cacheReadTokens / 1e6) * frontierRates.cacheHit +
    (inputMissTokens / 1e6) * frontierRates.inputMiss +
    (outputTokens / 1e6) * frontierRates.output;

  const savingsUsd = frontierEquivalentUsd - dshWithOffPeakUsd;
  const savingsFactorX = frontierEquivalentUsd / Math.max(0.01, dshWithOffPeakUsd);

  return {
    totalTokens,
    cacheHitRatePct: Number(cacheHitRatePct.toFixed(2)),
    offPeakSharePct: Number((clampedOffPeak * 100).toFixed(2)),
    dshStandardUsd: Number(dshStandardUsd.toFixed(2)),
    dshWithOffPeakUsd: Number(dshWithOffPeakUsd.toFixed(2)),
    frontierEquivalentUsd: Number(frontierEquivalentUsd.toFixed(2)),
    savingsUsd: Number(savingsUsd.toFixed(2)),
    savingsFactorX: Number(savingsFactorX.toFixed(1)),
  };
}

function getNumFlag(args, name, fallback) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  const v = Number(args[idx + 1]);
  return Number.isFinite(v) ? v : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const res = simulateDualBrainRoi({
    cacheReadTokens: getNumFlag(args, "--cache-read", OBSERVED_CORPUS_DEFAULTS.cacheReadTokens),
    inputMissTokens: getNumFlag(args, "--input-miss", OBSERVED_CORPUS_DEFAULTS.inputMissTokens),
    outputTokens: getNumFlag(args, "--output", OBSERVED_CORPUS_DEFAULTS.outputTokens),
    offPeakShare: getNumFlag(args, "--off-peak", OBSERVED_CORPUS_DEFAULTS.offPeakShare),
  });
  console.log(JSON.stringify(res, null, 2));
}
