## Why

The brand spec (`docs/brand/klarit-brand-system.html`) was substantially revised — it now defines a title-style field-label/description pair, a flat "head + rows" list-editor model with per-cell inline editing and two-level nesting, type badges on a fixed tag palette, and Vercel-derived interaction/motion/accessibility/performance rules. The shipped UI predates this: it uses uppercase eyebrow labels as field labels, boxed `FieldGroup` lists, always-on input boxes, `transition: all`, hardcoded `#fff` surfaces, and unlabeled icon buttons. The app no longer matches its own single source of truth.

## What Changes

- **Field labels**: adopt the title-style pair (label 13/600/ink → description 12/400/stone-600 → control). Stop using uppercase/overline as a field label (e.g. `WorkflowEditor.labelCls`); overline is reserved for group eyebrows. Optional is the default and is not annotated — only required gets `*`; errors render next to their field.
- **List editor model (BREAKING visual)**: replace the boxed `FieldGroup` with the flat "head + rows" model — header (title · count shown only when >0 · optional description) + hairline-separated rows + a left-aligned "+ add" final row (hover highlights the button only). Applies to `SettingsPanel`, `WorkflowEditor`, `RuleLibrary`, `CardTypeLibrary`.
- **Per-cell inline editing**: non-expandable rows (stages, card types, output paths, writable-scope paths, action buttons) render read-only text by default; hover shows ✏ (text) / ▾ (select); click edits that cell in place; blur or Enter commits, Esc cancels; keyboard-reachable (Enter/Space). Each cell is independent.
- **Expandable rows + accordion**: field-heavy rows (workflow nodes) use a summary row + indented detail; at most one row open per list; starting a drag first commits any editing cell and collapses the row.
- **Two-level nesting cap**: level 1 (settings-area lists, head bottom-border stone-300) and level 2 (sub-lists inside a detail: indent 28px, title 12px, no head bottom-line, blocks grouped by 24px spacing not dividers). Deeper structures must get their own detail page.
- **Type badges**: render requirement-type badges from the fixed 9-color tag palette with a fixed badge form; epic/feature/bug default to violet/green/red. The run-state four-color dots are kept (reserved).
- **Interaction / motion / a11y / performance**: `:focus-visible` rings, hit targets ≥24px, no `transition: all`, honor `prefers-reduced-motion`, `aria-label` on icon-only buttons, `aria-live` for toasts/validation, never block typing/paste, placeholders end with an ellipsis and give an example, virtualize long lists.
- **Tokens**: remove hardcoded colors (`#fff` surfaces, native Tailwind grays) in favor of semantic tokens; confirm `--color-tag-*` in `index.css` matches the brand palette.

## Capabilities

### New Capabilities
- `brand-ui-conventions`: the cross-cutting UI/UX requirements every Klarit surface must follow — field label/description pair, the list-editor "head + rows" model, per-cell inline editing, expandable-row accordion behavior, two-level nesting rules, type-badge rendering, and the focus/motion/accessibility/performance baseline. This is the implementable contract derived from the brand spec.

### Modified Capabilities
<!-- None at the requirement level: existing component specs keep their behavior; this change updates their presentation to conform to the new brand-ui-conventions capability. Per-component behavior (e.g. inline-edit, accordion) is captured as cross-cutting requirements in the new capability above. -->

## Impact

- **Renderer components (conform to new conventions)**: `SettingsPanel`, `Settings`, `WorkflowEditor`, `WorkflowLibrary`, `WorkflowPicker`, `RuleLibrary`, `CardTypeLibrary`, `ConstitutionSettings`, `NewRequirementFlow`, kanban (`KanbanBoard`/`BoardColumn`) and any requirement-card rendering.
- **Styles/tokens**: `src/renderer/src/index.css` — confirm/align `--color-tag-*`; ensure no hardcoded `#fff`/native-gray surfaces remain in the touched components; global `prefers-reduced-motion` and `:focus-visible` conventions.
- **Source of truth**: `docs/brand/klarit-brand-system.html` (chapters 06–13).
- **Tests**: component/contract tests (Vitest + @testing-library) for the new field-label semantics, list-editor inline-edit/accordion behavior, and empty/count states, following the project's test-first rule. No backend/API or data-model changes.
