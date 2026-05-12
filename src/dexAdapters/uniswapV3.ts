import { Contract, Interface, type JsonRpcProvider } from "ethers";
import type { BotConfig } from "../config";
import type { BotDirection, DexEvaluation, DexQuotePlan } from "../types";

const V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const V3_QUOTER = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const USDC_NATIVE_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_E_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const ZERO = "0x0000000000000000000000000000000000000000";

const FACTORY_ABI = [{ type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] }];
const POOL_ABI = [
  { type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint8" }, { type: "bool" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
];
const QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [{ type: "tuple", components: [{ type: "address", name: "tokenIn" }, { type: "address", name: "tokenOut" }, { type: "uint256", name: "amountIn" }, { type: "uint24", name: "fee" }, { type: "uint160", name: "sqrtPriceLimitX96" }] }],
    outputs: [{ type: "uint256" }, { type: "uint160" }, { type: "uint32" }, { type: "uint256" }],
  },
];
const POSITION_MANAGER_ABI = [
  { type: "function", name: "positions", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint96" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "int24" }, { type: "uint128" }, { type: "uint256" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" }] },
];

export type PoolIdentity = { pool: string; token0: string; token1: string; fee: number; usdcAddress: string; baseTokenAddress: string };
type QuoteResult = { amountOut: bigint; sqrtPriceX96After: bigint };

function abs(v: bigint): bigint { return v < 0n ? -v : v; }
function lower(a: string): string { return a.toLowerCase(); }

function isUsdcToken(addr: string, usdcCandidates: string[]): boolean {
  return usdcCandidates.some((u) => lower(u) === lower(addr));
}

function estimateVirtualReservesAtCurrentPrice(params: {
  liquidity: bigint;
  sqrtPriceX96: bigint;
  token0: string;
  token1: string;
  usdcAddress: string;
  baseTokenAddress: string;
}): { usdcRaw?: bigint; baseRaw?: bigint } {
  const { liquidity, sqrtPriceX96, token0, token1, usdcAddress, baseTokenAddress } = params;
  if (liquidity <= 0n || sqrtPriceX96 <= 0n) return {};
  const q96 = 2n ** 96n;
  const virtualToken0 = (liquidity * q96) / sqrtPriceX96;
  const virtualToken1 = (liquidity * sqrtPriceX96) / q96;
  const token0Lower = lower(token0);
  const token1Lower = lower(token1);
  const usdcLower = lower(usdcAddress);
  const baseLower = lower(baseTokenAddress);

  const usdcRaw = token0Lower === usdcLower
    ? virtualToken0
    : (token1Lower === usdcLower ? virtualToken1 : undefined);
  const baseRaw = token0Lower === baseLower
    ? virtualToken0
    : (token1Lower === baseLower ? virtualToken1 : undefined);
  return { usdcRaw, baseRaw };
}

export function priceScaledFromSqrt(params: {
  sqrtPriceX96: bigint;
  token0: string;
  token1: string;
  baseTokenAddress: string;
  usdcAddress: string;
  baseDecimals: number;
  usdcDecimals: number;
  scalePow: number;
}): bigint {
  const { sqrtPriceX96, token0, token1, baseTokenAddress, usdcAddress, baseDecimals, usdcDecimals, scalePow } = params;
  const ratio = sqrtPriceX96 * sqrtPriceX96;
  const q192 = 2n ** 192n;
  const scale = 10n ** BigInt(scalePow);
  const t0b = lower(token0) === lower(baseTokenAddress);
  const t1b = lower(token1) === lower(baseTokenAddress);
  const t0u = lower(token0) === lower(usdcAddress);
  const t1u = lower(token1) === lower(usdcAddress);
  if (!(t0b || t1b) || !(t0u || t1u)) throw new Error("Pool composition mismatch");

  if (t0b && t1u) {
    return (ratio * 10n ** BigInt(baseDecimals) * scale) / (q192 * 10n ** BigInt(usdcDecimals));
  }
  const basePerUsdc = (ratio * 10n ** BigInt(usdcDecimals) * scale) / (q192 * 10n ** BigInt(baseDecimals));
  if (basePerUsdc <= 0n) throw new Error("Invalid inverse price");
  return (scale * scale) / basePerUsdc;
}

