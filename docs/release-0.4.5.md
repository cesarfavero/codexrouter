# CodexRouter 0.4.5

This patch fixes macOS desktop authentication when the app is launched from Finder or the Dock. CodexRouter now resolves the official `codex` executable from `PATH` and common macOS package-manager/user bin directories, and reports an actionable error when it is unavailable. `CODEX_BIN` remains available for an explicit executable path.
