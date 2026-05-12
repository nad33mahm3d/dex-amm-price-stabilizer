import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDecimalToBigInt } from "../src/bot";

describe("parseDecimalToBigInt", () => {
  it("parses 0.4357 into 8-decimal fixed point", () => {
    const out = parseDecimalToBigInt("0.4357", 8);
    assert.equal(out, 43570000n);
  });

  it("truncates beyond scalePow fractional digits", () => {
    const out = parseDecimalToBigInt("0.435789", 8);
    // 0.435789 truncated to 8 decimals => 0.43578900 => 43578900
    assert.equal(out, 43578900n);
  });

  it("handles integer input", () => {
    const out = parseDecimalToBigInt("12", 8);
    assert.equal(out, 1200000000n);
  });

  it("handles negative values", () => {
    const out = parseDecimalToBigInt("-0.4357", 8);
    assert.equal(out, -43570000n);
  });
});

