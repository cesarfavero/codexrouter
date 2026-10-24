# Third-party notices

## OpenAI Codex

Repository: https://github.com/openai/codex

CodexRouter interoperates with the public Codex CLI and uses its current configuration and login behavior. In particular, CodexRouter deliberately delegates sign-in, logout, model-catalog refresh, and token refresh behavior to the installed Codex CLI through isolated `CODEX_HOME` profiles rather than implementing an independent ChatGPT OAuth client.

The desktop login flow observes the public authentication URL emitted by `codex login` only so the launcher can offer a convenient “Open sign-in page” action. Codex still owns the callback server, authorization-code exchange, credential persistence, refresh and logout semantics.

OpenAI Codex is not bundled with CodexRouter. Users must install Codex separately and remain responsible for the terms and policies that apply to their accounts.
