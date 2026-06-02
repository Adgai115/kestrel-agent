# Contributing to Kestrel Agent

## Setup

```bash
pnpm install
pnpm setup     # install pre-commit hook
pnpm build     # build all packages
```

## Development Workflow

1. Pick or open a GitHub issue for the change
2. Create your changes
3. Run `.\scripts\verify.ps1` — must be 4/4 PASS
4. Commit — pre-commit hook scans for secrets automatically

## Code Style

- Biome for linting and formatting (`pnpm format`)
- TypeScript strict mode
- 120 char line width
- No unused imports or parameters

## Testing

```bash
pnpm test              # all packages (~230 tests)
pnpm test:security     # security-critical packages
pnpm --filter <pkg> test  # single package
```

## Architecture

See `README.md` for the full architecture overview. Key design principles:

- **Zero native deps** — SQLite via sql.js WASM, no native compilation
- **ABAC permissions** — attribute-based access control for all channels
- **Audit trail** — all skill proposals, memory changes, and task transitions are audited
- **Rate limiting** — Gateway enforces per-IP rate limits
- **Secret scanning** — pre-commit hook blocks accidental API key commits

## Project Structure

```
kestrel-agent/
├── apps/bootstrap/     Bootstrap entry
├── packages/           Monorepo packages
├── scripts/            verify, pre-commit, setup
├── docs/               Audit reports, ADRs
└── bin/                Global CLI entry
```
