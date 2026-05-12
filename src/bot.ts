import { Contract, Interface, JsonRpcProvider, Wallet, ethers } from "ethers";
import { createErc20 } from "./erc20";
import { approveIfNeeded } from "./quickswap";
import { type BotConfig, loadConfig } from "./config";
import { buildUniswapV3Plan, detectUniswapV3Pool } from "./dexAdapters/uniswapV3";
import { buildQuickswapV2Plan } from "./dexAdapters/quickswapV2";
import { logger } from "./logger";
import { fetchApiTargetPriceScaled } from "./priceService";
import type { DexEvaluation, DexQuotePlan } from "./types";

const V3_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{
      type: "tuple",
      components: [
        { type: "address", name: "tokenIn" },
        { type: "address", name: "tokenOut" },
        { type: "uint24", name: "fee" },
        { type: "address", name: "recipient" },
        { type: "uint256", name: "amountIn" },
        { type: "uint256", name: "amountOutMinimum" },
        { type: "uint160", name: "sqrtPriceLimitX96" },
      ],
    }],
    outputs: [{ type: "uint256" }],
  },
];
const V2_ROUTER_ABI = [
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "address[]" }, { type: "address" }, { type: "uint256" }],
    outputs: [{ type: "uint256[]" }],
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatScaledToDecimal(scaled: bigint, scalePow: number, maxFractionDigits = 10): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const base = 10n ** BigInt(scalePow);
  const intPart = abs / base;
  const fracRaw = (abs % base).toString().padStart(scalePow, "0");
  const fracTrimmed = fracRaw.slice(0, Math.max(0, maxFractionDigits)).replace(/0+$/, "");
  return `${negative ? "-" : ""}${intPart.toString()}${fracTrimmed.length > 0 ? `.${fracTrimmed}` : ""}`;
}

function formatTokenAmount(
  amountRaw: bigint,
  token: "USDC" | "BASE",
  usdcDecimals: number,
  baseDecimals: number,
  baseSymbol: string
): string {
  const decimals = token === "USDC" ? usdcDecimals : baseDecimals;
  return `${ethers.formatUnits(amountRaw, decimals)} ${token === "USDC" ? "USDC" : baseSymbol}`;
}

