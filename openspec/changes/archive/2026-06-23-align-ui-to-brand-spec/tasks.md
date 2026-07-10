## 1. Shared UI primitives (test-first)

- [x] 1.1 Confirm `--color-tag-*` in `src/renderer/src/index.css` matches the brand palette; add global `:focus-visible` ring + `@media (prefers-reduced-motion: reduce)` conventions if missing
- [x] 1.2 Write tests for `Field` (label 600/ink + description 400/stone-600 order, required `*`, no optional marker, error adjacency) — red
- [x] 1.3 Implement `components/ui/Field.tsx` to pass 1.2
- [x] 1.4 Write tests for `InlineCell` (read-only by default, click/Enter/Space enters edit & focuses, blur/Enter commits, Esc cancels, independent per cell, `aria-label`/role) — red
- [x] 1.5 Implement `components/ui/InlineCell.tsx` to pass 1.4
- [x] 1.6 Write tests for `ListEditor` (head title/description, count hidden when 0 / shown when >0, hairline rows, trailing left-aligned add button, empty state = head + add only) — red
- [x] 1.7 Implement `components/ui/ListEditor.tsx` (+ `IconButton`, `DragHandle`, `ReorderArrows` atoms) to pass 1.6
- [x] 1.8 Write tests for `ExpandableRow` accordion (only one open per list; expanding closes others; commit+collapse on drag start) — red
- [x] 1.9 Implement `components/ui/ExpandableRow.tsx` to pass 1.8

## 2. SettingsPanel (general)

- [x] 2.1 Adjust tests for general settings fields to the new label/description pair semantics — red (existing behavior tests query selects by aria-label; kept green)
- [x] 2.2 Migrate `SettingsPanel` general section (appearance / language / default agent / default model) to `Field`; remove the 13px-label-collides-with-help styling
- [x] 2.3 Replace any hardcoded `#fff`/native grays in `SettingsPanel` with semantic tokens; add `aria-label`s to icon-only controls (SELECT_CLS now reuses token-based inputClass)

## 3. WorkflowEditor

- [x] 3.1 Updated `WorkflowEditor.test.tsx`: add buttons no longer carry a literal `+` (now a Plus icon), so `'+ 加X'` queries → `'加X'`. (19 tests green.)
- [x] 3.2 Replaced `FieldGroup` (boxed) with `ListEditor` (head + rows + add末row, de-boxed) and `labelCls` uppercase eyebrow → title-style (13/600/ink). Validation, dnd-kit reordering, IPC behavior intact.
- [x] 3.3 Nodes use a **detail view** (not inline accordion), per the brand rule "drag and inline-expand are mutually exclusive" + "max two nesting levels (deeper → detail view)". Node list rows are read-only & draggable (handle · ordinal · name · stage · edit→ · delete); clicking enters `NodeDetail` (name/stage/type/executor/writable-scope/outputs/gate, "← 返回节点列表"). This eliminates the drag-offset/double-content issues and resolves the gate→actions 3rd-level nesting. Stages/paths/actions still use per-cell `InlineCell`. Brand §12 behavior table updated (drag↔expand exclusivity, third level forbidden). 19 tests rewritten to enter the node detail; green.
- [x] 3.4 Removed dead `fieldGroupCls`/`fgHeadCls`/`fgTitleCls`/`fgHintCls`/`fgCountCls`/`addBtnCls`; `inputCls`/`selectCls` already token-based. Typecheck clean.

## 4. RuleLibrary, CardTypeLibrary, ConstitutionSettings

- [x] 4.1 Migrated `RuleLibrary`: `FieldGroup` → `ListEditor` (de-boxed), `labelCls` uppercase → title-style, pack list `<li>` boxes → hairline `ListRow`, delete/clone/export via `IconButton`. Test `'+ 加客观门校验'` → `'加客观门校验'`. (Inline-edit cells deferred with the node-accordion in 3.3.) Tests green.
- [x] 4.2 Migrate `CardTypeLibrary`: boxed `<li>` rows → hairline `ListRow`; editor uppercase labels → `Field`. Editor is now **inline/expandable in place** (no full-page swap): new type opens an inline editor above the list, editing a type expands its row in place. Type badges use the tag palette via `cardBadgeClass`. Tests green.
- [x] 4.3 Migrated `ConstitutionSettings`: pack `<li>` boxes → hairline rows; pointless uppercase effective-heading → title-style. Tests green.
- [x] 4.4 Swept touched files: no real hardcoded `#fff`/`bg-white`/`text-gray-`/`transition: all` (only mentions in comments); icon buttons use `IconButton` with `aria-label`.

## 5. WorkflowLibrary / WorkflowPicker / NewRequirementFlow / kanban polish

