# CodexRouter 0.4.42

This release adds cost controls and optional account recommendations to the Jev semantic routing layer.

## Highlights

- Adds Jev context profiles: Economy, Balanced and Full.
- Economy mode sends only the latest useful user request and a reduced decision rubric.
- Adds Jev sampling, decision cache, and context ceiling controls in Settings.
- Adds optional Jev account routing with Off, Observe and Active modes.
- Adds a hard allowlist for accounts Jev may recommend.
- Keeps account eligibility, cooldown, quota, credentials and 429 failover deterministic in the Router.
- Hides the Jev model version from normal editing while still showing the pinned runtime version for diagnostics.

## Validation

- `npm test`
- `npm run check`
- `npm run desktop:typecheck`
