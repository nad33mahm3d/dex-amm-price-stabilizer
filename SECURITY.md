# Security policy

## Supported versions

Only the latest commit on the default branch (`main`) is maintained. There are no long-term support releases yet.

## Reporting a vulnerability

If you believe you found a **security vulnerability in this repository** (for example, unsafe handling of secrets in code, or a flaw that could lead to unintended loss of funds when using the bot as documented), please report it privately:

1. Open a **draft** security advisory on GitHub (**Security** tab → **Report a vulnerability**), or  
2. Email the maintainer at **ebox.nadeem@gmail.com** with subject line `[SECURITY] dex-amm-price-stabilizer`.

Include steps to reproduce, affected configuration, and impact. Please allow a reasonable time for triage before public disclosure.

## Out of scope

- Issues that require a user to disable `DRY_RUN`, paste a private key into untrusted software, or misconfigure RPC or contracts  
- Economic or trading losses that are not caused by a concrete bug in this codebase  
- Third-party dependencies (report those to the upstream project when appropriate)

## Operational security

This bot signs transactions with a private key from your environment. Use a dedicated wallet, minimal balances, and never commit `.env` or keys to git.