- [x] 5.1 De-boxed `WorkflowLibrary` list rows and `WorkflowPicker` radio rows (boxed cards → hairline rows). Tests green.
- [x] 5.2 `NewRequirementFlow`: field labels → title-style (`labelCls`). Candidate type badges already use the tag palette (`TYPE_BADGE_CLS`); native inputs already don't block typing. (Placeholder ellipsis/example left as a minor follow-up to avoid churning `getByPlaceholderText` tests.)
- [x] 5.3 Kanban: columns are already token-based cards with no count badge (nothing to hide); de-box not applicable (columns are intentional cards). No hardcoded colors.
- [x] 5.4 Decision: descope the global `aria-live="polite"` toast region to a future change. Inline field errors already announce via adjacent `role="alert"`; a global polite live-region for transient toasts is tracked separately and not blocking this change.

## 5b. Full inline-edit + fixes (follow-up requested)

- [x] 5b.1 WF single-input rows → per-cell inline edit: writable-scope paths & output paths use `InlineCell` (mono, auto-edit on new empty row, live path validation via `aria-invalid`); manual-gate action label/command use `InlineCell`. Removed dead `PathInput`. 19 WF tests green.
- [x] 5b.2 De-boxed remaining per-item boxes: `SuggestedTypesField` items (the original Image #12 complaint) and gate items → hairline-separated blocks; removed `subCardCls`.
- [x] 5b.3 `InlineCell` gained `autoEditEmpty` + `validate` props (auto-enter edit on empty new rows; live aria-invalid/red border).
- [x] 5b.4 Fix: level-2 sub-list headers regained their hairline divider (`门`/`可写范围`/`产出` no longer look bare) — in both code and the brand spec §12.
- [x] 5b.5 Fix: drag handle no longer offsets when a bottom-of-popup node auto-collapses — collapse now fires on the handle's pointer-down (before dnd-kit captures the baseline) instead of on `dragStart`.

## 6. Verification

- [x] 6.1 `npm run typecheck` passes (both configs)
- [x] 6.2 `npm run test:run` passes — 488 tests / 55 files, incl. new primitive behavior + migrated surfaces
- [x] 6.3 Swept touched files for `#fff`/`bg-white`/`text-gray-`/`transition: all` — no real hits (only comment mentions)

## 7. Dogfooding refinements (this round — also written into docs/brand + spec.md)

- [x] 7.1 Nodes & field-heavy types use a **detail view** (not inline accordion): list rows are read-only & draggable; a row-end pencil opens the detail page. Resolves the drag-vs-expand conflict and the >2-level nesting (gate→actions). Applies to workflow nodes, 需求卡 (CardTypeLibrary), and 建议需求卡类型 (SuggestedTypesField).
- [x] 7.2 Affordance rule codified: **pencil = open detail page; chevron = expand in place**; never mixed. Drag and inline-expand are mutually exclusive.
- [x] 7.3 Shared `DetailHeader` + modal header **slot**: every settings detail/edit view routes its back (left-chevron icon) + compact save onto the **same row as the modal close (X)**. Applied to WorkflowEditor (list + node + suggested-type detail), CardTypeLibrary (editor + preview), RuleLibrary (pack editor).
- [x] 7.4 Settings = **one input per row** (no side-by-side): node name/stage/type, executor tool/model, action label/command all stacked.
- [x] 7.5 **No mixing** click-to-edit with always-present controls in one item: output path & gate action fields became persistent inputs (they sit beside template radios / required checkbox).
- [x] 7.6 RuleLibrary pack items → **expandable rows** (collapsed = read-only name; expanded = editable name + content); whole-block hover; field spacing 16px.
- [x] 7.7 **Dual-info row** convention (name 13/ink + secondary 12/stone-600, read-only) for node rows.
- [x] 7.8 **Ordinals**: removed `#` prefix; reorderable lists (stages, nodes) show only a drag handle, no ordinal. Stages became drag-reorderable.
- [x] 7.9 **Type-weight hierarchy**: section/list titles 600, in-row item names 500, body 400.
- [x] 7.10 Icon buttons: **specific `aria-label`** (e.g. 删除 Epic) + concise `title` tooltip (bare verb e.g. 删除). `BackButton` uses left-chevron; `IconButton` derives the concise verb.
- [x] 7.11 **Managed library lists** (workflow library, 需求卡, rule packs) use the shared ListEditor head (title 600 + count + stone-300 divider) + bottom "+ 新建" add row; import/preview as head-right ghost actions.
- [x] 7.12 Sidebar nav rows tightened (gap so hover/selected backgrounds don't merge); modal header buttons (back/save/close) equalized to h-7.
- [x] 7.13 Constitution: dropped the redundant "生效宪法" summary; aligned to the list head + level-2 indent.
- [x] 7.14 App shell aligned to §07: kanban column head 12/600, cobalt "+ 创建", 10px board spacing; sidebar tabs active = cobalt-50/cobalt-800 chip; sidebar tab/tree spacing symmetric. (Column width kept at 288px per user preference.)
- [x] 7.15 Re-ran typecheck + full suite after each change set — 488 tests / 55 files green throughout.
- [x] 6.4 Dogfooded with the user across many rounds (switched to `npm run dev` per user request for live iteration) across Settings, WorkflowEditor, RuleLibrary, CardTypeLibrary/需求卡, Constitution, WorkflowPicker, and the app shell. User confirmed the result ("差不多了"). All iterative refinements captured in §7 below + folded into `docs/brand` and this spec.
