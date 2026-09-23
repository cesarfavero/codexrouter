# CodexRouter 0.4.47

- Route resumed chats and paused Goals through account-aware HTTP/SSE by declining the Responses WebSocket negotiation locally.
- Keep Gateway model substitution and configured-account quota failover active for every Responses request.
- Record WebSocket fallback negotiation as a local 426 event instead of forwarding it through the main Codex session.
