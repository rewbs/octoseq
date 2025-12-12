# octoseq

A pnpm + Turborepo monorepo.

## Structure

- `apps/web` — Next.js app (Vercel deployment target)
- `packages/mir` — TypeScript MIR library (future WebGPU-accelerated)

## Prerequisites

- Node.js >= 20
- pnpm (recommended via Corepack)

## Getting started

```bash
pnpm install
pnpm dev
```

Then open the printed local URL for the Next.js app.

## Common commands

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format
```

## Notes

- The app consumes the library via workspace dependency: `@octoseq/mir`.
- Next.js is configured with `transpilePackages: ["@octoseq/mir"]`.
