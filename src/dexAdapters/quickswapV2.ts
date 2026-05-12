import { Contract, Interface, type JsonRpcProvider } from "ethers";
import type { BotConfig } from "../config";
import type { BotDirection, DexEvaluation, DexQuotePlan } from "../types";

const QS_ROUTER = "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff";
const QS_FACTORY = "0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32";
const USDC_NATIVE_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_E_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const ZERO = "0x0000000000000000000000000000000000000000";

const FACTORY_ABI = [{ type: "function", name: "getPair", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "address" }] }];
const PAIR_ABI = [
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [{ type: "uint112" }, { type: "uint112" }, { type: "uint32" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];
const ROUTER_ABI = [{ type: "function", name: "getAmountsOut", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address[]" }], outputs: [{ type: "uint256[]" }] }];

function abs(v: bigint): bigint { return v < 0n ? -v : v; }
function lower(a: string): string { return a.toLowerCase(); }

export function priceScaledFromReserves(params: {
  reserveBase: bigint;
  reserveUsdc: bigint;
  baseDecimals: number;
  usdcDecimals: number;
  scalePow: number;
}): bigint {
  const { reserveBase, reserveUsdc, baseDecimals, usdcDecimals, scalePow } = params;
  const scale = 10n ** BigInt(scalePow);
  return (reserveUsdc * 10n ** BigInt(baseDecimals) * scale) / (reserveBase * 10n ** BigInt(usdcDecimals));
}

export function requiredInputToTargetV2(params: {
  targetPriceScaled: bigint;
  reserveBase: bigint;
  reserveUsdc: bigint;
  baseDecimals: number;
  usdcDecimals: number;
  scalePow: number;
}): { direction: BotDirection; amountInRaw: bigint } {
  const { targetPriceScaled, reserveBase, reserveUsdc, baseDecimals, usdcDecimals, scalePow } = params;
  const curr = priceScaledFromReserves({ reserveBase, reserveUsdc, baseDecimals, usdcDecimals, scalePow });
  if (curr === targetPriceScaled) return { direction: "BUY_BASE_WITH_USDC", amountInRaw: 0n };

  const k = reserveBase * reserveUsdc;
  const num = targetPriceScaled * 10n ** BigInt(usdcDecimals);
  const den = 10n ** BigInt(scalePow) * 10n ** BigInt(baseDecimals);

  const xPrime = bigintSqrt((k * den) / num);
  const yPrime = k / xPrime;
  if (curr < targetPriceScaled) {
    const dy = yPrime > reserveUsdc ? yPrime - reserveUsdc : 0n;
    return { direction: "BUY_BASE_WITH_USDC", amountInRaw: dy };
  }
  const dx = xPrime > reserveBase ? xPrime - reserveBase : 0n;
  return { direction: "SELL_BASE_FOR_USDC", amountInRaw: dx };
}

function bigintSqrt(v: bigint): bigint {
  if (v <= 0n) return 0n;
  let x0 = v;
  let x1 = (x0 + 1n) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x1 + v / x1) >> 1n;
  }
  return x0;
}

export async function buildQuickswapV2Plan(params: {
  config: BotConfig;
  provider: JsonRpcProvider;
  targetPriceScaled: bigint;
  baseDecimals: number;
  usdcDecimals: number;
  maxTradeUsdcRaw: bigint;
}): Promise<DexEvaluation> {
  if (!params.config.quickswapV2.enabled) return { dex: "quickswap_v2", plan: null, error: "disabled" };
  const { config, provider, targetPriceScaled, baseDecimals, usdcDecimals, maxTradeUsdcRaw } = params;
  const base = config.quickswapV2.baseTokenAddress?.trim();
  if (!base) {
    return { dex: "quickswap_v2", plan: null, error: "Missing QUICKSWAP_V2_BASE_TOKEN_ADDRESS" };
  }
  const usdcCandidates = [
    config.quickswapV2.usdcPrimaryAddress ?? USDC_NATIVE_POLYGON,
    config.quickswapV2.usdcSecondaryAddress ?? USDC_E_POLYGON,
  ].filter(Boolean) as string[];

  const factory = new Contract(config.quickswapV2.factoryAddress ?? QS_FACTORY, new Interface(FACTORY_ABI), provider);
  let pairAddress = ZERO;
  let usdcAddress = usdcCandidates[0];
  let reserveBase = 0n;
  let reserveUsdc = 0n;

  for (const usdc of usdcCandidates) {
    const p: string = await factory.getPair(base, usdc);
    if (!p || p === ZERO) continue;
    const pair = new Contract(p, PAIR_ABI, provider);
    const [t0, t1, reserves] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
    const r0 = BigInt(reserves[0].toString());
    const r1 = BigInt(reserves[1].toString());
    if (r0 === 0n || r1 === 0n) continue;
    const t0b = lower(t0) === lower(base);
    const rk = t0b ? r0 : r1;
    const ru = t0b ? r1 : r0;
    pairAddress = p;
    usdcAddress = usdc;
    reserveBase = rk;
    reserveUsdc = ru;
    break;
  }

  if (!pairAddress || pairAddress === ZERO) return { dex: "quickswap_v2", plan: null, error: "POOL_NOT_FOUND" };

  const prePriceScaled = priceScaledFromReserves({ reserveBase, reserveUsdc, baseDecimals, usdcDecimals, scalePow: config.priceScalePow });
  const diffBpsBefore = (abs(prePriceScaled - targetPriceScaled) * 10000n) / targetPriceScaled;
  if (diffBpsBefore <= BigInt(config.priceDeviationBps)) {
    return { dex: "quickswap_v2", prePriceScaled, diffBps: diffBpsBefore, plan: null };
  }

  const ideal = requiredInputToTargetV2({
    targetPriceScaled,
    reserveBase,
    reserveUsdc,
    baseDecimals,
    usdcDecimals,
    scalePow: config.priceScalePow,
  });

  const direction = ideal.direction;
  const tokenIn = direction === "BUY_BASE_WITH_USDC" ? usdcAddress : base;
  const tokenOut = direction === "BUY_BASE_WITH_USDC" ? base : usdcAddress;

  let amountInRaw = ideal.amountInRaw;
  if (direction === "BUY_BASE_WITH_USDC" && amountInRaw > maxTradeUsdcRaw) amountInRaw = maxTradeUsdcRaw;

  const router = new Contract(config.quickswapV2.routerAddress ?? QS_ROUTER, new Interface(ROUTER_ABI), provider);
  if (amountInRaw <= 0n) {
    return { dex: "quickswap_v2", prePriceScaled, diffBps: diffBpsBefore, plan: null, error: "zero-amount-solve" };
  }
  const outArr: any[] = await router.getAmountsOut(amountInRaw.toString(), [tokenIn, tokenOut]);
  const amountOutRaw = BigInt(outArr[1].toString());
  if (amountOutRaw <= 0n) {
    return { dex: "quickswap_v2", prePriceScaled, diffBps: diffBpsBefore, plan: null, error: "QUOTE_FAILURE" };
  }

  const feeMul = 997n;
  const feeDen = 1000n;
  let nextK = reserveBase;
  let nextU = reserveUsdc;
  if (direction === "BUY_BASE_WITH_USDC") {
    const inFee = (amountInRaw * feeMul) / feeDen;
    const out = (inFee * reserveBase) / (reserveUsdc + inFee);
    nextU = reserveUsdc + amountInRaw;
    nextK = reserveBase - out;
  } else {
    const inFee = (amountInRaw * feeMul) / feeDen;
    const out = (inFee * reserveUsdc) / (reserveBase + inFee);
    nextK = reserveBase + amountInRaw;
    nextU = reserveUsdc - out;
  }
  const postPriceScaled = priceScaledFromReserves({ reserveBase: nextK, reserveUsdc: nextU, baseDecimals, usdcDecimals, scalePow: config.priceScalePow });
  const diffBpsAfter = (abs(postPriceScaled - targetPriceScaled) * 10000n) / targetPriceScaled;
  const slippageBpsEstimate = BigInt(config.slippageBps);

  const plan: DexQuotePlan = {
    dex: "quickswap_v2",
    direction,
    tokenIn,
    tokenOut,
    feeBps: 30,
    amountInRaw,
    amountOutRaw,
    prePriceScaled,
    postPriceScaled,
    targetPriceScaled,
    diffBpsBefore,
    diffBpsAfter,
    slippageBpsEstimate,
    poolOrPairAddress: pairAddress,
    poolLiquidityText: "V2 reserves",
    tradeCalcText:
      `x*y=k (capped at ${maxTradeUsdcRaw.toString()} raw USDC)`,
    poolBaseRaw: reserveBase,
    poolUsdcRaw: reserveUsdc,
    poolLiquidityNote: "on-chain reserves",
  };
  return { dex: "quickswap_v2", prePriceScaled, diffBps: diffBpsBefore, plan };
}
