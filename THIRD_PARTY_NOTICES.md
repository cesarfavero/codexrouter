# Third-party notices

CodexRouter intentionally builds on prior open-source work and keeps attribution explicit.

## miuuyy/codex-chatgpt-web

Repository: https://github.com/miuuyy/codex-chatgpt-web

Reference revision used while building the initial CodexRouter architecture and desktop launcher: `e85e3693fdb4e3e033348c08df0298c20fcdb612` plus the corresponding public `main` launcher sources reviewed during development.

License: MIT. The original license text is preserved at `LICENSES/codex-chatgpt-web-MIT.txt`.

CodexRouter reuses and adapts architectural ideas from this project, especially:

- keeping the native Codex UI and model picker;
- augmenting the Codex model catalog instead of replacing the Codex client;
- routing Codex Responses traffic through a loopback bridge;
- preserving user-owned Codex configuration transactionally;
- treating account/auth state as isolated profiles;
- using an Electron desktop control center with a compact sidebar, setup/status surfaces, menu-bar lifecycle and launcher-style desktop UX.

The desktop work specifically references/adapts patterns from upstream files including:

- `launcher/src/App.tsx` for the launcher shell, sidebar/navigation hierarchy, transition language and compact control-center UX;
- `launcher/src/tokens.css` for the dark color/token system and density conventions;
- `launcher/electron/autostart.cjs` for packaged app login-item handling on macOS/Windows;
- `launcher/package.json` for the Electron + React + Vite packaging approach.

CodexRouter's account screens, IPC API, model/account routing, official-Codex login integration, tray menu, E2E harness and product flows are CodexRouter-specific implementations. Directly copied or closely adapted files/sections carry attribution comments where practical.

CodexRouter deliberately does **not** include the upstream project's ChatGPT Web automation, Electron browser worker, Temporary Chat transport, DOM automation, Playwright flow, MCP browser harness, or Zero Risk mode.

Where code is directly copied or closely adapted, the original MIT notice applies. No claim is made that CodexRouter authors created the upstream work.

## OpenAI Codex

Repository: https://github.com/openai/codex

CodexRouter interoperates with the public Codex CLI and uses its current configuration and login behavior. In particular, CodexRouter deliberately delegates sign-in, logout, model-catalog refresh, and token refresh behavior to the installed Codex CLI through isolated `CODEX_HOME` profiles rather than implementing an independent ChatGPT OAuth client.

The desktop login flow observes the public authentication URL emitted by `codex login` only so the launcher can offer a convenient “Open sign-in page” action. Codex still owns the callback server, authorization-code exchange, credential persistence, refresh and logout semantics.

OpenAI Codex is not bundled with CodexRouter. Users must install Codex separately and remain responsible for the terms and policies that apply to their accounts.
