# Uninstall and native Codex restore

`codexrouter uninstall` returns the main Codex configuration to native Codex behavior without pinning a replacement model list.

During uninstall, CodexRouter:

- removes the Router-managed `openai_base_url`;
- removes the Router-managed `model_catalog_json`, so the installed Codex version uses its own built-in model catalog again;
- removes a persisted top-level `model` only when it uses the Router-only `codexrouter/` namespace, such as `codexrouter/gateway`;
- preserves native Codex model selections and unrelated settings;
- restores a genuinely pre-existing non-Router endpoint/catalog when one existed before installation;
- refuses to overwrite managed values that were changed by the user after the current CodexRouter install.

The uninstaller also recognizes stale `.codexrouter` and `.codex-chatgpt-web` catalog paths from older local integrations. Those stale Router values are removed rather than restored from the journal.

CodexRouter intentionally does not hard-code a specific OpenAI model as the post-uninstall default. Removing the custom catalog lets the installed Codex release expose its current native/default models automatically.

After uninstall, the main config should not contain Router-owned values:

```bash
grep -nE 'openai_base_url|model_catalog_json|codexrouter/' ~/.codex/config.toml
```

No output is expected unless those keys are intentionally managed by another non-Router setup.
