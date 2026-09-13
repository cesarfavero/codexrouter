# CodexRouter

**Multiple ChatGPT accounts inside the native Codex model picker.**

CodexRouter turns authenticated ChatGPT accounts into explicit model aliases:

```text
GPT-5.6 Sol · Cesar
GPT-5.6 Sol · Eduardo
GPT-5.6 Sol Pro · Cesar
GPT-5.6 Sol Pro · Eduardo
```

Selecting an alias chooses both the real Codex model and the account used to authenticate that request.

> Status: desktop-first early MVP. Multi-account auth profiles, model aliases, loopback routing, desktop launcher, menu-bar runtime and a real two-account macOS E2E harness are implemented. CodexRouter is not affiliated with OpenAI.

## The intended experience

Normal users should not need to manage CodexRouter from a terminal.

```text
Open CodexRouter
      ↓
Add Account
      ↓
official Codex / OpenAI browser login
      ↓
account appears in Accounts
      ↓
Install & start
      ↓
Open Codex
      ↓
choose GPT-5.6 Sol · Cesar / Eduardo / ...
```

The CLI remains available for recovery, automation and diagnostics.

## Desktop launcher

The launcher is an Electron + React control center with four primary surfaces:

- **Accounts** — add, re-authenticate, remove and choose the default account;
- **Setup** — sync model catalogs, install/uninstall the Codex integration and start/stop the router;
- **Activity** — operational status and credential-safe logs;
- **Settings** — launch-at-login, local endpoint/data information and upstream credits.

Closing the window keeps the packaged app in the macOS menu bar. When integration is installed, the launcher restores the local router on startup. Packaged macOS builds can enable **Launch at Login** using the native login-item mechanism.

## Open-source ancestry

