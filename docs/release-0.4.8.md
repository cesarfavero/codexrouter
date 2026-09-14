# CodexRouter 0.4.8

This release adds WebSocket support for the Codex responses endpoint, fixing `ws://127.0.0.1:17842/v1/responses` requests that previously returned a local 404. The Router catalog now labels native models with the short `Router ·` prefix, and Activity records the account, model, transport and status for routed requests without storing credentials or raw request content.
