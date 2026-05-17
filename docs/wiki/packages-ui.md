# Package: UI (`packages/ui`)

## Responsibility

`@mlbb/ui` is a small shared Svelte component library used by the web app to keep UI primitives consistent.

## Exports

From `packages/ui/src/index.ts`:

- Components: `Sidebar`, `Card`, `BadgeTier`, `Chip`, `HeroAvatar`, `Skeleton`, `VirtualTable`
- Types: `Column` (for `VirtualTable`)
- CSS export: `@mlbb/ui/theme.css` (via package `exports`)

## Notable dependencies

- `svelte` (Svelte 5)
- `lucide-svelte` (icons)
- `@tanstack/virtual-core` (virtualized table behavior)

