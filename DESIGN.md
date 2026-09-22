---
name: CodexRouter
description: Warm, clear desktop operations console for Codex accounts, routing, usage, and Jev policy.
colors:
  pine: "#315d4b"
  warm-stock: "#f4eddd"
  soft-stock: "#fbf7ee"
  paper-shadow: "#eee4d1"
  terracotta: "#c7773e"
  teal: "#347b7d"
  charcoal: "#28322d"
  graphite: "#53605a"
  hairline: "#d8cbb5"
typography:
  display:
    fontFamily: "OpenAI Sans, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3rem)"
    fontWeight: 650
    lineHeight: 1.16
    letterSpacing: "-0.03em"
  body:
    fontFamily: "OpenAI Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "11px"
  md: "16px"
  pill: "999px"
spacing:
  compact: "8px"
  section: "22px"
  page: "48px"
components:
  button-primary:
    backgroundColor: "{colors.pine}"
    textColor: "{colors.warm-stock}"
    rounded: "{rounded.pill}"
    height: "36px"
    padding: "8px 20px"
---

# Design System: CodexRouter

## Overview

**Creative North Star: “Park Atlas Desk.”**

A warm field atlas for the practical work of managing Codex accounts and routing. Pine green structures the workspace; warm paper carries information; terracotta and teal identify distinct states and actions. Operational data stays factual and legible, while the map influence appears through layered surfaces and consistent navigation rather than decorative illustration.

**Key Characteristics:**
- Warm, clear and colorful
- Compact vertical navigation with an active route
- Shared control geometry across every destination
- Jev is a first-class destination

## Colors

Warm stock and deep pine anchor the interface, with terracotta and teal reserved for emphasis and state.

### Primary
- **Pine** (#315d4b): Primary actions, active navigation and lead operational surfaces.

### Secondary
- **Terracotta** (#c7773e): Attention and warning states.
- **Teal** (#347b7d): Healthy status and secondary emphasis.

### Neutral
- **Warm stock** (#f4eddd): Main canvas.
- **Soft stock** (#fbf7ee): Controls and information panels.
- **Paper shadow** (#eee4d1): Sidebar and recessed surfaces.
- **Charcoal** (#28322d): Primary text.
- **Graphite** (#53605a): Secondary text.
- **Hairline** (#d8cbb5): Subtle dividers and control outlines.

## Typography

**Display Font:** OpenAI Sans (with system-ui, sans-serif)
**Body Font:** OpenAI Sans (with system-ui, sans-serif)
**Label/Mono Font:** ui-monospace, SFMono-Regular, Menlo, Consolas, monospace

**Character:** Clear, compact sans-serif hierarchy for frequent operational scanning. Monospaced type is reserved for identifiers, endpoints and measured values.

### Hierarchy
- **Display** (650, clamp(32px, 4vw, 48px), 1.16): Surface titles.
- **Title** (500–650, 16–28px, 1.26): Panel and row titles.
- **Body** (400, 14px, 1.5): Settings descriptions and operational content.
- **Label** (500–700, 11–14px, 1.4): Navigation groups, field labels, and statuses.

## Layout

The desktop layout uses a compact 238px vertical rail and a flexible content canvas. Main surfaces cap at 1180px and keep operational tables and forms aligned to a shared column. At widths below 760px, the rail becomes a horizontal navigation strip and secondary runtime metadata is hidden to protect content space.

## Elevation & Depth

Use tonal surfaces first. Soft offset shadows distinguish only the lead surface and raised panels; thin warm hairlines define controls and table structure. Avoid stark black outlines and heavy card stacks.

## Shapes

Controls and nav items use 11px corners; panels use 16px; compact chips and action buttons use pill geometry. Selects share an inset chevron with consistent right padding.

## Components

- **Navigation:** vertical grouped rail, pine active state, muted inactive labels, state dot where useful.
- **Primary button:** pine fill, warm text, pill shape; secondary action uses a warm surface and subtle hairline.
- **Select and input:** shared height, warm fill, subtle outline, visible pine focus ring. Select arrow is inset from the right edge.
- **Status:** teal for healthy, terracotta for warning, muted red for error; always pair color with a label or context.
- **Jev settings:** dedicated destination and shared setting-row grammar.

## Do's and Don'ts

- Keep all routes on the same warm palette and control geometry.
- Use color to clarify navigation and real system state.
- Keep code and identifiers in monospace only when they are data.
- Do not use black browser-default borders or unstyled native select arrows.
- Do not create decorative panels without operational content.
