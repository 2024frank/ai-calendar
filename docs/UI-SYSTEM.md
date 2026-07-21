# AI Calendar UI System

The UI is organized in three layers so product pages stay readable and behavior remains consistent.

```text
src/components/ui/       Reusable primitives with no product data dependencies
src/components/          Product-wide composition such as navigation and the app shell
src/app/**                Route-specific data loading and workflow composition
```

## Primitives

### Button

```tsx
<Button variant="primary" icon="check" loading={saving}>
  Approve Event
</Button>

<ButtonLink href="/sources/new" variant="primary" icon="plus">
  Add Source
</ButtonLink>

<IconButton label="Use dark theme" icon="moon" />
```

`Button` accepts native button attributes plus:

- `variant`: `primary | secondary | ghost | danger`
- `size`: `sm | md`
- `icon`: a typed `IconName`
- `loading`: disables the control, exposes `aria-busy`, and displays an activity indicator

Use `ButtonLink` for navigation so open-in-new-tab and browser history continue to work. Use `IconButton` only with a specific accessible `label`.

### Surface & Layout

```tsx
<PageHeader
  eyebrow="Quality Control"
  title="Review Queue"
  description="Check extracted event details before publishing."
  actions={<ButtonLink href="/review">Open Queue</ButtonLink>}
/>

<Card className="surface--flush">
  <TableShell label="Pending events">
    <table className="tbl">…</table>
  </TableShell>
</Card>
```

- `Card` accepts standard `div` attributes.
- `PageHeader` accepts `title`, optional `description`, `eyebrow`, and `actions` slots.
- `TableShell` gives dense tables an accessible, keyboard-focusable horizontal overflow region.
- `EmptyState` accepts an icon, title, description, and optional action.
- `Alert` supports `info | success | warning | danger` and announces asynchronous status changes.
- `LoadingState` and `Skeleton` provide route and local loading feedback without layout shift.

### Status

```tsx
<StatusBadge tone="warning">Pending</StatusBadge>
```

Status tones are `neutral | info | success | warning | danger`. Domain adapters in `src/components/bits.tsx` map run, discovery, and event states to these visual tones.

## State Contract

Every data surface must implement these states:

1. Loading: preserve the expected page structure with skeletons.
2. Empty: explain what is missing and provide the next useful action.
3. Error: explain the recovery step and expose a retry action.
4. Success: render semantic headings, links, tables, and status labels.

For mutations, keep the submit control enabled until the request begins, disable repeated submission while pending, and announce the result near the action.

## Responsive Contract

- The desktop shell uses a persistent 248 px navigation rail.
- At 900 px the rail becomes an inert, Escape-closeable drawer with focus handoff.
- Tables scroll inside labeled regions instead of overflowing the page.
- Two-column workflow forms collapse at 640 px.
- Full-width layouts include safe-area padding where applicable.

Do not measure layout in JavaScript. Add or adjust CSS grid breakpoints instead.

## Accessibility Contract

- Use semantic HTML before adding ARIA.
- Give every form control an associated label, stable `name`, correct `type`, and autocomplete hint.
- Use links for navigation and buttons for actions.
- Preserve visible `:focus-visible` states.
- Give icon-only buttons an `aria-label`; decorative SVGs are hidden automatically by `Icon`.
- Announce async errors and results with `Alert` or another polite live region.
- Never disable page zoom, block paste, or rely on color alone for status.
- Keep animation limited to transform and opacity where possible and honor reduced-motion preferences.

## Theming

Theme tokens live in `src/app/globals.css`. Components must consume tokens such as `--panel`, `--ink`, `--muted`, `--line`, and `--accent` rather than hardcoded theme colors. `ThemeToggle` persists the user choice and the root layout installs it before paint to avoid a flash of the wrong theme.

## Adding a New Screen

1. Start with `PageHeader` and a route-specific server component.
2. Fetch data on the server when no client interaction requires otherwise.
3. Add `loading.tsx` and `error.tsx` only when the shared route boundary is not specific enough.
4. Render `EmptyState` before rendering an empty table or chart.
5. Put route-only interactive behavior beside the route; promote it to `components/` only after a second consumer appears.
6. Run `npm run typecheck`, `npm run build`, and desktop/mobile browser checks before shipping.
