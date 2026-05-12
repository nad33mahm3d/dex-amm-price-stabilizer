# dex-amm-price-stabilizer

Node.js / TypeScript service that compares **on-chain USDC per base token** prices (Uniswap V3 and/or QuickSwap V2 on Polygon by default) against a **target price from your HTTP JSON API**, then submits bounded trades to move spot toward that target. Intended for **experienced operators** who run their own infrastructure, custody, and risk controls.

**Package name:** `dex-amm-price-stabilizer` ([`package.json`](package.json)).

[![CI](https://github.com/nad33mahm3d/dex-amm-price-stabilizer/actions/workflows/ci.yml/badge.svg)](https://github.com/nad33mahm3d/dex-amm-price-stabilizer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## License

Released under the [MIT License](LICENSE). You may use, modify, and distribute the code subject to that license. The software is provided **as-is**; the legal disclaimer in this README still applies.

## Community

- [Contributing](CONTRIBUTING.md) — how to run tests and open PRs  
- [Security](SECURITY.md) — how to report vulnerabilities  

## Requirements

- **Node.js 18+** (global `fetch` is required; see [`src/priceService.ts`](src/priceService.ts)).
- **npm** (or compatible client) for install and scripts.
- A JSON **price API** you control, an **RPC endpoint**, and a **hot wallet** funded with the assets you trade (base token + USDC) plus native gas (e.g. POL on Polygon).

## What this software does

1. On each poll interval, **GET** `INDEX_API_URL`, read a decimal string from `INDEX_API_VALUE_FIELD` (default `value`), and scale it by `PRICE_SCALE_POW` to a fixed-point bigint.
2. For each enabled DEX adapter, compute whether the live pool price is far enough from the target (`PRICE_DEVIATION_BPS`).
3. If a plan exists, optionally **execute** swaps (or simulate when `DRY_RUN=true`). Uniswap V3 sizing is **wallet balance–bounded**; QuickSwap V2 USDC input is additionally capped by `MAX_TRADE_USDC`.

Trade directions (logged and internal):

- `SELL_BASE_FOR_USDC` when on-chain price is **above** the API target.
- `BUY_BASE_WITH_USDC` when on-chain price is **below** the API target.

**Base token** is the non-USDC leg of the stabilized pair. Logs use `BASE_TOKEN_SYMBOL` (default `BASE`) for human-readable labels.

### Assumptions and limits

- **Quote token is USDC** in pool math and routing; adapters default to Polygon USDC addresses when overrides are unset.
- **No fallback price**: if the API fails, the cycle is skipped after logging (`API_FAILURE`).
- **No MEV protection**, no private RPC bundle API, no on-chain governance: production safety is your RPC, wallet, and parameter tuning.
- **All valid plans per cycle may execute** (each enabled DEX with a plan), not a single “best DEX” unless you change the code.

## Quick start (development)

```bash
cp .env.example .env
# Edit .env: RPC_URL, PRIVATE_KEY, INDEX_API_URL, base token / adapter flags
npm install
npm run typecheck
npm test
DRY_RUN=true npm run start
```

For production, prefer `npm run build` and run compiled output (see below).

## Production rollout checklist

1. **Fork or clone** the repo; pin a release tag or commit for deployments.
2. **RPC**: Use a dedicated provider (Alchemy, Infura, QuickNode, etc.) with rate limits appropriate for polling + V3 quoter calls. Public RPCs are fragile under load.
3. **Wallet**: Use a **dedicated** hot wallet with only the funds needed for stabilization and gas. Never commit `.env` or keys; ensure `.env` is in `.gitignore` (default in this repo).
4. **Dry run**: Run with `DRY_RUN=true` until logs show sane plans for your API and pools (`CYCLE_STATE`, `TRADE_PLAN`).
5. **Approvals**: First live runs may require ERC-20 `approve` transactions for routers; monitor gas and allowances.
6. **Parameters**: Start conservative: higher `PRICE_DEVIATION_BPS`, lower `MAX_TRADE_USDC`, higher `SLIPPAGE_BPS` only as needed, sensible `COOLDOWN_SECONDS`.
7. **Supervision**: Run under **systemd**, **pm2**, **Docker**, or Kubernetes with **restart policy**, log shipping, and alerts on process exit.
8. **Observability**: Ship stdout/stderr to your log stack; alert on repeated `TX_REVERT`, `API_FAILURE`, or absence of `CYCLE_START` heartbeats.

## Target price API contract

- **Method**: HTTP GET to `INDEX_API_URL` (no auth in code; use a signed URL or reverse proxy if you need credentials).
- **Response**: JSON object containing a **decimal string or number** at `INDEX_API_VALUE_FIELD` (default key `value`).
- **Format**: Plain decimal notation only; **scientific notation is rejected** (e.g. `1e-6` fails).
- **Semantics**: Price is **USDC per 1 base token**, aligned with `PRICE_SCALE_POW` (e.g. `18` means the string `0.5` scales to `0.5 * 10^18` integer units internally).
- **Health**: Non-2xx HTTP, missing field, non-positive value, or parse errors cause that cycle to skip after `API_FAILURE` logging.

## Environment variables

Copy [`.env.example`](.env.example) to `.env`. Below: **R** = required at startup (unless noted), **O** = optional.

| Variable | R/O | Description |
|----------|-----|-------------|
| `RPC_URL` | R | HTTPS JSON-RPC endpoint. |
| `PRIVATE_KEY` | R | Hex private key for signing (0x-prefixed). |
| `CHAIN_ID` | O | EVM chain ID (default `137` Polygon). |
| `INDEX_API_URL` | R | JSON price endpoint URL. |
| `INDEX_API_VALUE_FIELD` | O | JSON key for price (default `value`). |
| `PRICE_SCALE_POW` | O | Fixed-point scale for API decimal (default `18`). |
| `BASE_TOKEN_SYMBOL` | O | Log label for base token (default `BASE`). |
| `DRY_RUN` | O | `true` = no txs (default `true`). |
| `PRICE_DEVIATION_BPS` | O | Minimum deviation from target before planning (default `100`). |
| `TARGET_TOLERANCE_BPS` | O | V3 solver tolerance hint (default `50`). |
| `SINGLE_TX_MODE` | O | Reserved / loaded (default `true`). |
| `SINGLE_TX_MAX_ITERS` | O | Binary search iterations cap on V3 (default `18`). |
| `SLIPPAGE_BPS` | O | Min-out slippage guard (default `50`). |
| `COOLDOWN_SECONDS` | O | Minimum time after any execution before next trade window (default `60`). |
| `POLL_INTERVAL_SECONDS` | O | Sleep between cycle starts (default `30`). |
| `MAX_TRADE_USDC` | R | Max USDC input string for **QuickSwap V2** sizing (e.g. `"1000"`). |
| `MAX_RETRIES` | O | Retries for API and DEX evaluation (default `3`). |
| `RETRY_BASE_DELAY_MS` | O | Base backoff for retries (default `1500`). |
| `ENABLE_UNISWAP_V3` | O | `true` / `false` (default `true`). |
| `ENABLE_QUICKSWAP_V2` | O | `true` / `false` (default `true` in code; example may disable). |
| `UNISWAP_V3_BASE_TOKEN_ADDRESS` | Conditional | Required if V3 enabled **unless** `UNISWAP_V3_POOL_ADDRESS` or `UNISWAP_V3_POSITION_TOKEN_ID` is set (then inferred). |
| `QUICKSWAP_V2_BASE_TOKEN_ADDRESS` | Conditional | Required if QuickSwap V2 enabled. |
| `UNISWAP_V3_*` / `QUICKSWAP_V2_*` | O | Router, factory, quoter, USDC addresses, pool address, pool fee, position NFT id — see [`.env.example`](.env.example). |

**Validation:** If both adapters are enabled and both base addresses are set, they must refer to the **same** token ([`src/bot.ts`](src/bot.ts)).

## Running in production

**Compile then run Node on JavaScript** (avoids `ts-node` in production):

```bash
npm ci
npm run build
node dist/src/index.js
```

Compiled output is under `dist/` per [`tsconfig.json`](tsconfig.json) (`outDir: "dist"`, sources under `src/`, so the entry file is `dist/src/index.js`).

**Process manager (systemd sketch):**

```ini
[Service]
WorkingDirectory=/opt/dex-amm-price-stabilizer
EnvironmentFile=/opt/dex-amm-price-stabilizer/.env
ExecStart=/usr/bin/node dist/src/index.js
Restart=on-failure
RestartSec=10
User=stabilizer
```

Run the service user with **no shell login**, minimal filesystem permissions, and secrets injected via **EnvironmentFile** or your orchestrator’s secret store—not baked into the unit file.

## Logging and operations

Logs are human-oriented tables and event lines. Important events:

| Event | Meaning |
|-------|---------|
| `BOT_START` | Config loaded; wallet and enabled DEXes. |
| `CYCLE_START` / `CYCLE_STATE` | Poll tick; includes `targetPriceUsdcPerBase`, balances, DEX evaluations. |
| `API_PRICE_FETCHED` | Successful parse (also logged from price service). |
| `API_FAILURE` | Target fetch/parse failed; cycle skipped. |
| `TRADE_PLAN` / `TRADE_RESULT` | Intent to trade and outcome (or `SIMULATED` in dry run). |
| `INSUFFICIENT_BALANCE` | Wallet could not fund the planned input. |
| `TX_REVERT` | On-chain failure after submission. |
| `RETRY_BACKOFF` | Transient error; backing off and retrying. |

**Production tip:** Capture stdout to files or a log agent; set log rotation. Do not paste production logs containing wallet addresses into public tickets without review.

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| Startup throws on env | Missing `RPC_URL`, `PRIVATE_KEY`, `INDEX_API_URL`, `MAX_TRADE_USDC`, or adapter base-token rules ([`src/config.ts`](src/config.ts)). |
| `API_FAILURE` every cycle | URL reachable from host, JSON shape, field name, decimal format, HTTP 200, clock skew if you use short-lived tokens in URL. |
| `POOL_NOT_FOUND` | Wrong `CHAIN_ID`, wrong base or USDC addresses, or no liquidity for the fee tier searched on V3. |
| `TX_REVERT` | Slippage too tight, stale RPC state, insufficient allowance after manual revoke, pool moved, or router mismatch. |
| No trades but price looks wrong | `PRICE_DEVIATION_BPS` may be too high vs actual deviation; confirm `PRICE_SCALE_POW` matches how your API encodes price. |

## Architecture

| Module | Role |
|--------|------|
| [`src/config.ts`](src/config.ts) | Env loading and adapter validation. |
| [`src/logger.ts`](src/logger.ts) | Structured terminal logging. |
| [`src/priceService.ts`](src/priceService.ts) | Strict API fetch and parse. |
| [`src/dexAdapters/uniswapV3.ts`](src/dexAdapters/uniswapV3.ts) | V3 pool detection, price math, sizing. |
| [`src/dexAdapters/quickswapV2.ts`](src/dexAdapters/quickswapV2.ts) | V2 reserve math and sizing. |
| [`src/tradeEngine.ts`](src/tradeEngine.ts) | Plan ranking helper (optional use). |
| [`src/bot.ts`](src/bot.ts) | Main loop, retries, execution. |
| [`src/index.ts`](src/index.ts) | Process entrypoint. |

## Development

```bash
npm install
npm run typecheck
npm test
npm run start
```

## Disclaimer

This software moves real assets on public blockchains using a private key you supply. Bugs, misconfiguration, adversarial markets, RPC failures, and smart contract risk can cause **total loss of funds**. You are solely responsible for custody, legal and tax compliance, and operational security. This project is provided **as-is** without warranty of any kind. **Not financial advice.**
