import Table from "cli-table3";
import pc from "picocolors";

type LogLevel = "INFO" | "WARN" | "ERROR";
type PlainObject = Record<string, unknown>;

function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (v === null || v === undefined) return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "[unserializable]";
  }
}

function levelLabel(level: LogLevel): string {
  if (level === "ERROR") return pc.red("ERROR");
  if (level === "WARN") return pc.yellow("WARN");
  return pc.cyan("INFO");
}

function blockTitle(level: LogLevel, event: string): string {
  return `${levelLabel(level)} ${pc.bold(event)}`;
}

function renderKeyValueTable(data: PlainObject): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return "";

  const table = new Table({
    chars: {
      top: "-",
      "top-mid": "+",
      "top-left": "+",
      "top-right": "+",
      bottom: "-",
      "bottom-mid": "+",
      "bottom-left": "+",
      "bottom-right": "+",
      left: "|",
      "left-mid": "+",
      mid: "-",
      "mid-mid": "+",
      right: "|",
      "right-mid": "+",
      middle: "|",
    },
    style: { head: [], border: [] },
    colWidths: [22, 90],
    wordWrap: true,
  });

  for (const [k, v] of Object.entries(data)) {
    table.push([pc.bold(k), asText(v)]);
  }
  return table.toString();
}

function renderDexTable(rows: unknown): string {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const table = new Table({
    head: ["DEX", "PrePrice", "DiffBps", "HasPlan", "Error"],
    style: { head: [], border: [] },
    chars: {
      top: "-",
      "top-mid": "+",
      "top-left": "+",
      "top-right": "+",
      bottom: "-",
      "bottom-mid": "+",
      "bottom-left": "+",
      "bottom-right": "+",
      left: "|",
      "left-mid": "+",
      mid: "-",
      "mid-mid": "+",
      right: "|",
      "right-mid": "+",
      middle: "|",
    },
    wordWrap: true,
  });
  for (const row of rows as PlainObject[]) {
    table.push([
      asText(row.dex),
      asText(row.prePrice),
      asText(row.diffBps),
      asText(row.hasPlan),
      asText(row.error),
    ]);
  }
  return table.toString();
}

function extractPlanMap(rows: unknown): Record<string, PlainObject> {
  const map: Record<string, PlainObject> = {};
  if (!Array.isArray(rows)) return map;
  for (const row of rows as PlainObject[]) {
    const dex = asText(row.dex);
    if (dex) map[dex] = row;
  }
  return map;
}

function extractEvalMap(rows: unknown): Record<string, PlainObject> {
  const map: Record<string, PlainObject> = {};
  if (!Array.isArray(rows)) return map;
  for (const row of rows as PlainObject[]) {
    const dex = asText(row.dex);
    if (dex) map[dex] = row;
  }
  return map;
}

