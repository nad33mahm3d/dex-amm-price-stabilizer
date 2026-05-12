import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickBestPlan } from "../src/tradeEngine";
import type { DexEvaluation } from "../src/types";

describe("pickBestPlan", () => {
  it("prefers lowest residual then lowest slippage", () => {
    const evaluations: DexEvaluation[] = [
      {
        dex: "uniswap_v3",
        prePriceScaled: 100n,
        diffBps: 200n,
        plan: {
          dex: "uniswap_v3",
          direction: "BUY_BASE_WITH_USDC",
          tokenIn: "0x1",
          tokenOut: "0x2",
          amountInRaw: 10n,
          amountOutRaw: 12n,
          prePriceScaled: 100n,
          postPriceScaled: 103n,
          targetPriceScaled: 104n,
          diffBpsBefore: 200n,
          diffBpsAfter: 100n,
          slippageBpsEstimate: 40n,
          poolOrPairAddress: "0xpool",
        },
      },
      {
        dex: "quickswap_v2",
        prePriceScaled: 100n,
        diffBps: 200n,
        plan: {
          dex: "quickswap_v2",
          direction: "BUY_BASE_WITH_USDC",
          tokenIn: "0x1",
          tokenOut: "0x2",
          amountInRaw: 10n,
          amountOutRaw: 12n,
          prePriceScaled: 100n,
          postPriceScaled: 103n,
          targetPriceScaled: 104n,
          diffBpsBefore: 200n,
          diffBpsAfter: 100n,
          slippageBpsEstimate: 30n,
          poolOrPairAddress: "0xpair",
        },
      },
    ];
    const best = pickBestPlan(evaluations);
    assert.equal(best?.dex, "quickswap_v2");
  });
});

