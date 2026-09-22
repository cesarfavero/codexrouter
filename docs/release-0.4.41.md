# CodexRouter 0.4.41

This release fixes Jev being enabled but receiving no TypeSafe traffic when Codex retained a native default model.

## Fixes

- CodexRouter now transactionally manages `model = "codexrouter/gateway"` while the integration is installed.
- The previous native Codex model is preserved in the integration journal and restored on uninstall.
- Legacy integration journals are automatically migrated when Jev is enabled or the runtime starts.
- Explicit native model requests remain authoritative and now appear in Activity as `bypassed-explicit-model` instead of silently skipping Jev.
- The Settings surface shows whether the Codex default is actually entering the Jev routing path.
- Jev's default decision timeout increases from 900 ms to 3000 ms to avoid unnecessary cross-region aborts while preserving fail-open behavior.
- Health output reports that Jev requires `codexrouter/gateway`.

## Compatibility

Existing installations are migrated without discarding unrelated Codex configuration. Uninstall restores the pre-Router native model when one existed.
