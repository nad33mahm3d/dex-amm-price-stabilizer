import "dotenv/config";

export type BotConfig = {
  rpcUrl: string;
  privateKey: string;
  chainId: number;
  dryRun: boolean;

  // API is the single source of truth.
  apiUrl: string;
  indexApiValueField: string;
  priceScalePow: number;
  /** Ticker for logs (e.g. WETH). Default BASE. */
  baseTokenSymbol: string;

  priceDeviationBps: number;
  targetToleranceBps: number;
  singleTxMode: boolean;
  singleTxMaxIters: number;
  slippageBps: number;
  cooldownSeconds: number;
  pollIntervalSeconds: number;
  maxTradeUsdc: string;
  maxRetries: number;
  retryBaseDelayMs: number;

  uniswapV3: {
    enabled: boolean;
    routerAddress?: string;
    factoryAddress?: string;
    quoterAddress?: string;
    positionManagerAddress?: string;
    /** Required for factory pool discovery; optional if pool or position NFT is set. */
    baseTokenAddress?: string;
    usdcPrimaryAddress?: string;
    usdcSecondaryAddress?: string;
    poolAddress?: string;
    poolFee?: number;
    positionTokenId?: string;
  };

  quickswapV2: {
    enabled: boolean;
    routerAddress?: string;
    factoryAddress?: string;
    baseTokenAddress?: string;
    usdcPrimaryAddress?: string;
    usdcSecondaryAddress?: string;
  };
};

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function readEnvOptional(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvNumber(name: string, fallback?: number): number {
  const v = process.env[name];
  if (!v) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing env var: ${name}`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number env var: ${name}=${v}`);
  return n;
}

function readEnvBoolean(name: string, fallback?: boolean): boolean {
  const v = process.env[name];
  if (!v) return fallback ?? false;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`Invalid boolean env var: ${name}=${v} (expected true/false)`);
}

function validateDexConfig(c: BotConfig): void {
  if (c.uniswapV3.enabled) {
    const hasExplicitPool = Boolean(c.uniswapV3.poolAddress?.trim());
    const hasPosition = Boolean(c.uniswapV3.positionTokenId?.trim());
    const hasBase = Boolean(c.uniswapV3.baseTokenAddress?.trim());
    if (!hasExplicitPool && !hasPosition && !hasBase) {
      throw new Error(
        "ENABLE_UNISWAP_V3=true requires UNISWAP_V3_BASE_TOKEN_ADDRESS unless UNISWAP_V3_POOL_ADDRESS or UNISWAP_V3_POSITION_TOKEN_ID is set"
      );
    }
  }
  if (c.quickswapV2.enabled && !c.quickswapV2.baseTokenAddress?.trim()) {
    throw new Error("ENABLE_QUICKSWAP_V2=true requires QUICKSWAP_V2_BASE_TOKEN_ADDRESS");
  }
}

export function loadConfig(): BotConfig {
  const baseTokenSymbol = readEnvOptional("BASE_TOKEN_SYMBOL")?.trim() || "BASE";
  const config: BotConfig = {
    rpcUrl: readEnv("RPC_URL"),
    privateKey: readEnv("PRIVATE_KEY"),
    chainId: readEnvNumber("CHAIN_ID", 137),
    dryRun: readEnvBoolean("DRY_RUN", true),
    apiUrl: readEnv("INDEX_API_URL"),
    indexApiValueField: process.env["INDEX_API_VALUE_FIELD"]?.trim() || "value",
    priceScalePow: readEnvNumber("PRICE_SCALE_POW", 18),
    baseTokenSymbol,
    priceDeviationBps: readEnvNumber("PRICE_DEVIATION_BPS", 100),
    targetToleranceBps: readEnvNumber("TARGET_TOLERANCE_BPS", 50),
    singleTxMode: readEnvBoolean("SINGLE_TX_MODE", true),
    singleTxMaxIters: readEnvNumber("SINGLE_TX_MAX_ITERS", 18),
    slippageBps: readEnvNumber("SLIPPAGE_BPS", 50),
    cooldownSeconds: readEnvNumber("COOLDOWN_SECONDS", 60),
    pollIntervalSeconds: readEnvNumber("POLL_INTERVAL_SECONDS", 30),
    maxTradeUsdc: readEnv("MAX_TRADE_USDC"),
    maxRetries: readEnvNumber("MAX_RETRIES", 3),
    retryBaseDelayMs: readEnvNumber("RETRY_BASE_DELAY_MS", 1500),
    uniswapV3: {
      enabled: readEnvBoolean("ENABLE_UNISWAP_V3", true),
      routerAddress: readEnvOptional("UNISWAP_V3_ROUTER_ADDRESS"),
      factoryAddress: readEnvOptional("UNISWAP_V3_FACTORY_ADDRESS"),
      quoterAddress: readEnvOptional("UNISWAP_V3_QUOTER_ADDRESS"),
      positionManagerAddress: readEnvOptional("UNISWAP_V3_POSITION_MANAGER_ADDRESS"),
      baseTokenAddress: readEnvOptional("UNISWAP_V3_BASE_TOKEN_ADDRESS"),
      usdcPrimaryAddress: readEnvOptional("UNISWAP_V3_USDC_PRIMARY_ADDRESS"),
      usdcSecondaryAddress: readEnvOptional("UNISWAP_V3_USDC_SECONDARY_ADDRESS"),
      poolAddress: readEnvOptional("UNISWAP_V3_POOL_ADDRESS"),
      poolFee: process.env["UNISWAP_V3_POOL_FEE"] ? readEnvNumber("UNISWAP_V3_POOL_FEE") : undefined,
      positionTokenId: readEnvOptional("UNISWAP_V3_POSITION_TOKEN_ID"),
    },
    quickswapV2: {
      enabled: readEnvBoolean("ENABLE_QUICKSWAP_V2", true),
      routerAddress: readEnvOptional("QUICKSWAP_V2_ROUTER_ADDRESS"),
      factoryAddress: readEnvOptional("QUICKSWAP_V2_FACTORY_ADDRESS"),
      baseTokenAddress: readEnvOptional("QUICKSWAP_V2_BASE_TOKEN_ADDRESS"),
      usdcPrimaryAddress: readEnvOptional("QUICKSWAP_V2_USDC_PRIMARY_ADDRESS"),
      usdcSecondaryAddress: readEnvOptional("QUICKSWAP_V2_USDC_SECONDARY_ADDRESS"),
    },
  };
  validateDexConfig(config);
  return config;
}
