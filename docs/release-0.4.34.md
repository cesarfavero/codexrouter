# CodexRouter 0.4.34

This release adds an optional TypeSafe Jev semantic intelligence layer to the managed `codexrouter/gateway`.

## Highlights

- Jev modes: `off`, `observe`, and `active`.
- Typed decisions for model tier, reasoning effort, verification need, research dependence, decomposition benefit, prior-failure signal, and semantic risk.
- Confidence-gated routing constrained to native models already available on the selected account.
- Shadow-mode telemetry for measuring recommendations before allowing them to affect traffic.
- Request sanitization, text caps, timeout, sampling, rolling request budget, in-memory decision cache, and fail-open fallback.
- Deterministic account selection, quota/cooldown logic, authentication, 401 refresh, and 429 failover remain authoritative.
- Explicit native/account-qualified model selection bypasses Jev.
- New Jev unit and proxy integration coverage.
- Desktop Settings controls with OS-encrypted TypeSafe API-key storage; the secret never crosses into the renderer.

See `docs/jev-intelligence.md` for configuration and the security boundary.
