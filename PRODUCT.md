# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers and operators who use Codex with one or more ChatGPT accounts and need to manage account authentication, routing, quotas, models, and runtime health from a desktop app.

## Product Purpose

CodexRouter is a desktop control plane for operating isolated Codex account profiles, routing requests through a local gateway, monitoring usage, and configuring model and reasoning defaults. Success means an operator can understand system health quickly, change routing safely, and keep Codex available while account usage changes.

## Positioning

CodexRouter combines official Codex account profiles with deterministic local routing and quota-aware failover, while keeping account credentials isolated and native Codex capabilities available.

## Operating Context

The app runs as an Electron desktop utility alongside Codex. Operators move between overview, account management, setup, runtime activity, model defaults, and the optional Jev semantic routing controls. They work from a compact desktop window and need clear status, error, loading, empty, and recovery states.

## Capabilities and Constraints

- Account login, reauthentication, enablement, removal, and active-account selection.
- Local Router lifecycle and Codex integration setup.
- Usage windows, cooldown state, request activity, native model defaults, reasoning effort, and configured-account failover.
- Jev is optional and must be presented as its own operational area with bounded modes and policy controls.
- Preserve existing functional flows, accessibility, keyboard focus, native Codex model selection, and secure Electron bridge behavior.
- Do not expose credentials or invent usage data.

## Brand Commitments

- Product name: CodexRouter.
- Visual direction for this redesign: clear, warm, colorful, calm, and operationally precise.
- Avoid black borders and monochrome-only surfaces; use a restrained warm palette with color reserved for system state and routing identity.

## Evidence on Hand

- Existing Electron renderer in `desktop/src/App.tsx` and `desktop/src/styles.css`.
- Existing token and visual reference files in `DESIGN/`.
- Existing logo asset in `assets/codexrouter-icon.png`.
- No marketing claims, testimonials, or external proof supplied.

## Product Principles

- Show operational truth before decoration.
- Make routing state legible at a glance.
- Keep configuration reversible and explicit.
- Use color to communicate system state, not as noise.
- Preserve native Codex behavior while making Router feel intentional.

## Accessibility & Inclusion

Maintain keyboard access, visible focus, readable contrast, reduced-motion support, semantic labels, and responsive layouts for narrower desktop windows.
