# CodexRouter repository guidance

## Product intent

CodexRouter presents one managed `Router` model in the native Codex picker. The desktop app owns account selection, native-model selection, local usage telemetry and gateway lifecycle. Each ChatGPT account remains isolated behind its own official Codex login profile.

## Routing rules

- The gateway slug is `codexrouter/gateway`.
- `defaultAccountId` remains the persisted active-account field for backwards compatibility; the gateway may update it when automatic account failover selects another account.
- The gateway may automatically select another healthy account when the active account is exhausted or near its usage limit.
- Do not aggregate multiple subscriptions into a single effective quota pool.
- Discover selectable native models from each account's current Codex CLI catalog; do not maintain version-specific model lists. Preserve valid user-selected models, and base automatic selection only on models reported by that account.
- Return `426 Upgrade Required` for `/v1/responses` capability negotiation and WebSocket upgrades so Codex falls back to HTTP/SSE. This keeps resumed conversations and Goals on the account-aware routing path, where the gateway slug is replaced with the selected account's native model.

## Non-goals

- Automatic account failover is allowed only among accounts explicitly configured by the user in CodexRouter.
- Do not add ChatGPT Web DOM automation, browser scraping, Playwright login or cookie import unless a future issue explicitly changes this direction.
- Do not log access tokens, refresh tokens, cookies or raw auth.json contents.
- Do not consume rate-limit reset credits from passive usage telemetry.

## Authentication

Prefer the official installed Codex CLI for login, logout, status and refresh behavior. Each account must use an isolated `CODEX_HOME`. The router may read the resulting account-scoped auth file only as needed to forward authenticated native Codex requests and read account usage state.

## Upstream attribution

`miuuyy/codex-chatgpt-web` is an explicit architectural and code/UI reference under the MIT License. Preserve `THIRD_PARTY_NOTICES.md` and `LICENSES/codex-chatgpt-web-MIT.txt`. Mark directly copied or closely adapted substantial code when introduced.

## Changes

For repository work, create/link an Issue, use a branch, make focused commits, open a PR, run tests/checks, review, and merge completed work to `main` unless an issue explicitly requires otherwise. After each validated code or product update, increment the version when applicable, build the distributable artifacts, publish the corresponding GitHub release, and install the freshly built macOS app over the current `/Applications/CodexRouter.app` installation when a macOS build is available.

## Jev semantic routing

- Treat Jev as a typed semantic advisor, not as authority over authentication, account eligibility, quota/cooldown, permissions, dates, exact calculations or irreversible actions.
- Keep `CODEXROUTER_JEV_MODE=off` as the default. Use `observe` before enabling `active` for a new decision policy or rubric.
- Only `codexrouter/gateway` may be semantically rerouted. Explicit native/account-qualified model selections are user intent and must remain pinned.
- Keep the user's native Codex `model` default intact; ChatGPT accounts reject `codexrouter/gateway` when written as the global default. Expose Router through `model_catalog_json` for explicit selection in Codex, and migrate legacy journals that tracked the Router as the global default.
- Treat the Jev model allowlist as a hard post-decision policy. Disabled model slugs must never be selected by Jev, including during account failover; an empty allowlist means Jev may not override the model at all.
- Keep Jev context profiles bounded and explicit. Account routing may only recommend among candidates already filtered by deterministic Router checks for enabled status, healthy usage, cooldown and available model; apply the configured account allowlist and confidence/manipulation gates, and preserve deterministic fallback.
- Never send access tokens, refresh tokens, cookies, raw `auth.json`, account-authentication headers or other known credentials to TypeSafe.
- Never log the task text sent to Jev. Operational telemetry may contain only structured decisions, latency, token counts and applied/recommended routing metadata.
- Any Jev outage, timeout, malformed answer, budget limit or low-confidence result must fall back to the deterministic Router behavior.
- Treat evaluator-manipulation/prompt-injection signals as a reason to keep the recommendation observational; suspicious state must not gain autonomous routing authority.
- Changes to Jev questions, thresholds, model-tier mapping, sanitization or egress state require tests covering `off`, `observe`, `active`, explicit-model bypass and failure fallback.
- Keep the pinned Jev model/configuration explicit so benchmark comparisons remain reproducible; do not silently switch to a moving alias for measured rollouts.
