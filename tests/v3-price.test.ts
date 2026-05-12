import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { priceScaledFromSqrt } from "../src/dexAdapters/uniswapV3";

describe("priceScaledFromSqrt", () => {
  it("is monotonic for token0=base, token1=USDC", () => {
    const common = {
      token0: "0xb",
      token1: "0xu",
      baseTokenAddress: "0xb",
      usdcAddress: "0xu",
      baseDecimals: 18,
      usdcDecimals: 6,
      scalePow: 8,
    };
    const p1 = priceScaledFromSqrt({ ...common, sqrtPriceX96: 2n ** 96n });
    const p2 = priceScaledFromSqrt({ ...common, sqrtPriceX96: (2n ** 96n) * 2n });
    assert.ok(p2 > p1);
  });
});
