# CodexRouter repository guidance

## Product intent

CodexRouter presents one managed `CodexRouter` model in the native Codex picker. The desktop app owns account selection, native-model selection, local usage telemetry and gateway lifecycle. Each ChatGPT account remains isolated behind its own official Codex login profile.

## Routing rules

- The gateway slug is `codexrouter/gateway`.
- Account selection must be explicit in the CodexRouter desktop app; `defaultAccountId` is retained as the persisted active-account field for backwards compatibility.
- A quota-exhausted account may be marked `Cooldown` and blocked until its reset state changes.
- Do not automatically switch to another subscription because the active account hit a Usage Limit.
- Do not aggregate multiple subscriptions into a single effective quota pool.

## Non-goals

- Do not implement automatic quota evasion or silent account rotation.
- Do not add ChatGPT Web DOM automation, browser scraping, Playwright login or cookie import unless a future issue explicitly changes this direction.
- Do not log access tokens, refresh tokens, cookies or raw auth.json contents.
- Do not consume rate-limit reset credits from passive usage telemetry.

## Authentication

Prefer the official installed Codex CLI for login, logout, status and refresh behavior. Each account must use an isolated `CODEX_HOME`. The router may read the resulting account-scoped auth file only as needed to forward authenticated native Codex requests and read account usage state.

## Upstream attribution

`miuuyy/codex-chatgpt-web` is an explicit architectural and code/UI reference under the MIT License. Preserve `THIRD_PARTY_NOTICES.md` and `LICENSES/codex-chatgpt-web-MIT.txt`. Mark directly copied or closely adapted substantial code when introduced.

## Changes

For repository work, create/link an Issue, use a branch, make focused commits, open a PR, run tests/checks, review, and merge completed work to `main` unless an issue explicitly requires otherwise.
