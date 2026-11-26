# CashFlow Copilot design system

## Direction

An Indian supplier should be able to scan cash risk, verify its source, and choose the next action without translating the interface. Keep the existing product identity and navigation. Use the Vantage direction already established in the Cash Outlook page, with the forest and mint brand palette.

## Tokens

The source of truth is `client/src/pages/Outlook/tokens.css`. Import it rather than copying token values. Shared page aliases live in `client/src/hallmark-pages.css`.

- **Paper and surfaces:** `--bg`, `--surface`, `--surface-2`
- **Text and rules:** `--text`, `--muted`, `--border`, `--border-strong`
- **Brand:** `--brand-forest`, `--brand-mint`, `--brand-mint-light`
- **Type:** `--font-sans` across headings and body copy
- **Spacing:** 4px base scale, using `--space-2xs` through `--space-2xl`
- **Corners:** compact 6px card radius and 8px control radius
- **Focus:** visible 2px outline with offset on keyboard-operable controls

## Page language

Workspace screens are work surfaces, not marketing pages. Put the task name first, then evidence, then the next usable control. Avoid decorative hero blocks, invented metrics, and filler eyebrow labels. Use current workspace data and explain empty, loading, stale, and error states in place.

- **Cash Outlook:** forecast chart and short-horizon cash decisions.
- **Setup & Import:** workspace setup, imports, and reconciliation.
- **Cash Shock Lab:** cash scenarios and their evidence.
- **Rescue Planner:** payment choices and their forecast effects.
- **Order Analyzer:** proposed order costs, timing, and risk.
- **Cash Copilot:** grounded answers with visible source records.
- **Action Center:** dated action signals with direct routes to their source.
- **Operations:** collections, supplier payments, and connected systems.
- **Authentication:** one focused form with clear progress and error states.

## Components and behavior

Use the existing shared shell, navigation, data models, and handlers. Cards group evidence or actions; metrics remain compact and tabular. Forms use readable labels, 44px minimum controls, and a clear keyboard focus state. Tables scroll within their own region on narrow screens. Collapse multi-column layouts at tablet and phone widths without hiding actions or data.

## Content

Use concise, literal labels. Retain Indian rupee formatting, local dates, and business terminology. Keep important state and provenance visible beside the number it describes. Use text labels and native controls instead of emoji decoration. Do not imply that recommendations have executed payments or changed ledger records.

## Verification

Run the client production build and scoped Hallmark lint after shared page changes. Render review requires the project to be running and the Hallmark render dependency available. Record unavailable visual checks rather than claiming a render pass.
