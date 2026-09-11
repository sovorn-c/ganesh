# E06 parser dependency verification

- **Runtime:** Node.js 24.21.0, npm 11.19.0
- **Date:** 2026-09-11
- **Install command:** `npm install --save-exact --ignore-scripts pdfjs-dist@6.3.289 mammoth@1.12.2 parse5@8.0.1 yauzl@3.4.0 @types/yauzl@3.4.0`
- **Script policy:** `--ignore-scripts` was used during dependency adoption. No parser package install script was executed by the adoption command.
- **Top-level resolution:** `npm ls --depth=0 pdfjs-dist mammoth parse5 yauzl @types/yauzl` resolved the exact requested versions.
- **Advisory result:** `npm audit --omit=dev` reported `found 0 vulnerabilities`.

| Package | Version | License | Entry/export review | Control decision |
|---|---:|---|---|---|
| `pdfjs-dist` | 6.3.289 | Apache-2.0 | `build/pdf.mjs`, TypeScript declarations under `types/src/pdf.d.ts` | Accept for byte-only PDF text adapter with eval and external-resource controls. |
| `mammoth` | 1.12.2 | BSD-2-Clause | `lib/index.js` | Accept only for Buffer-to-HTML conversion with images and external file access disabled; generated HTML is parsed inertly and never rendered or persisted. Owner approval is recorded in the approved E06 plan. |
| `parse5` | 8.0.1 | MIT | default export `dist/index.js`, declarations `dist/index.d.ts` | Accept as inert generated-HTML parser; no browser DOM or execution boundary. |
| `yauzl` | 3.4.0 | MIT | `index.js` | Accept for lazy ZIP central-directory preflight and finite archive checks. |
| `@types/yauzl` | 3.4.0 | MIT | declarations `index.d.ts` | Development-only type support for the pinned ZIP adapter. |

## Reproduction evidence

```text
$ npm ls --depth=0 pdfjs-dist mammoth parse5 yauzl @types/yauzl
├── @types/yauzl@3.4.0
├── mammoth@1.12.2
├── parse5@8.0.1
├── pdfjs-dist@6.3.289
└── yauzl@3.4.0

$ npm audit --omit=dev
found 0 vulnerabilities
```

This evidence verifies the exact direct versions, entry points, licenses and production advisory snapshot. It does not prove parser fidelity or make a sandbox guarantee; adapter tests must still enforce byte-only input, finite limits, inert handling and no external resource access.
