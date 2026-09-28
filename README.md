# Sing-along

A public multitrack harmony-practice web app. See `PRD.md` for requirements and `CLAUDE.md` for how we work.

## Setup

- Node 22 (`.nvmrc`), pnpm 10 (`corepack enable` picks the version from `package.json`).
- `pnpm install`
- `pnpm dev` starts the API (http://localhost:3100) and the web app (http://localhost:5173, proxies `/api`).

## Commands

```bash
pnpm lint        # eslint + prettier check
pnpm typecheck
pnpm test        # vitest in every package
```

`spike/` is the throwaway M0 audio spike; it has its own lockfile and is not part of the workspace.
