# GitHub Copilot & Workspace Instructions

When generating or editing UI components and animations in this repository:
- Comply with all design tokens, physics laws, and invariants detailed in [`AGENTS.md`](../AGENTS.md).
- Use canonical spring presets (`SPRING_BOUNCY`, `SPRING_SNAPPY`, `SPRING_GENTLE`, `SPRING_HEAVY_SNAP`) from `code-examples/ClaudeMotionPresets.ts`.
- Use semantic CSS tokens from `code-examples/cds-theme.css`.
- Ensure dark mode support and single-stroke border discipline.
- Guard against CJK IME composition issues with `!(isComposing || keyCode === 229)`.
- Run `npm run typecheck` and `npm run build` to verify changes.
