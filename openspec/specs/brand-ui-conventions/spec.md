# brand-ui-conventions Specification

## Purpose
TBD - created by archiving change align-ui-to-brand-spec. Update Purpose after archive.
## Requirements
### Requirement: Field label / description pair
Form fields SHALL render a title-style label and an optional description, differentiated by size, weight, and color only (never by letter-casing). The label SHALL be 13px / weight 600 / `text-ink`; the description SHALL be 12px / weight 400 / `text-stone-600`. The order SHALL be label → description → control. Optional fields SHALL NOT be annotated; only required fields SHALL append a `*` marker in the signal color. The uppercase/letter-spaced "overline" style SHALL NOT be used as a field label; it is reserved for group/section eyebrows.

#### Scenario: Label and description are visually distinct
- **WHEN** a field with both a label and a description renders
- **THEN** the label is 13px/600/ink and the description is 12px/400/stone-600, the description sits directly under the label and above the control, and neither relies on `text-transform: uppercase`

#### Scenario: Required vs optional marking
- **WHEN** a field is required
- **THEN** its label appends a `*` in the signal color
- **WHEN** a field is optional
- **THEN** its label shows no "optional" text or marker

#### Scenario: Field error is shown next to the field
- **WHEN** a field fails validation
- **THEN** the field's control border and its description/message render in the danger color, adjacent to that field

### Requirement: List-editor "head + rows" model
Repeatable lists SHALL use a flat "head + rows" structure instead of per-row boxes. The head SHALL show a title (13/600/ink), an optional description line, and a count badge that is shown ONLY when the count is greater than zero. Rows SHALL be separated by hairline dividers (no per-row border, background, or radius). Adding an item SHALL be a left-aligned "+ add" button rendered as the final row whose hover highlight covers only the button, never the full row.

#### Scenario: Count badge visibility
- **WHEN** a list has zero items
- **THEN** no count badge is shown
- **WHEN** a list has one or more items
- **THEN** the count badge shows the item count

#### Scenario: Empty list
- **WHEN** a list is empty
- **THEN** it shows only the head and the "+ add" final row, with no empty box or placeholder card

#### Scenario: Add control placement and hover
- **WHEN** the user hovers the "+ add" control
- **THEN** only the button area is highlighted (not the entire row width), and the control is left-aligned as the last row

### Requirement: Per-cell inline editing
Per-cell inline editing SHALL be used ONLY for pure single-value list rows (a row whose only editable content is one value, with no sibling form controls), e.g. stage names and writable paths. Such an editable value SHALL display as read-only text by default; on hover it SHALL reveal an edit affordance (✏ for free text, ▾ for a select); on activation it SHALL replace that cell with the corresponding control and focus it. Committing SHALL occur on blur out of the cell or on Enter, and SHALL write the value back to read-only text; Esc SHALL cancel. Read-only cells SHALL be keyboard-reachable and activatable with Enter or Space. Always-on controls (drag handle, ordinal, delete, checkbox, color swatch) SHALL NOT participate in the read-only/edit toggle.

Click-to-edit and always-present controls SHALL NOT be mixed within one item: if an item contains any always-present control (radio, checkbox, select, or a persistently-shown input), then ALL of that item's fields SHALL be always-present inputs — its text fields SHALL NOT be click-to-edit. (Example: an output item with a "required" checkbox and a template radio group SHALL render its path as a persistent input, not a click-to-edit cell.)

#### Scenario: No mixing of click-to-edit and persistent controls
- **WHEN** an item contains an always-present control (checkbox / radio / select / persistent input)
- **THEN** every text field in that item is also a persistent input, with none rendered as click-to-edit

#### Scenario: Enter edit on one cell only
- **WHEN** the user clicks the read-only value of one cell in a multi-cell row
- **THEN** only that cell becomes an editable, focused control and the other cells remain read-only

#### Scenario: Commit and cancel
- **WHEN** an editing cell loses focus to outside the cell, or the user presses Enter
- **THEN** the cell writes its value back and returns to read-only
- **WHEN** the user presses Esc while editing a cell
- **THEN** the edit is discarded and the cell returns to read-only

#### Scenario: Keyboard access
- **WHEN** a read-only cell is focused and the user presses Enter or Space
- **THEN** the cell enters edit mode

### Requirement: Expandable rows with accordion behavior
Non-draggable, field-light items MAY render as an expandable row: a summary row (showing a read-only name) plus an indented detail region (no nested box). Collapsed, the summary SHALL show only the read-only name. Within one list, at most one row SHALL be expanded at a time; expanding a row SHALL collapse any other open row in that list. The bottom hairline divider and the hover highlight SHALL be applied to the whole item wrapper (summary + detail) so the entire expanded block highlights as one item, not just the summary row. Inside a detail region, form fields SHALL be grouped by ~16px spacing (a label+control is one group); sub-lists are separated by ~24px. Detail spacing SHALL rely on whitespace, not divider lines.

