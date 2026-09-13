# CodexRouter

**Multiple ChatGPT accounts inside the Codex model picker.**

CodexRouter keeps Codex as the interface and turns each authenticated ChatGPT account into model aliases such as:

```text
GPT-5.6 Sol · Cesar
GPT-5.6 Sol · Eduardo
GPT-5.6 Sol Pro · Cesar
GPT-5.6 Sol Pro · Eduardo
```

Selecting an alias identifies both the real Codex model and the ChatGPT account that should authenticate the request.

> Status: early functional MVP. Account login, isolated profiles, catalog generation, Codex config integration and the Responses routing bridge are implemented. This project is not affiliated with OpenAI.

## Why

Codex currently has one active ChatGPT authentication context per normal `CODEX_HOME`. That works for one account, but is awkward when the same developer legitimately uses separate personal, company or client accounts.

CodexRouter adds one small layer around Codex:

```text
Codex App / CLI
      │
      │ model = codexrouter/eduardo/gpt-5.6-sol
      ▼
CodexRouter (127.0.0.1 only)
      │
      ├─ resolve alias → account Eduardo + gpt-5.6-sol
      ├─ load Eduardo's isolated Codex auth profile
      ├─ ask the official Codex CLI to refresh auth when needed
      └─ forward the request to the official Codex backend
```

There is no ChatGPT Web browser automation in CodexRouter.

## Open-source ancestry

This project intentionally uses [`miuuyy/codex-chatgpt-web`](https://github.com/miuuyy/codex-chatgpt-web) as a major architectural reference. That project demonstrated the cleanest part of this approach: keep the signed/native Codex UI, augment the model catalog, and route only the selected model traffic through a local bridge.

It is MIT licensed. Its original license is preserved in [`LICENSES/codex-chatgpt-web-MIT.txt`](LICENSES/codex-chatgpt-web-MIT.txt), and detailed attribution is in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

CodexRouter removes the upstream ChatGPT Web automation path and replaces account authentication with isolated profiles driven by the **official Codex login flow**.

## Requirements

- macOS, Linux or Windows with Node.js 20+
- the `codex` CLI installed and available in `PATH`
- ChatGPT accounts that you are authorized to use

You can override the binary with `CODEX_BIN=/path/to/codex`.

## Install from source

```bash
git clone https://github.com/cesarfavero/codexrouter.git
cd codexrouter
npm install -g .
```

This installs both `codexrouter` and the shorter `cxr` alias.

## Login flow

Add the first account:

```bash
codexrouter account add Cesar
```

CodexRouter creates an isolated profile under:

```text
~/.codexrouter/accounts/cesar/codex-home
```

and starts:

```text
CODEX_HOME=~/.codexrouter/accounts/cesar/codex-home codex login
```

The browser/OAuth experience is therefore the normal Codex login flow. CodexRouter does not ask for your password and does not implement a parallel OAuth client.

Add another account:

```bash
codexrouter account add Eduardo
```

List them:

```bash
codexrouter account list
```

Example:

```text
* Cesar   [cesar]   · cesar@example.com · pro
  Eduardo [eduardo] · eduardo@example.com · plus
```

The `*` account is the default used for ordinary, non-aliased native model rows.

## Set the default account

```bash
codexrouter account default Eduardo
```

## Verify a login

```bash
codexrouter account status Cesar
```

This delegates to `codex login status` inside Cesar's isolated profile.

## Sync the model catalog

```bash
codexrouter catalog sync
```

For every account, CodexRouter executes the official `codex debug models` inside that account's `CODEX_HOME`. This gives CodexRouter the actual catalog exposed to that account and also lets Codex own normal auth refresh behavior.

The generated catalog is stored at:

```text
~/.codexrouter/model-catalog.json
```

CodexRouter preserves the native rows and appends account aliases.

## Connect Codex

```bash
codexrouter install
```

This performs two managed top-level changes in the main Codex `config.toml`:

```toml
openai_base_url = "http://127.0.0.1:17842/v1"
model_catalog_json = "/Users/you/.codexrouter/model-catalog.json"
```

Previous values are journaled so `codexrouter uninstall` can restore them. If either managed line is changed by somebody else after installation, uninstall fails closed instead of overwriting the newer value.

Then start the router:

```bash
codexrouter start
```

Restart Codex. The model picker should now contain the account-specific aliases from the generated catalog.

## Commands

```text
codexrouter account add <name>                 Add/login an account with official Codex OAuth
codexrouter account list                       List configured accounts
codexrouter account status <name>              Validate one account through Codex
codexrouter account default <name>             Choose fallback/default account
codexrouter account logout <name>              Run Codex logout for one isolated profile
codexrouter account remove <name>              Remove account from registry
codexrouter account remove <name> --delete-profile
                                                Also delete its isolated CODEX_HOME

codexrouter catalog sync                       Refresh per-account catalogs and aliases
codexrouter install [--port 17842]             Install managed Codex config integration
codexrouter start [--port 17842]               Run the loopback Responses router
codexrouter status                             Show local configuration state
codexrouter doctor                             Check Codex, accounts, catalog and integration
codexrouter uninstall                          Restore managed Codex config values
```

Short alias:

```bash
cxr account list
cxr catalog sync
cxr start
```

## Request routing

Alias slugs are deterministic:

```text
codexrouter/<account-id>/<native-model-id>
```

Example:

```text
codexrouter/eduardo/gpt-5.6-sol
```

For a Responses request using that slug, the router:

1. resolves `eduardo` to the isolated account profile;
2. changes the request model back to `gpt-5.6-sol`;
3. reads the ChatGPT access token and account id from that profile;
4. if the access token is near expiry, calls `codex debug models` in that profile so the installed Codex CLI owns the refresh behavior;
5. replaces the request Authorization/account headers;
6. streams the official backend response back to Codex.

The bridge binds to `127.0.0.1`, not to a public interface.

## Security model

- Each account gets its own `CODEX_HOME`.
- Account profiles force `cli_auth_credentials_store = "file"` because the router needs to forward the current access token. The profile directories and auth files should remain owner-only.
- CodexRouter never asks for ChatGPT passwords.
- Refresh is delegated to the installed Codex CLI rather than duplicating OpenAI OAuth refresh logic.
- No credential is intentionally written to logs or to the account registry.
- The router listens on loopback only.

This still means `~/.codexrouter/accounts/*/codex-home/auth.json` is sensitive authentication material. Do not sync or share that directory.

## Current limitations

- automatic background service/LaunchAgent packaging is not included yet; run `codexrouter start` before Codex;
- Search/Image endpoints need broader real-world validation;
- account-specific usage/limit telemetry is not yet shown in the UI;
- a desktop account manager is not included yet;
- Codex updates can change internal request/catalog contracts, so compatibility tests must track upstream Codex.

The router does **not** attempt to combine accounts into one quota pool or automatically hop accounts when one hits a usage limit. Account selection is explicit through the model alias.

## Development

```bash
npm test
npm run check
```

No runtime npm dependencies are required in the initial version.

## License

CodexRouter is MIT licensed. See [`LICENSE`](LICENSE).

Reused/adapted upstream material remains subject to its original notices. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