function deriveDecisionFromPlan(params: {
  plan: DexQuotePlan | null;
  slippageBps: number;
  priceScalePow: number;
  usdcDecimals: number;
  baseDecimals: number;
  baseSymbol: string;
}): Record<string, unknown> | null {
  const { plan, slippageBps, priceScalePow, usdcDecimals, baseDecimals, baseSymbol } = params;
  if (!plan) return null;
  const pricePair = `USDC/${baseSymbol}`;
  const inputToken: "USDC" | "BASE" = plan.direction === "BUY_BASE_WITH_USDC" ? "USDC" : "BASE";
  const outputToken: "USDC" | "BASE" = plan.direction === "BUY_BASE_WITH_USDC" ? "BASE" : "USDC";
  const feeTierBps = plan.feeBps ?? 30;
  const estimatedFeeInputRaw = (plan.amountInRaw * BigInt(feeTierBps)) / 10000n;
  const amountOutMinRaw = (plan.amountOutRaw * (10000n - BigInt(slippageBps))) / 10000n;
  const minOutImpactRaw = plan.amountOutRaw - amountOutMinRaw;

  return {
    dex: plan.dex,
    direction: plan.direction,
    inputToken: inputToken === "USDC" ? "USDC" : baseSymbol,
    outputToken: outputToken === "USDC" ? "USDC" : baseSymbol,
    inputAmount: formatTokenAmount(plan.amountInRaw, inputToken, usdcDecimals, baseDecimals, baseSymbol),
    inputAmountValue: ethers.formatUnits(
      plan.amountInRaw,
      inputToken === "USDC" ? usdcDecimals : baseDecimals
    ),
    outputAmount: formatTokenAmount(plan.amountOutRaw, outputToken, usdcDecimals, baseDecimals, baseSymbol),
    outputAmountValue: ethers.formatUnits(
      plan.amountOutRaw,
      outputToken === "USDC" ? usdcDecimals : baseDecimals
    ),
    feeTierBps: `${feeTierBps} bps`,
    estimatedFeeAmount: formatTokenAmount(estimatedFeeInputRaw, inputToken, usdcDecimals, baseDecimals, baseSymbol),
    slippageBps: `${slippageBps} bps`,
    amountOutMin: formatTokenAmount(amountOutMinRaw, outputToken, usdcDecimals, baseDecimals, baseSymbol),
    amountOutMinValue: ethers.formatUnits(
      amountOutMinRaw,
      outputToken === "USDC" ? usdcDecimals : baseDecimals
    ),
    minOutImpact: formatTokenAmount(minOutImpactRaw, outputToken, usdcDecimals, baseDecimals, baseSymbol),
    expectedResidualBps: `${plan.diffBpsAfter.toString()} bps`,
    expectedPostPrice: `${formatScaledToDecimal(plan.postPriceScaled, priceScalePow, 12)} ${pricePair}`,
    targetPrice: `${formatScaledToDecimal(plan.targetPriceScaled, priceScalePow, 12)} ${pricePair}`,
    postTargetGapUsdc: plan.postTargetGapUsdcScaled !== undefined
      ? formatScaledToDecimal(plan.postTargetGapUsdcScaled, priceScalePow, 12)
      : formatScaledToDecimal((plan.postPriceScaled > plan.targetPriceScaled ? plan.postPriceScaled - plan.targetPriceScaled : plan.targetPriceScaled - plan.postPriceScaled), priceScalePow, 12),
    requiredInputExact: plan.requiredInputExactRaw !== undefined
      ? formatTokenAmount(plan.requiredInputExactRaw, inputToken, usdcDecimals, baseDecimals, baseSymbol)
      : "N/A",
    chosenInput: plan.chosenInputRaw !== undefined
      ? formatTokenAmount(plan.chosenInputRaw, inputToken, usdcDecimals, baseDecimals, baseSymbol)
      : formatTokenAmount(plan.amountInRaw, inputToken, usdcDecimals, baseDecimals, baseSymbol),
    capLimited: plan.capLimited !== undefined ? String(plan.capLimited) : "false",
    poolLiquidity: plan.poolLiquidityText ?? "n/a",
    poolLiquidityUsdc: plan.poolUsdcRaw !== undefined
      ? `${ethers.formatUnits(plan.poolUsdcRaw, usdcDecimals)} USDC`
      : "N/A",
    poolLiquidityBase: plan.poolBaseRaw !== undefined
      ? `${ethers.formatUnits(plan.poolBaseRaw, baseDecimals)} ${baseSymbol}`
      : "N/A",
    poolLiquidityNote: plan.poolLiquidityNote ?? "",
    tradeCalculation: plan.tradeCalcText ?? "n/a",
    bpsMeaning: "1 bps = 0.01%",
  };
}

// Exported for tests.
export function parseDecimalToBigInt(value: string, scalePow: number): bigint {
  const s = value.trim();
  const negative = s.startsWith("-");
  const v = negative ? s.slice(1) : s;
  const [intPart, fracPartRaw = ""] = v.split(".");
  const fracPart = fracPartRaw.padEnd(scalePow, "0").slice(0, scalePow);
  const scaled = BigInt(intPart || "0") * 10n ** BigInt(scalePow) + BigInt(fracPart || "0");
  return negative ? -scaled : scaled;
}

async function withRetries<T>(
  opName: string,
  maxRetries: number,
  baseDelayMs: number,
  fn: () => Promise<T>
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
      const backoff = baseDelayMs * 2 ** attempt;
      logger.warn("RETRY_BACKOFF", { opName, attempt: attempt + 1, backoffMs: backoff, error: String(err) });
      await sleep(backoff);
    }
    attempt += 1;
  }
  throw lastError;
}

function getRouterForPlan(plan: DexQuotePlan, config: BotConfig, signer: Wallet): Contract {
  if (plan.dex === "uniswap_v3") {
    return new Contract(
      config.uniswapV3.routerAddress ?? "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      new Interface(V3_ROUTER_ABI),
      signer
    );
  }
  return new Contract(
    config.quickswapV2.routerAddress ?? "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
    new Interface(V2_ROUTER_ABI),
    signer
  );
}