async function quoteExactInputSingle(quoter: Contract, tokenIn: string, tokenOut: string, fee: number, amountIn: bigint): Promise<QuoteResult> {
  const out = await (quoter as any).quoteExactInputSingle.staticCall({
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    fee,
    sqrtPriceLimitX96: 0,
  });
  return { amountOut: BigInt(out[0].toString()), sqrtPriceX96After: BigInt(out[1].toString()) };
}

export async function detectUniswapV3Pool(config: BotConfig, provider: JsonRpcProvider): Promise<PoolIdentity> {
  const factoryAddress = config.uniswapV3.factoryAddress ?? V3_FACTORY;
  const factory = new Contract(factoryAddress, new Interface(FACTORY_ABI), provider);
  const positionManagerAddress = config.uniswapV3.positionManagerAddress ?? "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

  const usdcCandidates = [
    config.uniswapV3.usdcPrimaryAddress ?? USDC_NATIVE_POLYGON,
    config.uniswapV3.usdcSecondaryAddress ?? USDC_E_POLYGON,
  ].filter(Boolean) as string[];
  const fees = config.uniswapV3.poolFee ? [config.uniswapV3.poolFee] : [100, 500, 3000, 10000];

  if (config.uniswapV3.poolAddress) {
    const pool = new Contract(config.uniswapV3.poolAddress, POOL_ABI, provider);
    const [token0, token1, feeRaw] = await Promise.all([pool.token0(), pool.token1(), pool.fee()]);
    const t0Usdc = isUsdcToken(token0, usdcCandidates);
    const t1Usdc = isUsdcToken(token1, usdcCandidates);
    if (t0Usdc === t1Usdc) {
      throw new Error("UNISWAP_V3_POOL_ADDRESS must be a USDC/base pair (exactly one USDC candidate must match)");
    }
    const usdcAddress = t0Usdc ? token0 : token1;
    const baseTokenAddress = t0Usdc ? token1 : token0;
    return { pool: config.uniswapV3.poolAddress, token0, token1, fee: Number(feeRaw.toString()), usdcAddress, baseTokenAddress };
  }

  if (config.uniswapV3.positionTokenId) {
    const pm = new Contract(positionManagerAddress, POSITION_MANAGER_ABI, provider);
    const p = await pm.positions(config.uniswapV3.positionTokenId);
    const token0 = p[2] as string;
    const token1 = p[3] as string;
    const fee = Number(p[4].toString());
    const pool: string = await factory.getPool(token0, token1, fee);
    if (!pool || pool === ZERO) throw new Error(`POOL_NOT_FOUND for position=${config.uniswapV3.positionTokenId}`);
    const usdcAddress = isUsdcToken(token0, usdcCandidates) ? token0 : token1;
    const baseTokenAddress = lower(usdcAddress) === lower(token0) ? token1 : token0;
    return { pool, token0, token1, fee, usdcAddress, baseTokenAddress };
  }

  const base = config.uniswapV3.baseTokenAddress?.trim();
  if (!base) {
    throw new Error("UNISWAP_V3_BASE_TOKEN_ADDRESS is required for factory pool discovery");
  }

  let best: (PoolIdentity & { liquidity: bigint }) | null = null;
  for (const usdc of usdcCandidates) {
    for (const fee of fees) {
      const pool: string = await factory.getPool(base, usdc, fee);
      if (!pool || pool === ZERO) continue;
      const poolContract = new Contract(pool, POOL_ABI, provider);
      const [liquidityRaw, token0, token1] = await Promise.all([
        poolContract.liquidity(),
        poolContract.token0(),
        poolContract.token1(),
      ]);
      const liq = BigInt(liquidityRaw.toString());
      if (liq === 0n) continue;
      const candidate: PoolIdentity & { liquidity: bigint } = {
        pool,
        token0,
        token1,
        fee,
        usdcAddress: usdc,
        baseTokenAddress: base,
        liquidity: liq,
      };
      if (!best || candidate.liquidity > best.liquidity) best = candidate;
    }
  }
  if (best) {
    return {
      pool: best.pool,
      token0: best.token0,
      token1: best.token1,
      fee: best.fee,
      usdcAddress: best.usdcAddress,
      baseTokenAddress: best.baseTokenAddress,
    };
  }

  throw new Error("POOL_NOT_FOUND UniswapV3 base/USDC");
}