#### Scenario: Single open row
- **WHEN** the user expands a row while another row in the same list is already expanded
- **THEN** the previously expanded row collapses so only one row is open

#### Scenario: Whole-block hover and spacing
- **WHEN** an expandable row is open and hovered
- **THEN** the whole block (summary + detail) shows one hover background, the detail blocks are separated by spacing (no per-block divider lines), and the summary connects to the detail without a divider between them

### Requirement: Two-level nesting limit
List nesting SHALL be limited to two levels. Level 1 lists SHALL render directly in the settings area with a head bottom-border in `stone-300`. Level 2 sub-lists (inside a detail region) SHALL indent ~28px, use a 12px head title, omit the head bottom-line, and rely on 24px spacing to separate from sibling blocks. Structures requiring a third level SHALL instead be given their own detail page.

#### Scenario: Level distinction
- **WHEN** a level-2 sub-list renders inside an expanded detail
- **THEN** it is indented, its head title is 12px, and its head has no bottom-line, distinguishing it from the level-1 list

#### Scenario: No third level
- **WHEN** content would require nesting a list inside a level-2 sub-list
- **THEN** that content is given a dedicated detail page instead of a third nested level

### Requirement: Type badges from the tag palette
Requirement-type badges SHALL render with a fixed badge form (solid pill, 11/500, uppercase Latin with letter-spacing) colored from the fixed 9-color tag palette (`--color-tag-*`). Color choice per type SHALL be user-selectable from that palette; the seeded defaults SHALL be epic → violet, feature → green, bug → red. Bright palette colors (yellow, cyan) SHALL use `tag-ink` text; others SHALL use white text. The run-state four-color dots (`state-idle/system/agent/decision`) SHALL be retained.

#### Scenario: Default type colors
- **WHEN** the default card types are seeded
- **THEN** epic uses the violet tag color, feature uses green, and bug uses red

#### Scenario: Badge text contrast
- **WHEN** a type badge uses the yellow or cyan tag color
- **THEN** its text uses `tag-ink`; for all other tag colors the text is white

### Requirement: Interaction, focus, and motion baseline
Interactive UI SHALL show a visible focus indicator using `:focus-visible`. Interactive hit targets SHALL be at least 24px. Transitions SHALL list explicit properties (never `transition: all`) and animate only `transform`/`opacity` where feasible. The UI SHALL honor `prefers-reduced-motion` by reducing or removing animation.

#### Scenario: Keyboard focus is visible
- **WHEN** the user navigates to an interactive element with the keyboard
- **THEN** a focus ring is shown via `:focus-visible` (and not shown for mouse interaction)

#### Scenario: Reduced motion
- **WHEN** the OS setting `prefers-reduced-motion: reduce` is active
- **THEN** UI animations and transitions are reduced or removed

#### Scenario: Reduced motion honored on transitions
- **WHEN** a transition would otherwise animate
- **THEN** with reduced-motion active it is shortened/removed, and no transition uses `transition: all`

### Requirement: Accessibility and content baseline
Icon-only controls SHALL have an `aria-label` that is specific to the target (e.g. "删除 Epic", so a screen-reader user knows the object). A `title` hover tooltip is OPTIONAL and, when present, SHALL be the bare action verb only (e.g. "删除", "编辑"), without the object name. `aria-label` (screen-reader, not shown on hover) and `title` (mouse hover tooltip) are distinct and both MAY coexist. Inputs SHALL NOT block typing or paste, SHALL use an appropriate `type`/`inputmode`, and placeholders SHALL end with an ellipsis and provide an example value (placeholders SHALL NOT replace labels). Status SHALL NOT be conveyed by color alone.

#### Scenario: Icon button has an accessible name
- **WHEN** a control renders as an icon with no visible text
- **THEN** it exposes a specific `aria-label` describing its action and object; any `title` tooltip shows only the bare action verb

#### Scenario: Typing is never blocked
- **WHEN** a user types or pastes any characters into a field, including characters the field does not ultimately accept
- **THEN** the keystrokes are accepted and validation feedback is shown rather than the input being blocked

### Requirement: Semantic color tokens only
UI surfaces and text SHALL use semantic design tokens (`bg-canvas`/`bg-paper`/`text-ink`/`border-stone-*`/`*-cobalt-*`/`--color-tag-*` etc.) and SHALL NOT hardcode colors such as `#fff` surfaces or native Tailwind grays, so dark mode works via token overrides. The only permitted exceptions are the modal scrim (`bg-black/50`) and `text-white` on solid colored buttons/badges.

#### Scenario: No hardcoded surface colors
- **WHEN** a component renders a surface or text color
- **THEN** it uses a semantic token (not `#fff`, `bg-white`, or `text-gray-*`), except the modal scrim and white text on colored fills

#### Scenario: Dark mode follows tokens
- **WHEN** the active theme is dark
- **THEN** the component recolors correctly because it uses semantic tokens overridden by `html[data-theme='dark']`

