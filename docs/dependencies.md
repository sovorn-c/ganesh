# Direct dependency and license inventory

Verified 2026-09-09 from the local npm package metadata and the npm registry package selected by `package.json`. The lockfile is the installation authority; transitive packages are not direct Ganesh API dependencies.

| Package | Role | Version | Origin | License | Evidence |
|---|---|---:|---|---|---|
| `@earendil-works/pi-coding-agent` | Pi runtime and terminal integration boundary for later epics | 0.85.1 | npm registry; upstream `github.com/earendil-works/pi` | MIT | Local package metadata and prior SDK/TUI compatibility verification accepted |
| `@types/node` | Node.js and built-in `node:test` types | 24.13.3 | npm registry; `github.com/DefinitelyTyped/DefinitelyTyped` | MIT | Local package metadata |
| `@typescript-eslint/parser` | TypeScript parsing for ESLint | 8.70.0 | npm registry; `github.com/typescript-eslint/typescript-eslint` | MIT | Local package metadata |
| `eslint` | Static analysis command | 10.10.0 | npm registry; `eslint.org` | MIT | Local package metadata |
| `typescript` | Strict TypeScript compiler | 5.9.2 | npm registry; `github.com/microsoft/TypeScript` | Apache-2.0 | Local package metadata |

No credential, global Pi path, or private research material is required by the baseline commands. This inventory records direct dependencies only; review transitive licenses from the generated npm tree before a public release.
