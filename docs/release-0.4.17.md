# CodexRouter 0.4.17

This release makes automatic account selection quota-aware. For gateway requests, CodexRouter now evaluates every healthy configured account, prioritizes the account with the greatest remaining headroom in its narrowest rate-limit window, and keeps the active account only when scores tie. Exhausted and near-limit accounts remain excluded, while explicit account-qualified model requests remain pinned.