async function executePlan(params: {
  plan: DexQuotePlan;
  config: BotConfig;
  signer: Wallet;
  amountOutMin: bigint;
  recipient: string;
}): Promise<string | null> {
  const { plan, config, signer, amountOutMin, recipient } = params;
  const router = getRouterForPlan(plan, config, signer);
  const routerAddress = await router.getAddress();
  await approveIfNeeded({
    tokenAddress: plan.tokenIn,
    owner: signer,
    routerAddress,
    amountIn: plan.amountInRaw,
    dryRun: config.dryRun,
  });
  if (config.dryRun) return null;

  if (plan.dex === "uniswap_v3") {
    const tx = await (router as any).exactInputSingle({
      tokenIn: plan.tokenIn,
      tokenOut: plan.tokenOut,
      fee: Math.round((plan.feeBps ?? 30) * 100),
      recipient,
      amountIn: plan.amountInRaw.toString(),
      amountOutMinimum: amountOutMin.toString(),
      sqrtPriceLimitX96: 0,
    });
    await tx.wait();
    return tx.hash as string;
  }

  const deadline = Math.floor(Date.now() / 1000) + 120;
  const tx = await (router as any).swapExactTokensForTokens(
    plan.amountInRaw.toString(),
    amountOutMin.toString(),
    [plan.tokenIn, plan.tokenOut],
    recipient,
    deadline
  );
  await tx.wait();
  return tx.hash as string;
}

async function resolveBaseTokenAddress(config: BotConfig, provider: JsonRpcProvider): Promise<string> {
  let base =
    (config.uniswapV3.baseTokenAddress ?? config.quickswapV2.baseTokenAddress)?.trim() || "";
  if (
    !base &&
    config.uniswapV3.enabled &&
    (Boolean(config.uniswapV3.poolAddress?.trim()) || Boolean(config.uniswapV3.positionTokenId?.trim()))
  ) {
    const pool = await detectUniswapV3Pool(config, provider);
    base = pool.baseTokenAddress;
  }
  if (!base) {
    throw new Error(
      "Could not resolve base token address: set UNISWAP_V3_BASE_TOKEN_ADDRESS and/or QUICKSWAP_V2_BASE_TOKEN_ADDRESS, or configure UNISWAP_V3_POOL_ADDRESS / UNISWAP_V3_POSITION_TOKEN_ID for inference"
    );
  }
  if (config.uniswapV3.enabled && config.quickswapV2.enabled) {
    const v3 = config.uniswapV3.baseTokenAddress?.trim();
    const qs = config.quickswapV2.baseTokenAddress?.trim();
    if (v3 && qs && v3.toLowerCase() !== qs.toLowerCase()) {
      throw new Error(
        "When both adapters are enabled, UNISWAP_V3_BASE_TOKEN_ADDRESS and QUICKSWAP_V2_BASE_TOKEN_ADDRESS must refer to the same token"
      );
    }
  }
  return base;
}

