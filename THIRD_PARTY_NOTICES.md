# Third-party notices

CodexRouter intentionally builds on prior open-source work and keeps attribution explicit.

## miuuyy/codex-chatgpt-web

Repository: https://github.com/miuuyy/codex-chatgpt-web

Reference revision reviewed for the initial implementation: `e85e3693fdb4e3e033348c08df0298c20fcdb612`.

License: MIT. The original license text is preserved at `LICENSES/codex-chatgpt-web-MIT.txt`.

CodexRouter reuses and adapts architectural ideas from this project, especially:

- keeping the native Codex UI and model picker;
- augmenting the Codex model catalog instead of replacing the Codex client;
- routing Codex Responses traffic through a loopback bridge;
- preserving user-owned Codex configuration transactionally;
- treating account/browser/auth state as isolated profiles.

The first CodexRouter implementation is a substantial simplification focused on native Codex ChatGPT authentication. It does **not** include the original project's ChatGPT Web automation, Electron browser worker, Temporary Chat transport, DOM automation, Playwright flow, MCP browser harness, or Zero Risk mode.

Where code is directly copied or closely adapted, the original MIT notice applies. No claim is made that CodexRouter authors created the upstream work.

## OpenAI Codex

Repository: https://github.com/openai/codex

CodexRouter interoperates with the public Codex CLI and uses its documented/current configuration and login behavior. In particular, CodexRouter deliberately delegates sign-in, logout, model-catalog refresh, and token refresh behavior to the installed Codex CLI through isolated `CODEX_HOME` profiles rather than implementing an independent ChatGPT OAuth client.

OpenAI Codex is not bundled with CodexRouter. Users must install Codex separately and remain responsible for the terms and policies that apply to their accounts.