### Requirement: Edit affordance — pencil vs chevron
A list MAY use one of two editing affordances, and SHALL NOT mix their semantics: a pencil icon button SHALL mean "open a dedicated detail page"; a chevron SHALL mean "expand/collapse in place". A list SHALL NOT present a pencil that expands in place, nor a chevron that navigates away. Field-heavy items SHALL use the pencil → detail-page path.

#### Scenario: Pencil opens a detail page
- **WHEN** a list row shows a pencil edit button at its end
- **THEN** activating it opens a dedicated detail page (it does not expand the row in place)

### Requirement: Drag and inline-expand are mutually exclusive
A draggable (reorderable) list SHALL NOT also inline-expand its rows, and vice versa. For a draggable, field-heavy list, rows SHALL be read-only summaries that open a dedicated detail page; entry to the detail SHALL be via an explicit edit (pencil) button at the row end, NOT a whole-row click. A list that inline-expands SHALL NOT provide drag reordering (use ▲▼ if ordering is needed).

#### Scenario: Draggable list opens detail via row-end button
- **WHEN** a draggable list row needs editing of many fields
- **THEN** the row stays a read-only summary and a row-end pencil button opens its detail page; the whole-row click does not enter edit

### Requirement: Detail/edit view header on the close row
A detail or edit view SHALL present a single top bar holding a back control on the left and (when applicable) a save action on the right. The back control SHALL be a unified left-chevron icon button (no text label). The save SHALL be a compact primary button at the same height as the back control. When the view is hosted inside the settings modal, this back/save bar SHALL render on the same row as the modal close (X) — i.e. routed into the modal header slot — not as a separate bar below it. Every settings detail/edit view SHALL reuse this shared header rather than drawing its own.

#### Scenario: Back and save share the close row
- **WHEN** a detail/edit view is shown inside the settings modal
- **THEN** its back chevron and save button appear on the same row as the modal close (X)

### Requirement: Dual-info row presentation
When a single row must show two pieces of information (e.g. a node name and its stage), the primary value SHALL be 13/`text-ink` and the secondary value SHALL follow it at 12/`text-stone-600`; primary first, secondary after, separated by spacing. The secondary value SHALL be read-only.

#### Scenario: Primary and secondary are differentiated
- **WHEN** a row shows a name plus a secondary attribute
- **THEN** the name is 13/ink and the secondary is 12/stone-600, read-only, placed after the name

### Requirement: One input per row in settings
Within the settings interface, each row SHALL contain at most one input control; side-by-side inputs (e.g. name+stage+type, tool+model, label+command) are NOT allowed. Each field SHALL occupy its own row (label → description → control). This constraint is scoped to the settings interface; other areas of the app MAY place inputs side by side.

#### Scenario: Fields stack one per row
- **WHEN** a settings form has multiple inputs
- **THEN** each input is on its own row, with no two input controls placed side by side

### Requirement: Ordinals and reorder affordances
Reorderable lists (e.g. stages, workflow nodes) SHALL show only a drag handle and SHALL NOT display an ordinal number; ordering is expressed by position. Non-reorderable label lists MAY show a plain row number, which SHALL NOT be prefixed with `#`. A drag handle and an ordinal SHALL NOT both appear on the same row.

#### Scenario: Reorderable rows have no ordinal
- **WHEN** a list is reorderable via a drag handle
- **THEN** its rows show the drag handle and no ordinal number

#### Scenario: Plain ordinals have no hash
- **WHEN** a non-reorderable list shows a row number
- **THEN** the number is plain (e.g. "1"), not "#1"

### Requirement: Type-weight hierarchy
Text weight SHALL encode hierarchy consistently: section / list titles use 13/600 (semibold); in-row item names (e.g. a rule name, node name shown as a row summary) use 13/500 (medium); body and descriptions use 400. An item name SHALL NOT use 600 (which is reserved for section/list titles), so item names do not visually compete with headings.

#### Scenario: Item name is lighter than the section title
- **WHEN** a list shows a section title and item-name rows
- **THEN** the title is 600 and the item names are 500 (not 600)

### Requirement: Managed library lists
"Library" management lists (workflow library, card types, rule packs) SHALL use the same head+rows model as inline lists: one head (title 13/600 + count + `stone-300` bottom divider), rows, and a left-aligned bottom "+ new" add button. The "new" action SHALL NOT be a top-right filled button. Library-level actions (import, preview, export) SHALL sit at the head's right as secondary ghost buttons.

#### Scenario: Library uses the standard head and add row
- **WHEN** a library management list renders
- **THEN** it shows a list head with a bottom divider, a bottom-left "+ new" add row, and any import/preview/export actions as secondary buttons in the head right

### Requirement: Whole-item hover for composite rows
A composite item that contains multiple fields (e.g. an output = path + template + required) SHALL apply its hover background to the whole item block (same `stone-100/45` as a single row), not to only one of its inner rows — visually reading as one item.

#### Scenario: Composite item highlights as one block
- **WHEN** the user hovers any part of a multi-field item
- **THEN** the entire item block shows one hover background

