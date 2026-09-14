# CodexRouter 0.4.12

This patch preserves UTF-8 character boundaries while converting streamed HTTP/SSE responses into local WebSocket text frames, preventing protocol resets during streamed output. Opening Codex now also uses a safe working directory instead of inheriting `/`; set `CODEXROUTER_PROJECT_DIR` to choose a specific project directory.
