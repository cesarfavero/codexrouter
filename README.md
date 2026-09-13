# CodexRouter

**One Codex model. Multiple isolated ChatGPT accounts managed from one desktop app.**

CodexRouter keeps the native Codex interface but exposes only one managed model:

```text
CodexRouter
```

The desktop app decides which authenticated account and which native Codex model sit behind that gateway.

> Status: early desktop MVP. This project is not affiliated with OpenAI.

## Experience

```text
Open CodexRouter
      ↓
Add ChatGPT accounts
      ↓
official Codex / OpenAI browser login
      ↓
choose the active account in CodexRouter
      ↓
Install & start gateway
      ↓
Open Codex
      ↓
select “CodexRouter” once
```

There are no `GPT-X · Cesar`, `GPT-X · Eduardo`, etc. rows in Codex anymore. Account management stays in the CodexRouter app.

## Gateway behavior

The generated Codex catalog contains exactly one visible managed row:

```text
slug: codexrouter/gateway
display: CodexRouter
```

For the active account, CodexRouter discovers the real list-visible models through the installed Codex CLI and selects a valid native model. A request then becomes:

```text
Codex request
model = codexrouter/gateway
        ↓
CodexRouter
        ↓
active account = Cesar
native model = gpt-5.6-sol
        ↓
official Codex backend
```

Changing the active account in the desktop app rebuilds the gateway catalog for that account.

## Accounts and login

Every account gets its own isolated `CODEX_HOME`:

```text
~/.codexrouter/accounts/<account-id>/codex-home
```

CodexRouter starts the official `codex login` inside that directory. The installed Codex CLI continues to own:

- the browser/OAuth flow;
- the localhost callback server;
- credential persistence;
- token refresh;
- logout.

CodexRouter does not ask for your ChatGPT password and does not import ChatGPT cookies.

## Usage and cooldown telemetry

CodexRouter passively reads the same ChatGPT/Codex usage surface used by Codex for account rate-limit state. The desktop app can show, when available:

- primary and secondary usage windows;
- percent used / remaining;
- reset timestamps;
- spend-control state;
- whether the active account is currently allowed to run ordinary Codex usage.

Usage reads are cached locally for a short period. Authentication material is not sent to a CodexRouter-owned remote service.

In **Settings**, choose the native Codex model exposed by each synchronized account and its default reasoning effort (`minimal`, `low`, `medium`, `high` or `xhigh`). The configured effort is applied only when the request does not provide its own `reasoning.effort`.

When the backend reports that the active account has reached its usage limit, or its remaining usage reaches the configured low-usage threshold, CodexRouter automatically selects another healthy configured account and continues the gateway request.

### Automatic quota rollover

CodexRouter automatically fails over only among the ChatGPT accounts explicitly configured by the user. The gateway does not combine separate subscriptions into one quota pool.

## Desktop app

The launcher is Electron + React + Vite + Motion and contains:

- **Gateway** — accounts, active account, native model and usage/cooldown state;
- **Setup** — refresh catalog, install integration and start/stop the gateway;
- **Activity** — credential-safe operational logs;
- **Settings** — launch at login, local endpoint/data and open-source credits.

The packaged macOS app can stay in the menu bar and restore the local gateway automatically when the integration is installed.

## Run from source

Requirements:

- macOS 13+ recommended for the current desktop target;
- Node.js 20+;
- Codex CLI installed and available in `PATH`;
- ChatGPT accounts you are authorized to use.

```bash
git clone https://github.com/cesarfavero/codexrouter.git
cd codexrouter
npm install
npm run desktop:dev
```

Override the Codex executable when needed:

```bash
CODEX_BIN=/path/to/codex npm run desktop:dev
```

## Setup in the UI

1. Open **Gateway**.
2. Click **Add Account**.
3. Give the account a local label such as `Cesar`.
4. Complete the official Codex/OpenAI sign-in in the browser.
5. Add any other authorized accounts.
6. Choose **Use for gateway** on the account you want active.
7. Open **Setup** and click **Install & start**.
8. Restart/open Codex and select **CodexRouter**.

The integration manages only these top-level Codex settings:

```toml
openai_base_url = "http://127.0.0.1:17842/v1"
model_catalog_json = "/Users/you/.codexrouter/model-catalog.json"
```

Previous values are journaled. Uninstall restores them only if the managed values still match what CodexRouter installed; otherwise it fails closed rather than overwriting a newer user change.

## macOS menu bar

The packaged app exposes controls such as:

```text
Open CodexRouter
Open Codex
──────────────
Gateway running · :17842
Start/Stop Router
Add Account…
──────────────
Launch at Login
──────────────
Quit CodexRouter
```

## Real two-account E2E

After adding two real accounts locally:

```bash
npm run e2e:mac -- Cesar Eduardo
```

The E2E does not create account-qualified models. It creates a temporary CodexRouter registry/catalog, selects each account explicitly in turn, and sends the same model slug:

```text
codexrouter/gateway
```

Each live request must return exactly:

```text
CODEXROUTER_E2E_OK
```

The test uses the existing authorized account profiles but does not copy their credentials or permanently modify the user's CodexRouter registry/catalog.

## CLI fallback

The desktop app is the primary UX. The CLI remains for recovery/headless diagnostics:

```text
codexrouter account add <name>
codexrouter account list
codexrouter account status <name>
codexrouter account active <name>
codexrouter account logout <name>
codexrouter account remove <name> [--delete-profile]
codexrouter catalog sync
codexrouter install [--port 17842]
codexrouter start [--port 17842]
codexrouter status
codexrouter doctor
codexrouter uninstall
```

`account default` remains a compatibility alias for `account active`.

## Security model

- each account has an isolated `CODEX_HOME`;
- the local gateway binds to `127.0.0.1` only;
- account auth files remain local and must be treated as sensitive;
- access/refresh tokens, cookies and raw `auth.json` contents are never intentionally written to application logs;
- the renderer never receives raw auth tokens;
- normal auth refresh is delegated to the installed Codex CLI;
- usage telemetry is passive and never consumes rate-limit reset credits;
- there is no automatic quota-evasion rotation.

## Development

```bash
npm test
npm run check
npm run desktop:typecheck
npm run desktop:build
```

Build a macOS package:

```bash
npm run desktop:package
```

## Open-source ancestry

CodexRouter intentionally builds on [`miuuyy/codex-chatgpt-web`](https://github.com/miuuyy/codex-chatgpt-web), MIT licensed.

We reuse/adapt its architectural and UI/UX approach, including the native Codex catalog/bridge concept and desktop launcher patterns. The original MIT license is preserved at:

```text
LICENSES/codex-chatgpt-web-MIT.txt
```

Detailed attribution is in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). We do not claim authorship of the upstream work.

CodexRouter deliberately does **not** include the upstream ChatGPT Web browser worker, DOM automation, Temporary Chat transport, Playwright login, cookie import or MCP browser harness.

## License

CodexRouter is MIT licensed. See [`LICENSE`](LICENSE).
