import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requiredInputToTargetV2 } from "../src/dexAdapters/quickswapV2";

describe("requiredInputToTargetV2", () => {
  it("returns BUY direction when current price is below target", () => {
    const out = requiredInputToTargetV2({
      targetPriceScaled: 50000000n, // 0.5
      reserveBase: 1_000_000_000_000_000_000n,
      reserveUsdc: 300_000n, // 0.3
      baseDecimals: 18,
      usdcDecimals: 6,
      scalePow: 8,
    });
    assert.equal(out.direction, "BUY_BASE_WITH_USDC");
    assert.ok(out.amountInRaw > 0n);
  });

  it("returns SELL direction when current price is above target", () => {
    const out = requiredInputToTargetV2({
      targetPriceScaled: 30000000n, // 0.3
      reserveBase: 1_000_000_000_000_000_000n,
      reserveUsdc: 500_000n, // 0.5
      baseDecimals: 18,
      usdcDecimals: 6,
      scalePow: 8,
    });
    assert.equal(out.direction, "SELL_BASE_FOR_USDC");
    assert.ok(out.amountInRaw > 0n);
  });
});
