# CodexRouter repository guidance

## Product intent

CodexRouter adds explicit multi-account ChatGPT routing to the native Codex experience. The primary UX is account-qualified model aliases such as `GPT-5.6 Sol · Cesar` and `GPT-5.6 Sol · Eduardo` in Codex's own model picker.

## Non-goals

- Do not implement automatic quota evasion or silent account rotation.
- Do not add ChatGPT Web DOM automation, browser scraping, Playwright login or cookie import unless a future issue explicitly changes this direction.
- Do not log access tokens, refresh tokens, cookies or raw auth.json contents.

## Authentication

Prefer the official installed Codex CLI for login, logout, status and refresh behavior. Each account must use an isolated `CODEX_HOME`. The router may read the resulting account-scoped auth file only as needed to forward authenticated native Codex requests.

## Upstream attribution

`miuuyy/codex-chatgpt-web` is an explicit architectural and code reference under the MIT License. Preserve `THIRD_PARTY_NOTICES.md` and `LICENSES/codex-chatgpt-web-MIT.txt`. Mark directly copied or closely adapted substantial code when introduced.

## Changes

For repository work, create/link an Issue, use a branch, make focused commits, open a PR, run tests/checks, review, and merge completed work to `main` unless an issue explicitly requires otherwise.
