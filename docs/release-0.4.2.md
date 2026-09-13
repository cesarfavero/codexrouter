# CodexRouter 0.4.2

This release restores the full visible Codex model catalog. The active account's native models keep their original slugs, while models from other configured accounts appear with account-qualified slugs such as `codexrouter/<account-id>/<native-model>`.

The gateway still supports `codexrouter/gateway` as the active-account default, applies the configured reasoning effort, and automatically fails over when usage is exhausted or nearly exhausted. Automatic defaults now prefer a lower model such as `gpt-5.5` when available.
