# Developer Guide

This guide is for developers extending or maintaining the Ganesh local-first research supervision assistant.

## Architecture and Stack

- **Runtime:** Node.js 24 LTS
- **Language:** TypeScript with ECMAScript Modules (`type: module`)
- **Storage:** Local SQLite via `node:sqlite` (`DatabaseSync`), strict WAL mode, foreign keys enforced
- **Agent Integration:** Curated Ganesh extensions on top of the Pi SDK and Pi terminal interface
- **Code Organization:** Responsibility folders under `src/` (e.g. `src/distribution/`, `src/portability/`, `src/policy/`, `src/workspace/`)

## Local Commands

Verify development readiness with standard npm lifecycle scripts:

```bash
npm test         # Run node:test test suite
npm run lint     # Run eslint checks
npm run typecheck# Run tsc typecheck
npm run build    # Compile TypeScript into dist/
npm run preflight# Comprehensive preflight checks
```

## Conventions

- Code and tests are organized strictly by responsibility.
- Never use epic or story IDs as module or directory names.
- Conventional Commits are required for all changes.
- Never include AI co-author attribution trailers in git commits.
