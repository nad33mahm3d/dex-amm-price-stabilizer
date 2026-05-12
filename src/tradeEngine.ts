import type { DexEvaluation, DexQuotePlan } from "./types";

export function pickBestPlan(evaluations: DexEvaluation[]): DexQuotePlan | null {
  const candidates = evaluations.map((e) => e.plan).filter((p): p is DexQuotePlan => p !== null);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.diffBpsAfter !== b.diffBpsAfter) return a.diffBpsAfter < b.diffBpsAfter ? -1 : 1;
    if (a.slippageBpsEstimate !== b.slippageBpsEstimate) return a.slippageBpsEstimate < b.slippageBpsEstimate ? -1 : 1;
    if (a.amountInRaw !== b.amountInRaw) return a.amountInRaw < b.amountInRaw ? -1 : 1;
    return 0;
  });
  return candidates[0];
}

