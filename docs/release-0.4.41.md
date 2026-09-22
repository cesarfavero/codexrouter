# CodexRouter 0.4.41

This release keeps `/v1/responses` WebSocket upgrades on the local 426 negotiation path so Codex falls back to routed HTTP/SSE requests. Gateway requests can therefore apply quota-aware account selection and Jev semantic routing consistently.

It also preserves a sanitized Codex CLI diagnostic when an isolated account re-authentication exits unsuccessfully, without exposing login URLs or credentials.