[`miuuyy/codex-chatgpt-web`](https://github.com/miuuyy/codex-chatgpt-web) is a major architectural **and desktop UI/UX reference** for this project.

We intentionally reuse/adapt its approach to:

- keep the signed/native Codex UI and model picker;
- append model rows instead of replacing Codex;
- route selected traffic through a loopback bridge;
- manage Codex config transactionally;
- use a compact Electron control center with sidebar/status/setup surfaces;
- manage desktop autostart/menu-bar lifecycle.

Its original MIT license is preserved at [`LICENSES/codex-chatgpt-web-MIT.txt`](LICENSES/codex-chatgpt-web-MIT.txt). Detailed attribution, including the specific launcher files used as references, is in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

We do **not** claim authorship of the upstream UI or architecture we reused/adapted.

CodexRouter removes the upstream ChatGPT Web automation path. There is no browser worker, DOM automation, Temporary Chat transport, Playwright login, cookie import or MCP browser harness in this product.

## Requirements

For development from source:

- macOS 13+ recommended for the current desktop target;
- Node.js 20+;
- the `codex` CLI installed and available in `PATH`;
- ChatGPT accounts you are authorized to use.

Override the Codex executable with `CODEX_BIN=/path/to/codex` when needed.

## Run the desktop app from source

```bash
git clone https://github.com/cesarfavero/codexrouter.git
cd codexrouter
npm install
npm run desktop:dev
```

The development command starts Vite and Electron together.

## Build a macOS app

```bash
npm install
npm run desktop:package
```

Artifacts are written under `release/` by electron-builder. The packaged build enables the native **Launch at Login** setting.

## Add an account in the UI

Open **Accounts** and choose **Add Account**.

1. Enter a label such as `Cesar` or `Eduardo`.
2. CodexRouter creates an isolated profile at:

   ```text
   ~/.codexrouter/accounts/<account-id>/codex-home
   ```

3. The launcher starts the official `codex login` with that directory as `CODEX_HOME`.
4. Codex owns the localhost callback server, OpenAI browser/OAuth flow, token exchange and persisted auth.
5. The launcher observes the public sign-in URL emitted by Codex only so it can show an **Open sign-in page** button.
6. After login completes, CodexRouter reads non-secret identity metadata for the UI and syncs that account's model catalog.

CodexRouter never asks for your ChatGPT password and does not implement a parallel OAuth client.

## What gets injected into Codex

For every account, CodexRouter runs the installed Codex CLI against that isolated profile and asks for its native model catalog. It preserves native model rows and appends account aliases.

Alias slugs are deterministic:

```text
codexrouter/<account-id>/<native-model-id>
```

Example:

```text
codexrouter/eduardo/gpt-5.6-sol
```

The display name can be:

```text
GPT-5.6 Sol · Eduardo
```

When Codex sends a request using that alias, the local router:

1. resolves the account id and native model id;
2. rewrites the model back to the native slug;
3. loads the selected account's isolated Codex authentication;
4. asks Codex itself to refresh authentication when necessary;
5. replaces the request auth/account headers;
6. streams the official Codex backend response back to the Codex client.

The bridge binds to `127.0.0.1` only.

## Setup screen

The desktop setup flow guides four states:

```text
1. Connect accounts
2. Build model aliases
3. Install Codex integration
4. Run in the background
```

**Install & start** synchronizes the catalog, manages the Codex configuration and starts the Router.

The integration manages only these top-level Codex settings:

```toml
openai_base_url = "http://127.0.0.1:17842/v1"
model_catalog_json = "/Users/you/.codexrouter/model-catalog.json"
```

Previous values are journaled. Uninstall restores them only when the managed lines still match what CodexRouter installed; otherwise it fails closed instead of overwriting a newer user change.

## Menu bar

The packaged desktop app exposes:

```text
Open CodexRouter
Open Codex
──────────────
Router running · :17842
Start/Stop Router
Add Account…
──────────────
Launch at Login
──────────────
Quit CodexRouter
```

This makes the router a normal background developer utility rather than a terminal process you must remember to start manually.

## Real two-account macOS E2E

After adding at least two real accounts in the desktop app, run:

```bash
npm run e2e:mac -- Cesar Eduardo
```

Or, when exactly the first two configured accounts should be tested:

```bash
npm run e2e:mac
```

The harness:

1. confirms both isolated profiles contain valid Codex authentication;
2. asks both profiles for their real model catalogs;
3. finds a common list-visible model;
4. starts a temporary Router on `127.0.0.1:17942`;
5. invokes a real `codex exec` against `codexrouter/<account>/<model>` for account A;
6. repeats for account B;
7. requires each live request to return exactly `CODEXROUTER_E2E_OK`;
8. stops the temporary Router and removes scratch output.

It does not copy auth files or permanently modify the main Codex config. This test consumes real model usage on both selected accounts.

Override the E2E port with:

```bash
CODEXROUTER_E2E_PORT=17943 npm run e2e:mac -- Cesar Eduardo
```

## CLI fallback

The CLI is still useful for recovery and headless operation:

```text
codexrouter account add <name>
codexrouter account list
codexrouter account status <name>
codexrouter account default <name>
codexrouter account logout <name>
codexrouter account remove <name> --delete-profile

codexrouter catalog sync
codexrouter install [--port 17842]
codexrouter start [--port 17842]
codexrouter status
codexrouter doctor
codexrouter uninstall
```

Short alias: `cxr`.

## Security model

- Every account has its own `CODEX_HOME`.
- Account profiles force `cli_auth_credentials_store = "file"` because the router must forward the current access token for the selected account.
- Those auth files are sensitive and must remain owner-only.
- No password is collected by CodexRouter.
- Sign-in, logout and token refresh are delegated to the installed Codex implementation.
- Raw tokens/auth files are never sent to the renderer and are never intentionally written to CodexRouter logs.
- Electron uses context isolation, a narrow preload IPC surface and no renderer Node integration.
- External URLs are limited to HTTP(S).
- The Router listens on loopback only.
- Account selection is explicit through the chosen model alias; CodexRouter does not silently rotate accounts to aggregate or evade usage limits.

Do not sync or share `~/.codexrouter/accounts/*/codex-home/auth.json`.

## Development

```bash
npm test
npm run check
npm run desktop:typecheck
npm run desktop:build
npm run desktop:dev
```

The repository keeps the core Router independent of Electron so routing/catalog tests can run without launching the desktop shell.

## Current limitations

- the desktop package still needs signing/notarization/release automation before a polished public macOS distribution;
- the real two-account E2E must be run on a Mac that actually has two authorized ChatGPT accounts, so CI cannot complete that interactive credentialed portion;
- Search/Image endpoints need broader real-world validation;
- account-specific usage/remaining-limit telemetry is not exposed yet;
- upstream Codex request/catalog contracts can change and need compatibility tracking.

## License

CodexRouter is MIT licensed. See [`LICENSE`](LICENSE).

Reused/adapted upstream material remains subject to its original notices. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
