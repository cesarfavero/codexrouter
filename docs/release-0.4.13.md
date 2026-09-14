# CodexRouter 0.4.13

This release aligns the local Codex connection with the reference transport contract. `GET /v1/responses` and WebSocket upgrade attempts now return `426 Upgrade Required`, allowing the Codex client to negotiate down to the supported HTTP/SSE transport. The manual WebSocket proxy was removed to prevent connection resets and incomplete handshakes.

Account routing, automatic failover, model selection, effort settings, usage activity, and the safe Codex project working directory remain unchanged.
