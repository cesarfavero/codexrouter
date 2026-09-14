# CodexRouter 0.4.10

This patch completes the WebSocket fix by sending a valid `1000 Normal Closure` frame after the streamed response finishes. Codex clients can now receive `response.completed` and close the local stream without a protocol reset.
