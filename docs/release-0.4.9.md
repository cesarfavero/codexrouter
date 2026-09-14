# CodexRouter 0.4.9

This patch fixes WebSocket frame forwarding. Frames sent from CodexRouter to the upstream Codex service are now masked as required by the WebSocket client protocol, preventing upstream disconnects such as `Connection reset without closing handshake`.