function parseNumericFromText(input: unknown): number | null {
  const s = asText(input);
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function formatUsdcDiff(prePrice: unknown, targetPrice: unknown): string {
  const pre = parseNumericFromText(prePrice);
  const target = parseNumericFromText(targetPrice);
  if (pre === null || target === null) return "N/A";
  return Math.abs(pre - target).toFixed(12);
}

function renderDexEvaluationComparisonTable(
  evals: unknown,
  plans: unknown,
  targetPriceUsdc: unknown,
  baseTokenSymbol: string
): string {
  const evalMap = extractEvalMap(evals);
  const planMap = extractPlanMap(plans);
  const dexA = "quickswap_v2";
  const dexB = "uniswap_v3";
  const aEval = evalMap[dexA] ?? {};
  const bEval = evalMap[dexB] ?? {};
  const aPlan = planMap[dexA] ?? {};
  const bPlan = planMap[dexB] ?? {};
  const priceSuffix = ` USDC/${baseTokenSymbol}`;

  const table = new Table({
    head: ["Key Metrics", dexA, dexB],
    style: { head: [], border: [] },
    chars: {
      top: "-",
      "top-mid": "+",
      "top-left": "+",
      "top-right": "+",
      bottom: "-",
      "bottom-mid": "+",
      "bottom-left": "+",
      "bottom-right": "+",
      left: "|",
      "left-mid": "+",
      mid: "-",
      "mid-mid": "+",
      right: "|",
      "right-mid": "+",
      middle: "|",
    },
    wordWrap: true,
    colWidths: [22, 54, 54],
  });

  const row = (label: string, a: unknown, b: unknown): void => {
    table.push([pc.bold(label), asText(a), asText(b)]);
  };

  row("Price", asText(aEval.prePrice).replace(priceSuffix, ""), asText(bEval.prePrice).replace(priceSuffix, ""));
  row("Target Price (USDC)", asText(targetPriceUsdc), asText(targetPriceUsdc));
  row("Diff (bps)", asText(aEval.diffBps).replace(" bps", ""), asText(bEval.diffBps).replace(" bps", ""));
  row(
    "Diff (USDC)",
    formatUsdcDiff(aEval.prePrice, targetPriceUsdc),
    formatUsdcDiff(bEval.prePrice, targetPriceUsdc)
  );
  row("Action", asText(aPlan.direction), asText(bPlan.direction));
  row("Input (USDC)", asText(aPlan.inputAmountValue), asText(bPlan.inputAmountValue));
  row("Input (USDC) Calculation", asText(aPlan.tradeCalculation), asText(bPlan.tradeCalculation));
  row("Required Input (Exact)", asText(aPlan.requiredInputExact), asText(bPlan.requiredInputExact));
  row("Chosen Input", asText(aPlan.chosenInput), asText(bPlan.chosenInput));
  row("Cap Limited", asText(aPlan.capLimited), asText(bPlan.capLimited));
  row(`Output (${baseTokenSymbol})`, asText(aPlan.outputAmountValue), asText(bPlan.outputAmountValue));
  row(
    "Post Price (USDC)",
    asText(aPlan.expectedPostPrice).replace(priceSuffix, ""),
    asText(bPlan.expectedPostPrice).replace(priceSuffix, "")
  );
  row("Fee", `${asText(aPlan.feeTierBps)} (${asText(aPlan.estimatedFeeAmount)})`, `${asText(bPlan.feeTierBps)} (${asText(bPlan.estimatedFeeAmount)})`);
  row("Slippage", asText(aPlan.slippageBps), asText(bPlan.slippageBps));
  row(`Min Output (${baseTokenSymbol})`, asText(aPlan.amountOutMinValue), asText(bPlan.amountOutMinValue));
  row("Residual (bps)", asText(aPlan.expectedResidualBps).replace(" bps", ""), asText(bPlan.expectedResidualBps).replace(" bps", ""));
  row("Post-Target Gap (USDC)", asText(aPlan.postTargetGapUsdc), asText(bPlan.postTargetGapUsdc));
  row("Liquidity Type", asText(aPlan.poolLiquidity), asText(bPlan.poolLiquidity));
  row("Liquidity (USDC)", asText(aPlan.poolLiquidityUsdc), asText(bPlan.poolLiquidityUsdc));
  row(`Liquidity (${baseTokenSymbol})`, asText(aPlan.poolLiquidityBase), asText(bPlan.poolLiquidityBase));
  row("bps Meaning", "1 bps = 0.01%", "1 bps = 0.01%");

  return table.toString();
}

function omit(data: PlainObject, keys: string[]): PlainObject {
  const out: PlainObject = {};
  for (const [k, v] of Object.entries(data)) {
    if (!keys.includes(k)) out[k] = v;
  }
  return out;
}

function logLines(level: LogLevel, lines: string[]): void {
  for (const line of lines) {
    if (level === "ERROR") console.error(line);
    else if (level === "WARN") console.warn(line);
    else console.log(line);
  }
}

function emit(level: LogLevel, event: string, data: PlainObject): void {
  const ts = new Date().toISOString();
  const lines: string[] = [];
  lines.push(pc.gray(`[${ts}]`) + " " + blockTitle(level, event));

  if (event === "CYCLE_STATE") {
    const top = omit(data, ["dexEvaluations", "winnerRecommendation"]);
    const topTable = renderKeyValueTable(top);
    if (topTable) lines.push(topTable);
    lines.push(pc.bold("DEX Evaluation"));
    if (data.winnerRecommendation && typeof data.winnerRecommendation === "object") {
      const winner = data.winnerRecommendation as PlainObject;
      const winnerSummary = renderKeyValueTable(omit(winner, ["plans"]));
      if (winnerSummary) lines.push(winnerSummary);
      const sym = typeof data.baseTokenSymbol === "string" && data.baseTokenSymbol.length > 0 ? data.baseTokenSymbol : "BASE";
      const winnerPlans = renderDexEvaluationComparisonTable(
        data.dexEvaluations,
        winner.plans,
        data.targetPriceUsdcPerBase,
        sym
      );
      if (winnerPlans) lines.push(winnerPlans);
    } else {
      const dexTable = renderDexTable(data.dexEvaluations);
      if (dexTable) lines.push(dexTable);
    }
  } else {
    const table = renderKeyValueTable(data);
    if (table) lines.push(table);
  }

  lines.push("");
  logLines(level, lines);
}

export const logger = {
  info(event: string, data: PlainObject = {}): void {
    emit("INFO", event, data);
  },
  warn(event: string, data: PlainObject = {}): void {
    emit("WARN", event, data);
  },
  error(event: string, data: PlainObject = {}): void {
    emit("ERROR", event, data);
  },
};
