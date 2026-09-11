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

## Structured parser adoption

- **Install command:** `npm install --save-exact --ignore-scripts biblatex-csl-converter@3.6.0 csv-parse@7.0.2 read-excel-file@9.3.10 saxes@6.0.0`
- **Top-level resolution:** `biblatex-csl-converter@3.6.0`, `csv-parse@7.0.2`, `read-excel-file@9.3.10`, and `saxes@6.0.0` resolved exactly.
- **Advisory result:** `npm audit --omit=dev` reported `found 0 vulnerabilities`.
- **Supply-chain note:** npm reports `biblatex-csl-converter@3.6.0` as deprecated and recommends a renamed package. The approved E06 plan pins this exact version and requires the LGPL-3.0 notice/source obligations; no replacement was substituted during this build.

| Package | Version | License | Entry/export review | Control decision |
|---|---:|---|---|---|
| `biblatex-csl-converter` | 3.6.0 | LGPL-3.0 | ESM/CJS exports with `lib/index.d.ts` | Use only for offline parser conversion; retain LGPL notice/source obligations and no provider/network path. |
| `csv-parse` | 7.0.2 | MIT | ESM/CJS plus sync/stream exports | Accept for bounded local CSV records. |
| `read-excel-file` | 9.3.10 | MIT | Explicit Node/universal/browser worker exports | Use Node buffer input only and join values with independently scanned OOXML markers. |
| `saxes` | 6.0.0 | ISC | `saxes.js`, declarations `saxes.d.ts` | Accept for bounded known OOXML XML parts; reject DTD/entities and never evaluate expressions. |

```text
$ npm ls --depth=0 biblatex-csl-converter csv-parse read-excel-file saxes
├── biblatex-csl-converter@3.6.0
├── csv-parse@7.0.2
├── read-excel-file@9.3.10
└── saxes@6.0.0

$ npm audit --omit=dev
found 0 vulnerabilities
```