export async function buildUniswapV3Plan(params: {
  config: BotConfig;
  provider: JsonRpcProvider;
  targetPriceScaled: bigint;
  baseDecimals: number;
  usdcDecimals: number;
  maxTradeUsdcRaw: bigint;
  availableUsdcRaw?: bigint;
  availableBaseRaw?: bigint;
}): Promise<DexEvaluation> {
  if (!params.config.uniswapV3.enabled) return { dex: "uniswap_v3", plan: null, error: "disabled" };
  const { config, provider, targetPriceScaled, baseDecimals, usdcDecimals } = params;
  const availableUsdcRaw = params.availableUsdcRaw ?? params.maxTradeUsdcRaw;
  const availableBaseRaw = params.availableBaseRaw ?? (2n ** 255n);
  const pool = await detectUniswapV3Pool(config, provider);
  const poolContract = new Contract(pool.pool, POOL_ABI, provider);
  const [slot0, liquidityRaw] = await Promise.all([poolContract.slot0(), poolContract.liquidity()]);
  const poolLiquidityRaw = BigInt(liquidityRaw.toString());
  const sqrtPriceX96 = BigInt(slot0[0].toString());
  const virtualLiquidity = estimateVirtualReservesAtCurrentPrice({
    liquidity: poolLiquidityRaw,
    sqrtPriceX96,
    token0: pool.token0,
    token1: pool.token1,
    usdcAddress: pool.usdcAddress,
    baseTokenAddress: pool.baseTokenAddress,
  });
  const prePriceScaled = priceScaledFromSqrt({
    sqrtPriceX96,
    token0: pool.token0,
    token1: pool.token1,
    baseTokenAddress: pool.baseTokenAddress,
    usdcAddress: pool.usdcAddress,
    baseDecimals,
    usdcDecimals,
    scalePow: config.priceScalePow,
  });
  const diffBpsBefore = (abs(prePriceScaled - targetPriceScaled) * 10000n) / targetPriceScaled;
  if (diffBpsBefore <= BigInt(config.priceDeviationBps)) {
    return { dex: "uniswap_v3", prePriceScaled, diffBps: diffBpsBefore, plan: null };
  }

  const quoterAddress = config.uniswapV3.quoterAddress ?? V3_QUOTER;
  const quoter = new Contract(quoterAddress, new Interface(QUOTER_ABI), provider);
  const direction: BotDirection = prePriceScaled > targetPriceScaled ? "SELL_BASE_FOR_USDC" : "BUY_BASE_WITH_USDC";
  const tokenIn = direction === "BUY_BASE_WITH_USDC" ? pool.usdcAddress : pool.baseTokenAddress;
  const tokenOut = direction === "BUY_BASE_WITH_USDC" ? pool.baseTokenAddress : pool.usdcAddress;

  const evalCandidate = async (amountIn: bigint): Promise<{ ok: boolean; out: bigint; post: bigint; diff: bigint }> => {
    if (amountIn <= 0n) return { ok: false, out: 0n, post: prePriceScaled, diff: abs(prePriceScaled - targetPriceScaled) };
    try {
      const q = await quoteExactInputSingle(quoter, tokenIn, tokenOut, pool.fee, amountIn);
      if (q.sqrtPriceX96After <= 0n) return { ok: false, out: 0n, post: prePriceScaled, diff: abs(prePriceScaled - targetPriceScaled) };
      const post = priceScaledFromSqrt({
        sqrtPriceX96: q.sqrtPriceX96After,
        token0: pool.token0,
        token1: pool.token1,
        baseTokenAddress: pool.baseTokenAddress,
        usdcAddress: pool.usdcAddress,
        baseDecimals,
        usdcDecimals,
        scalePow: config.priceScalePow,
      });
      return { ok: true, out: q.amountOut, post, diff: abs(post - targetPriceScaled) };
    } catch {
      return { ok: false, out: 0n, post: prePriceScaled, diff: abs(prePriceScaled - targetPriceScaled) };
    }
  };

  const exactUpperBound = direction === "BUY_BASE_WITH_USDC"
    ? availableUsdcRaw
    : availableBaseRaw;

  const findMaxFeasibleInput = async (upperBound: bigint): Promise<bigint> => {
    if (upperBound <= 0n) return 0n;
    const upperProbe = await evalCandidate(upperBound);
    if (upperProbe.ok) return upperBound;
    let lo = 1n;
    let hi = upperBound;
    let best = 0n;
    for (let i = 0; i < config.singleTxMaxIters; i++) {
      if (lo > hi) break;
      const mid = (lo + hi) / 2n;
      const cand = await evalCandidate(mid);
      if (cand.ok) {
        best = mid;
        lo = mid + 1n;
      } else {
        hi = mid - 1n;
      }
    }
    return best;
  };

  const searchBest = async (upperBound: bigint): Promise<{ in: bigint; out: bigint; post: bigint; diff: bigint }> => {
    let lo = 1n;
    let hi = upperBound;
    let bestIn = 0n;
    let bestOut = 0n;
    let bestPost = prePriceScaled;
    let bestDiff = abs(prePriceScaled - targetPriceScaled);

    for (let i = 0; i < config.singleTxMaxIters; i++) {
      if (lo > hi || hi <= 0n) break;
      const mid = (lo + hi) / 2n;
      const cand = await evalCandidate(mid);
      if (cand.ok && cand.diff < bestDiff) {
        bestDiff = cand.diff;
        bestIn = mid;
        bestOut = cand.out;
        bestPost = cand.post;
      }
      const dbps = (cand.diff * 10000n) / targetPriceScaled;
      if (cand.ok && dbps <= BigInt(config.targetToleranceBps)) break;
      if (!cand.ok) {
        hi = mid - 1n;
        continue;
      }
      if (direction === "BUY_BASE_WITH_USDC") {
        if (cand.post < targetPriceScaled) lo = mid + 1n;
        else hi = mid - 1n;
      } else {
        if (cand.post > targetPriceScaled) lo = mid + 1n;
        else hi = mid - 1n;
      }
    }

    const step = bestIn > 0n ? (bestIn / 100n > 0n ? bestIn / 100n : 1n) : 1n;
    for (let j = -4; j <= 4; j++) {
      const candidateIn = bestIn + BigInt(j) * step;
      if (candidateIn <= 0n || candidateIn > upperBound) continue;
      const cand = await evalCandidate(candidateIn);
      if (cand.ok && cand.diff < bestDiff) {
        bestDiff = cand.diff;
        bestIn = candidateIn;
        bestOut = cand.out;
        bestPost = cand.post;
      }
    }

    return { in: bestIn, out: bestOut, post: bestPost, diff: bestDiff };
  };

  const maxFeasibleInput = await findMaxFeasibleInput(exactUpperBound);
  if (maxFeasibleInput <= 0n) {
    return { dex: "uniswap_v3", prePriceScaled, diffBps: diffBpsBefore, plan: null, error: "no-feasible-quote" };
  }
  const exact = await searchBest(maxFeasibleInput);

  if (exact.in <= 0n) {
    return { dex: "uniswap_v3", prePriceScaled, diffBps: diffBpsBefore, plan: null, error: "zero-amount-solve" };
  }
  const diffBpsAfter = (abs(exact.post - targetPriceScaled) * 10000n) / targetPriceScaled;
  const slippageBpsEstimate = exact.out > 0n ? BigInt(config.slippageBps) : 0n;
  const capLimited = maxFeasibleInput < exactUpperBound;

  const plan: DexQuotePlan = {
    dex: "uniswap_v3",
    direction,
    tokenIn,
    tokenOut,
    feeBps: pool.fee / 100,
    amountInRaw: exact.in,
    amountOutRaw: exact.out,
    prePriceScaled,
    postPriceScaled: exact.post,
    targetPriceScaled,
    diffBpsBefore,
    diffBpsAfter,
    slippageBpsEstimate,
    poolOrPairAddress: pool.pool,
    poolLiquidityText: "V3 active virtual liquidity (estimated)",
    tradeCalcText: `Binary search (balance-bounded optimization, feasible-domain constrained)`,
    poolUsdcRaw: virtualLiquidity.usdcRaw,
    poolBaseRaw: virtualLiquidity.baseRaw,
    poolLiquidityNote: `estimated from active liquidity at current tick (virtual reserves, not exact full-pool reserves); liquidity=${poolLiquidityRaw.toString()} raw; maxFeasibleInput=${maxFeasibleInput.toString()} raw`,
    requiredInputExactRaw: exact.in,
    chosenInputRaw: exact.in,
    capLimited,
    postTargetGapUsdcScaled: abs(exact.post - targetPriceScaled),
  };
  return { dex: "uniswap_v3", prePriceScaled, diffBps: diffBpsBefore, plan };
}
