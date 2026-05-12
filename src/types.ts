export type BigNumberish = bigint;

export type BotDirection = "SELL_BASE_FOR_USDC" | "BUY_BASE_WITH_USDC";

export type DexName = "uniswap_v3" | "quickswap_v2";

export type DexQuotePlan = {
  dex: DexName;
  direction: BotDirection;
  tokenIn: string;
  tokenOut: string;
  feeBps?: number;
  amountInRaw: bigint;
  amountOutRaw: bigint;
  prePriceScaled: bigint;
  postPriceScaled: bigint;
  targetPriceScaled: bigint;
  diffBpsBefore: bigint;
  diffBpsAfter: bigint;
  slippageBpsEstimate: bigint;
  poolOrPairAddress: string;
  poolLiquidityText?: string;
  tradeCalcText?: string;
  poolBaseRaw?: bigint;
  poolUsdcRaw?: bigint;
  poolLiquidityNote?: string;
  requiredInputExactRaw?: bigint;
  chosenInputRaw?: bigint;
  capLimited?: boolean;
  postTargetGapUsdcScaled?: bigint;
};

export type DexEvaluation = {
  dex: DexName;
  prePriceScaled?: bigint;
  diffBps?: bigint;
  plan: DexQuotePlan | null;
  error?: string;
};
