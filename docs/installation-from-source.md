# Install from source

1. Install Node.js 20+ and the official Codex CLI.
2. Clone the repository and run `npm install`.
3. Run `npm run desktop:dev`, or build a macOS package with `npm run desktop:package:mac`.
4. Open CodexRouter, add an account, finish the official browser login, and click **Refresh gateway**.
5. Select the native model and default reasoning effort in **Settings**.
6. Click **Install & start**, then open Codex and select `CodexRouter`.

If the app cannot find Codex, run with `CODEX_BIN=/absolute/path/to/codex`. Account data is stored below `~/.codexrouter`.
