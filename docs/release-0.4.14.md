# CodexRouter 0.4.14

This release fixes Router lifecycle behavior. Stopping the Router now restores the official Codex endpoint, preventing a stopped local gateway from surfacing as a generic demand error. Starting the Router automatically installs the local integration before launching the gateway, so the app can be toggled without manual configuration repair.
