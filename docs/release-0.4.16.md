# CodexRouter 0.4.16

This release fixes the misleading Codex “high demand” failure. Current Codex clients compress Responses API request bodies with Zstandard; CodexRouter now decodes `zstd` requests before model and account routing, removes the stale content-encoding header after rewriting, and also supports gzip, deflate and Brotli request bodies.

Router diagnostics are now persisted to `~/.codexrouter/logs/router.jsonl`. Each sanitized event includes the local request ID, transport negotiation, selected account and model, upstream attempts, HTTP status, duration, safe request headers and upstream error details without access tokens or prompt contents.