export async function runBot(config: BotConfig): Promise<void> {
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);
  const wallet = new Wallet(config.privateKey, provider);

  const baseAddr = await resolveBaseTokenAddress(config, provider);
  const usdcAddr =
    config.uniswapV3.usdcPrimaryAddress ??
    config.quickswapV2.usdcPrimaryAddress ??
    "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

  const baseToken = createErc20(baseAddr, provider);
  const usdcToken = createErc20(usdcAddr, provider);
  const baseDecimals = Number((await baseToken.decimals()).toString());
  const usdcDecimals = Number((await usdcToken.decimals()).toString());
  const maxTradeUsdcRaw = ethers.parseUnits(config.maxTradeUsdc, usdcDecimals);
  const baseSymbol = config.baseTokenSymbol;

  logger.info("BOT_START", {
    chainId: config.chainId,
    wallet: wallet.address,
    dryRun: config.dryRun,
    enabledDexes: {
      uniswap_v3: config.uniswapV3.enabled,
      quickswap_v2: config.quickswapV2.enabled,
    },
  });

  let cycle = 0;
  let lastTradeAtMs = 0;

  while (true) {
    cycle += 1;
    logger.info("CYCLE_START", { cycle, pollIntervalSec: config.pollIntervalSeconds, cooldownSec: config.cooldownSeconds });
    const now = Date.now();
    if (lastTradeAtMs > 0 && now - lastTradeAtMs < config.cooldownSeconds * 1000) {
      const remaining = config.cooldownSeconds * 1000 - (now - lastTradeAtMs);
      logger.info("COOLDOWN_ACTIVE", { cycle, remainingMs: remaining });
      await sleep(Math.min(remaining, config.pollIntervalSeconds * 1000));
      continue;
    }

    let targetPriceScaled: bigint;
    try {
      const api = await withRetries(
        "api_target_fetch",
        config.maxRetries,
        config.retryBaseDelayMs,
        async () =>
          fetchApiTargetPriceScaled({
            apiUrl: config.apiUrl,
            valueField: config.indexApiValueField,
            scalePow: config.priceScalePow,
          })
      );
      targetPriceScaled = api.targetPriceScaled;
    } catch (err) {
      logger.error("API_FAILURE", { cycle, apiUrl: config.apiUrl, error: String(err), action: "skip_cycle" });
      await sleep(config.pollIntervalSeconds * 1000);
      continue;
    }

    const [balBaseRaw, balUsdcRaw] = await Promise.all([
      (baseToken as any).balanceOf(wallet.address),
      (usdcToken as any).balanceOf(wallet.address),
    ]);
    const walletBase = BigInt(balBaseRaw.toString());
    const walletUsdc = BigInt(balUsdcRaw.toString());

    const evaluations: DexEvaluation[] = [];
    for (const dexOp of [
      async () =>
        buildUniswapV3Plan({
          config,
          provider,
          targetPriceScaled,
          baseDecimals,
          usdcDecimals,
          maxTradeUsdcRaw,
          availableUsdcRaw: walletUsdc,
          availableBaseRaw: walletBase,
        }),
      async () =>
        buildQuickswapV2Plan({
          config,
          provider,
          targetPriceScaled,
          baseDecimals,
          usdcDecimals,
          maxTradeUsdcRaw,
        }),
    ]) {
      try {
        const out = await withRetries("dex_eval", config.maxRetries, config.retryBaseDelayMs, dexOp);
        evaluations.push(out);
      } catch (err) {
        evaluations.push({ dex: evaluations.length === 0 ? "uniswap_v3" : "quickswap_v2", plan: null, error: String(err) });
      }
    }

    const pricePair = `USDC/${baseSymbol}`;
    const planRows = evaluations
      .filter((e): e is DexEvaluation & { plan: DexQuotePlan } => Boolean(e.plan))
      .map((e, index) => {
        const decision = deriveDecisionFromPlan({
          plan: e.plan,
          slippageBps: config.slippageBps,
          priceScalePow: config.priceScalePow,
          usdcDecimals,
          baseDecimals,
          baseSymbol,
        });
        return {
          dexSlot: `DEX ${index + 1}`,
          dex: e.plan.dex,
          ...decision,
        };
      });

    const winnerRecommendation = planRows.length > 0
      ? {
          summary: "Execute stabilization on all valid DEX plans this cycle",
          plans: planRows,
        }
      : null;

    logger.info("CYCLE_STATE", {
      cycle,
      baseTokenSymbol: baseSymbol,
      targetPriceUsdcPerBase: formatScaledToDecimal(targetPriceScaled, config.priceScalePow, 12),
      walletBaseUnits: `${ethers.formatUnits(walletBase, baseDecimals)} ${baseSymbol}`,
      walletUsdcUnits: `${ethers.formatUnits(walletUsdc, usdcDecimals)} USDC`,
      dexEvaluations: evaluations.map((e) => ({
        dex: e.dex,
        prePrice: e.prePriceScaled !== undefined
          ? `${formatScaledToDecimal(e.prePriceScaled, config.priceScalePow, 12)} ${pricePair}`
          : undefined,
        diffBps: e.diffBps !== undefined ? `${e.diffBps.toString()} bps` : undefined,
        hasPlan: Boolean(e.plan),
        error: e.error,
      })),
      chosenDexes: planRows.map((r) => r.dex).join(", "),
      winnerRecommendation,
    });

    const executablePlans = evaluations
      .map((e) => e.plan)
      .filter((p): p is DexQuotePlan => p !== null);

    if (executablePlans.length === 0) {
      logger.info("NO_ACTION", { cycle, reason: "no_plan_above_threshold_or_quote_failed" });
      await sleep(config.pollIntervalSeconds * 1000);
      continue;
    }

    let executedAny = false;

    for (const plan of executablePlans) {
      if (plan.direction === "BUY_BASE_WITH_USDC" && walletUsdc < plan.amountInRaw) {
        logger.warn("INSUFFICIENT_BALANCE", {
          cycle,
          dex: plan.dex,
          direction: plan.direction,
          haveUsdc: `${ethers.formatUnits(walletUsdc, usdcDecimals)} USDC`,
          needUsdc: `${ethers.formatUnits(plan.amountInRaw, usdcDecimals)} USDC`,
        });
        continue;
      }
      if (plan.direction === "SELL_BASE_FOR_USDC" && walletBase < plan.amountInRaw) {
        logger.warn("INSUFFICIENT_BALANCE", {
          cycle,
          dex: plan.dex,
          direction: plan.direction,
          haveBase: `${ethers.formatUnits(walletBase, baseDecimals)} ${baseSymbol}`,
          needBase: `${ethers.formatUnits(plan.amountInRaw, baseDecimals)} ${baseSymbol}`,
        });
        continue;
      }

      const amountOutMin = (plan.amountOutRaw * (10000n - BigInt(config.slippageBps))) / 10000n;
      if (amountOutMin <= 0n) {
        logger.warn("SLIPPAGE_GUARD", {
          cycle,
          dex: plan.dex,
          amountOut: plan.amountOutRaw.toString(),
          amountOutMin: amountOutMin.toString(),
        });
        continue;
      }

      logger.info("TRADE_PLAN", {
        cycle,
        dex: plan.dex,
        dexSlot: planRows.find((r) => r.dex === plan.dex)?.dexSlot ?? plan.dex,
        direction: plan.direction,
        poolOrPair: plan.poolOrPairAddress,
        inputRawUnits: `${plan.amountInRaw.toString()} raw`,
        outputRawUnits: `${plan.amountOutRaw.toString()} raw`,
        inputAmount: `${ethers.formatUnits(plan.amountInRaw, plan.direction === "BUY_BASE_WITH_USDC" ? usdcDecimals : baseDecimals)} ${
          plan.direction === "BUY_BASE_WITH_USDC" ? "USDC" : baseSymbol
        }`,
        outputAmount: `${ethers.formatUnits(plan.amountOutRaw, plan.direction === "BUY_BASE_WITH_USDC" ? baseDecimals : usdcDecimals)} ${
          plan.direction === "BUY_BASE_WITH_USDC" ? baseSymbol : "USDC"
        }`,
        prePrice: `${formatScaledToDecimal(plan.prePriceScaled, config.priceScalePow, 12)} ${pricePair}`,
        postPrice: `${formatScaledToDecimal(plan.postPriceScaled, config.priceScalePow, 12)} ${pricePair}`,
        targetPrice: `${formatScaledToDecimal(plan.targetPriceScaled, config.priceScalePow, 12)} ${pricePair}`,
        diffBpsBefore: `${plan.diffBpsBefore.toString()} bps`,
        diffBpsAfter: `${plan.diffBpsAfter.toString()} bps`,
        dryRun: config.dryRun,
      });

      try {
        const txHash = await executePlan({
          plan,
          config,
          signer: wallet,
          amountOutMin,
          recipient: wallet.address,
        });
        logger.info("TRADE_RESULT", {
          cycle,
          dex: plan.dex,
          dexSlot: planRows.find((r) => r.dex === plan.dex)?.dexSlot ?? plan.dex,
          dryRun: config.dryRun,
          txHash: txHash ?? "SIMULATED",
        });
        executedAny = true;
      } catch (err) {
        logger.error("TX_REVERT", { cycle, dex: plan.dex, error: String(err) });
      }
    }

    if (executedAny) {
      lastTradeAtMs = Date.now();
    }

    await sleep(config.pollIntervalSeconds * 1000);
  }
}

export async function main(): Promise<void> {
  const config = loadConfig();
  await runBot(config);
}
