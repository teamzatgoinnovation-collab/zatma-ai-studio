# Design System

The UI is a modern, colourful enterprise SaaS interface: Indigo/Violet primary, Cyan secondary, light and dark themes, Inter type.

The code is split across three places:
* **Tokens:** `apps/web/src/app/globals.css`
* **Components:** `packages/ui` (`@zatma/ui`)
* **App shell:** `apps/web/src/components`

## Tokens

All colours are CSS variables, redefined under `.dark`. Tailwind v4 exposes them as utilities through `@theme inline`, for example `bg-primary`, `text-muted-foreground`, `border-border` and `bg-sidebar`.

| Token | Use |
|---|---|
| `background` / `foreground` | Page surface and body text |
| `card` / `card-foreground` | Cards, menus, dialogs |
| `muted` / `muted-foreground` | Subtle fills, secondary text |
| `primary` (indigo) / `secondary` (cyan) / `accent` (violet) | Brand, actions, highlights |
| `destructive`, `success`, `warning` | Status. Use `success-text` / `warning-text` for text on tinted backgrounds, which keeps WCAG AA contrast |
| `border`, `input`, `ring` | Lines, form borders, focus ring |
| `sidebar` | Sidebar surface |

* **Spacing:** Tailwind's 4px scale. Use 4, 8, 12, 16, 24, 32 and 48 (`1, 2, 3, 4, 6, 8, 12`).
* **Radius:** `rounded-lg` (8) for small controls, `rounded-xl` (12) for buttons and inputs, `rounded-2xl` (16) for cards and dialogs.
* **Type:** Inter via `next/font`. Page titles are `text-2xl font-semibold tracking-tight`, card titles are `text-base font-semibold`, body text is `text-sm`.

Gradients are reserved for the logo, the avatar and the auth hero. Avoid gradients elsewhere.

## Components (`@zatma/ui`)

| Group | Components |
|---|---|
| Actions | `Button` (`primary`, `secondary`, `outline`, `ghost`, `destructive`; sizes `sm`/`md`/`lg`/`icon`; `asChild`) |
| Forms | `Input`, `Label`, `FieldError`, `Select` (native, accessible) |
| Layout | `Card` (+ `Header`, `Title`, `Description`, `Content`), `PageHeader`, `Tabs` |
| Feedback | `Badge` (tones), `Alert`, `Skeleton`, `Spinner`, `Meter` (usage, `role="meter"`) |
| States | `EmptyState`, `ErrorState` (with retry) |
| Overlays | `Dialog`, `DialogContent`, `SheetContent` (off-canvas), `DropdownMenu*`, `Tooltip` (Radix primitives) |
| Command | `Command`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, `CommandEmpty`, `Kbd` (cmdk) |

## App shell

* **Sidebar** (`components/shell/sidebar.tsx`):
  * Collapsible groups that follow the product's module tree, defined once in `components/nav.ts`. The `nav.ts` tree also drives breadcrumbs, the command palette and module pages.
  * The group containing the current page opens automatically.
  * The whole sidebar collapses to icons with tooltips. That choice is persisted in the `zatma.sidebar` cookie, so the server renders it with no flicker.
  * Modules that haven't shipped yet carry a phase badge.
* **Top bar:** breadcrumbs, the search button (opens ⌘K / Ctrl K), the activity bell, and the user menu (account, organization, billing, theme, sign out).
* **Mobile:** the sidebar becomes an off-canvas sheet. The org switcher moves to the top bar.
* **Command palette:** jumps to every page, plus actions (invite, settings, plan, theme, sign out) and organization switching.
* **Activity bell:** recent audit-log activity for the organization. Unread state lives per browser in localStorage. Full notifications arrive in Phase 18.
* **Module pages:**
  * Every navigation entry resolves to a page.
  * Modules that haven't shipped render a roadmap layout through the catch-all route `(app)/[...module]`. It shows the module's purpose, its planned capabilities and related features available now, and never sample data.
  * Unknown paths return a 404.

## Design editor (Phase 5)

`apps/web/src/components/editor/`:
* `state.ts`: a pure reducer holding the document, selection and 100-step undo/redo history.
* `geometry.ts`: fit, zoom, snapping, crop and export maths.
* `fonts.ts`: Google Fonts stylesheet, script-aware defaults and the canvas font stack.
* `export.ts`: file names, PDF page sizing and downloads.
* `design-canvas.tsx` (react-konva) and `panels.tsx`.

Layout: a top bar (title, save state, undo/redo, zoom, grid, align, versions, template, duplicate, export), a tool panel on the left (Layers / Add / Bg / Copy), the canvas in the centre on a checkerboard, and properties on the right. Below `lg` the canvas comes first and the panels stack under it.

Accessibility:
* The canvas is a labelled `role="img"`. Everything you can do on the canvas can also be done from the Layers list and the Properties panel, using labelled inputs and buttons.
* Keyboard shortcuts are ignored while typing in a field.

## AI Copywriter (Phase 6)

`components/studio/copywriter.tsx` has two tabs:
* **Write:** the form card on the left and the variant cards on the right. They stack below `xl`.
* **Library:** filters, then a two-column card grid.

Variant cards:
* Copy is shown with `dir` and `lang` set, so Arabic renders right-to-left and screen readers pick the right voice.
* The length badge is neutral within limits, amber when longer than recommended, and red when over a hard platform limit. The detail line explains why in words, so the meaning does not rely on colour.
* The rewrite and translate actions reuse the dialog and menu primitives. Rewrites can be undone on the card (in the editor, with Ctrl+Z).

## CRM (Phase 7)

`components/crm/`:
* **`DataTable`:** a captioned `<table>` with a select-all checkbox and labelled row checkboxes.
* **`FormSheet` / `RecordForm`:** a right-hand sheet with config-driven fields. Errors are linked to their fields through `aria-describedby`, and the duplicate warning shows above the form.
* **`ActivityComposer`:** a radio group to pick the activity type. **`Timeline`:** Upcoming and History sections, with overdue and due badges.
* **`PipelineBoard`:** each column is a `<section>` labelled with its stage, count and total.
  * Cards can be dragged (HTML5) or moved with a "Move to" menu and Alt+←/→, so drag and drop is never the only way.
  * Closing stages always confirm.

Money uses `Intl.NumberFormat` (Indian grouping for INR, e.g. ₹1,50,000).

## Page states

| State | Implementation |
|---|---|
| Loading | Route-level `loading.tsx` skeleton, plus `Skeleton` in cards while queries load |
| Empty | `EmptyState` with a next action |
| Error | `ErrorState` with retry. Route-level `error.tsx`, plus `global-error.tsx` for the root layout |
| Not found | `not-found.tsx`, both inside the shell and at the root |
| Success | `sonner` toasts, top-right |

## Accessibility

Target: WCAG 2.1 AA.
* **Navigation:**
  * The skip link is the first focusable element.
  * Landmarks: `nav[aria-label=Main]`, `header`, `main#main`.
  * Breadcrumbs use `nav[aria-label=Breadcrumb]` and mark the current page with `aria-current="page"`, as does the sidebar.
* **Keyboard:**
  * Every interactive element has a visible focus ring.
  * Menus, dialogs and the command palette come from Radix and cmdk, so they get focus trapping, Escape to close and arrow-key navigation.
* **Forms:** every input has a label, and errors are linked through `aria-describedby` and announced with `role="alert"`.
* **Motion:** `prefers-reduced-motion` disables animations and transitions.
* **Verification:** each phase runs `@axe-core/playwright` against the main pages in both themes. It must report zero serious or critical violations.
