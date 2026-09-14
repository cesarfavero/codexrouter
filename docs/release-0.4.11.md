# CodexRouter 0.4.11

The desktop Start and Install actions now recover from a stale CodexRouter process occupying the configured loopback port. The previous Router process is identified and stopped before a fresh instance starts; unrelated services on the port are left untouched with an actionable error.
