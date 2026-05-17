# Package: Config (`packages/config`)

## Responsibility

`@mlbb/config` contains shared repository configuration artifacts to keep tooling consistent across apps/packages:

- TypeScript base configs: `packages/config/tsconfig/*`
- ESLint presets: `packages/config/eslint/*`
- Prettier preset: `packages/config/prettier/*`

It is not a runtime dependency; it exists to standardize development and CI behavior in the monorepo.

