import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computePriceUsdcPerBaseScaled } from "../src/quickswap";
import type { Reserves } from "../src/quickswap";

describe("computePriceUsdcPerBaseScaled", () => {
  it("computes USDC per base token from reserves and decimals", async () => {
    // Scenario:
    // - decimalsBase = 18
    // - decimalsUsdc = 6
    // - reserveBase = 1.0 => 1e18 raw
    // - reserveUsdc = 0.4357 USDC => 0.4357 * 1e6 = 435700 raw
    //
    // Expected price = 0.4357 USDC per 1 base unit
    // With scalePow=8, scaled result = 0.4357 * 1e8 = 43_570_000
    const reserves: Reserves = {
      reserveBase: 1_000_000_000_000_000_000n,
      reserveUsdc: 435_700n,
      reserve0: 0n,
      reserve1: 0n,
      token0: "0x0000000000000000000000000000000000000000",
      token1: "0x0000000000000000000000000000000000",
    };

    const scalePow = 8;
    const out = await computePriceUsdcPerBaseScaled(reserves, 18, 6, scalePow);
    assert.equal(out, 43_570_000n);
  });
});
