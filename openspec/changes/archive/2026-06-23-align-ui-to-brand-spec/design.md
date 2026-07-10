## Context

The UI conventions now live in `docs/brand/klarit-brand-system.html` (chapters 06–13). The shipped renderer diverged: `WorkflowEditor` defines its own `labelCls`/`inputCls`/`FieldGroup` (boxed lists, uppercase eyebrow labels, always-on inputs); `SettingsPanel` uses 13px labels that collide with help text; `RuleLibrary`/`CardTypeLibrary` repeat similar ad-hoc patterns. Each surface re-implemented the same widgets slightly differently — which is exactly how the drift happened. Stack: React 19 + Tailwind v4 (semantic tokens in `index.css`), `@dnd-kit` for reordering, Vitest + @testing-library, test-first is non-negotiable.

## Goals / Non-Goals

**Goals:**
- One implementation of the brand conventions, reused by every settings/edit surface, so they can't drift again.
- Field label/description pair, "head + rows" list editor, per-cell inline editing, expandable-row accordion, two-level nesting, type badges, and the focus/motion/a11y/token baseline — all behavior captured in the `brand-ui-conventions` spec.
- Incremental, test-first migration with no change to data models, IPC, or persisted shapes.

**Non-Goals:**
- No new product features (no terminal, dockview, agent/decision views, or rendered workflow-status badges — those remain future work).
- No backend/IPC/schema changes; `--color-tag-*` already exists in `index.css` (verify only).
- Not redesigning the kanban data flow — only its presentation (count-only-when-`>0`, full-height columns, tokens).

## Decisions

**1. Extract shared UI primitives into `src/renderer/src/components/ui/`.**
New presentational components: `Field` (label + optional description + control slot, required/optional/error handling), `ListEditor` (head with title/description/count-when-`>0` + rows + trailing add button), `InlineCell` (read-only ↔ edit toggle per cell, keyboard-activatable), `ExpandableRow` (summary + indented detail), and small atoms (`IconButton`, `DragHandle`, `ReorderArrows`). Rationale: the drift came from each screen rolling its own widgets; a single source prevents recurrence and makes the spec testable in one place. Alternative considered — a shared CSS class kit only (like the brand HTML). Rejected: React components let us encapsulate the inline-edit/accordion behavior and a11y wiring, not just styling.

**2. Inline editing is component-local state, committed to the parent on blur/Enter.** `InlineCell` owns an `editing` boolean and renders read-only text or the control; it calls `onCommit(value)` on blur-out/Enter and reverts on Esc. Parents keep being the source of truth for the data. Alternative — a global edit-mode store. Rejected: over-engineered; editing is inherently local and transient.

**3. Accordion = controlled open state in `ListEditor`, not native `<details>`.** The list tracks a single `openId`; opening one closes others. Rationale: native `<details>` can't enforce "one open" without JS anyway, and `@dnd-kit` needs controlled rows to commit/collapse on drag start. On `dragStart`, commit the active cell and clear `openId`.

**4. Styling stays in Tailwind semantic-token classes** (the project rule), mirroring the brand HTML's CSS values (e.g. label `text-[13px] font-medium`→use 600 via `font-semibold`, description `text-[12px] text-stone-600`, rows `border-b border-stone-100`, add button hover `hover:bg-cobalt-50`). Reduced-motion + `:focus-visible` are handled globally in `index.css`; components add `focus-visible:` ring utilities and `aria-label`s.

**5. Migrate surface-by-surface behind the new primitives, test-first.** Order: primitives (with their own tests) → `SettingsPanel` (general fields) → `WorkflowEditor` (largest: stages list, nodes accordion, sub-lists, executor fields) → `RuleLibrary` → `CardTypeLibrary` → `ConstitutionSettings` → `NewRequirementFlow`/kanban polish. Each step: write/adjust tests against the public behavior first (red), then swap the implementation (green).

## Risks / Trade-offs

- **`WorkflowEditor` is large and behavior-rich (validation, dnd-kit, sub-lists)** → Mitigation: keep its data/validation logic intact; only replace the presentational layer; rely on existing `WorkflowEditor.test.tsx` plus new behavior tests to catch regressions.
- **Inline-edit reduces affordance discoverability** (text looks static) → Mitigation: hover ✏/▾ cue, full keyboard activation, and the cell hover background; covered by spec scenarios.
- **Inline-edit ↔ dnd-kit interplay** (dragging while a cell is focused) → Mitigation: commit-and-collapse on `dragStart` (a stated requirement); test the handler.
- **Accessibility regressions** when converting native inputs to read-only-until-edit → Mitigation: `role`/`tabindex`/Enter-Space on read-only cells, `aria-label`s on icon buttons; assert in tests.
- **Visual-only diffs are easy to under-test** → Mitigation: assert semantics (label text/level, count hidden at 0, error adjacency, aria attributes, editing transitions) rather than pixels; verify dark mode by token usage, not snapshots.

## Migration Plan

1. Land `src/renderer/src/components/ui/` primitives with unit tests (no consumers yet).
2. Migrate consumers one at a time; delete each screen's bespoke `labelCls`/`FieldGroup`/inline-input code as it adopts the primitives.
3. Sweep for hardcoded `#fff`/native grays in touched files; replace with tokens. Confirm `--color-tag-*` matches the brand palette.
4. Run `npm run typecheck` + `npm run test:run`; dogfood via `npm start` (no watch) to verify light/dark.
Rollback: revert per-surface commits; primitives are additive and unused until adopted.

## Open Questions

- Should the kanban requirement card (once cards are rendered on-board) reuse `ExpandableRow`, or get a dedicated card component? Deferred — board cards are out of scope until cards land on the board.
- Exact `inputmode`/`autocomplete` values per field are decided during each surface's migration (low risk, no architectural impact).
