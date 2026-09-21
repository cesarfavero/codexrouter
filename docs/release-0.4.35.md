# CodexRouter 0.4.35

This release adds user-controlled model eligibility to the Jev semantic routing layer.

## Highlights

- Per-model Jev enable/disable controls in Settings.
- Hard allowlist enforcement after Jev chooses a semantic tier.
- Disabled models can never be selected by Jev in active mode.
- An empty allowlist disables Jev model overrides without disabling reasoning-effort advice.
- Observe mode uses the same constrained recommendation set for accurate shadow measurements.
- 429 failover re-resolves the Jev policy against the fallback account instead of reusing the first account's model.
- Headless deployments can set `CODEXROUTER_JEV_ALLOWED_MODELS` to a comma-separated list.
- Backward-compatible default: all discovered models remain eligible until a restriction is configured.

Explicit native or account-qualified model selections are still user intent and bypass Jev.
