# Contributing

Thanks for your interest in **dex-amm-price-stabilizer**.

## Before you start

- Read the [README](README.md), especially assumptions, limits, and the disclaimer.
- Do not submit real private keys, API keys, or `.env` contents in issues or pull requests.

## Development setup

```bash
npm install
npm run typecheck
npm test
```

Use `DRY_RUN=true` when exercising the bot against live RPCs.

## Pull requests

- Keep changes focused on one concern when possible.
- Run `npm run typecheck` and `npm test` before opening a PR.
- Describe what changed and why in the PR body (plain language is enough).

## Issues

Bug reports and small feature ideas are welcome. Include:

- Node.js version  
- Relevant env (redact secrets): chain, which adapters are enabled  
- What you expected vs what happened, and logs if safe to share  

For security-sensitive reports, see [SECURITY.md](SECURITY.md).
