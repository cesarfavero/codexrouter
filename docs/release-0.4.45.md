# CodexRouter 0.4.45

- Preserve the native global Codex model default for ChatGPT account compatibility.
- Keep Router available for explicit selection in the Codex model picker.
- Migrate existing integrations that still track Router as the global model, restoring the previous native default when it has not been changed by the user.
- Keep Jev routing scoped to requests sent through Router; changing Jev settings no longer rewrites the global Codex model.
