# CodexRouter 0.4.0

This release adds:

- native Codex model selection from the real per-account catalog;
- configurable default reasoning effort;
- automatic account failover when usage is exhausted or nearly exhausted;
- macOS DMG and ZIP packaging with a custom CodexRouter icon;
- English, Portuguese and Simplified Chinese documentation;
- a GitHub Releases update notification inside the desktop app;
- compatibility with older local account snapshots and cached Codex model catalogs.

The macOS artifact is built for Apple Silicon on the release runner. The current public artifact is unsigned when Apple Developer ID credentials are unavailable; macOS may require opening it via Privacy & Security on first launch. The official Codex CLI remains a separate prerequisite.
