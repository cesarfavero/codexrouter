# CodexRouter 0.4.44

- Proxy `/v1/responses` WebSocket upgrades to the official Codex upstream using the main Codex session.
- Preserve upstream handshake rejections and errors instead of manufacturing a local 426 response.
- Keep WebSocket capability negotiation outside gateway account selection and Jev routing.
