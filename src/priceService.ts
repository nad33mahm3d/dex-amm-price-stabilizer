import { logger } from "./logger";

function parseDecimalToBigInt(value: string, scalePow: number): bigint {
  const s = value.trim();
  const negative = s.startsWith("-");
  const v = negative ? s.slice(1) : s;
  const [intPart, fracPartRaw = ""] = v.split(".");
  const fracPart = fracPartRaw.padEnd(scalePow, "0").slice(0, scalePow);
  const scaled = BigInt(intPart || "0") * 10n ** BigInt(scalePow) + BigInt(fracPart || "0");
  return negative ? -scaled : scaled;
}

async function fetchJson(url: string): Promise<any> {
  const fetchFn = (globalThis as any).fetch as undefined | ((...args: any[]) => Promise<any>);
  if (!fetchFn) {
    throw new Error("No global fetch() found. Use Node 18+ runtime.");
  }
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchApiTargetPriceScaled(params: {
  apiUrl: string;
  valueField: string;
  scalePow: number;
}): Promise<{ targetPriceScaled: bigint; rawValue: string }> {
  const { apiUrl, valueField, scalePow } = params;
  const payload = await fetchJson(apiUrl);
  const raw = typeof payload === "object" && payload !== null ? payload?.[valueField] : payload;
  if (raw === undefined || raw === null) {
    throw new Error(`API_FAILURE missing value field '${valueField}'`);
  }
  const rawStr = String(raw);
  if (/e/i.test(rawStr)) {
    // Keep strict input acceptance for deterministic fixed-point math.
    throw new Error(`API_FAILURE scientific notation not allowed: ${rawStr}`);
  }
  const targetPriceScaled = parseDecimalToBigInt(rawStr, scalePow);
  if (targetPriceScaled <= 0n) {
    throw new Error(`API_FAILURE non-positive target: ${rawStr}`);
  }
  logger.info("API_PRICE_FETCHED", { apiUrl, rawValue: rawStr, targetPriceScaled: targetPriceScaled.toString() });
  return { targetPriceScaled, rawValue: rawStr };
}

