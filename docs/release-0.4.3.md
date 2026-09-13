# CodexRouter 0.4.3

This patch release fixes account-qualified model routing. Selecting a model tied to a specific account now keeps that account pinned for the request, including when the upstream returns a rate-limit response; automatic failover remains available for the managed gateway and unqualified native models.

The release also keeps the lower automatic model preference and the complete native/account-qualified Codex catalog introduced in 0.4.2.
