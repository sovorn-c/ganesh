# E15 audit

**Scope:** Current uncommitted E15 recovery, portability, stale-handle, locking, and controlled-deletion changes on `feat/e15-recovery-portability`.

**Runtime:** Node.js 24.21.0

## Verdict

**PASS.** No unresolved high-confidence application finding remains for the accepted Ganesh-controlled concurrency model. This audit is not production-readiness approval.

## Checklist

- **Supply chain/security — PASS:** No dependency changes. `npm audit --omit=dev --audit-level=high` found 0 vulnerabilities. Changed paths use prepared SQL, capability checks, strict packet validation, and no shell or network sinks. No credential-shaped literals were introduced.
- **Canonical data integrity — PASS:** Export and backup validate the full schema derived from `createSchema`; restore validates the same canonical shape before materialization, replacement, or drill. Malformed SQLite, packet manifests, hashes, and replay metadata fail closed.
- **Filesystem containment — PASS:** Deletion and recovery use `lstat`, reject symlinked allowed roots and ancestor symlinks, unlink symlink leaves without following targets, preserve unsafe retry records, and treat `ENOENT` as completed cleanup. Regression tests cover broken leaves, symlinked roots, ancestor escapes, and external-victim preservation.
- **Swap and lock recovery — PASS:** Same-root sources are preserved safely, ambiguous journals fail closed, replacement operations remain serialized, and failed materialization cleanup does not remove foreign content.
- **Stale handles and authority — PASS:** Mutating branch, promotion, recovery, policy, disclosure, commitment-gate, and work paths revalidate current project identity. Lock release is ownership-checked. Deletion reads require the matching owner capability.
- **Tests and quality — PASS:** `npm test` reports 215/215 passing across 9 suites. Typecheck, lint, build, `git diff --check`, and preflight passed. Preflight reports only the documented `execution-mode: not_configured` warning.
- **Scope and metadata — PASS:** Changes remain uncommitted and within the existing E15 implementation/evidence scope. Verification files record the 215-test result and uncommitted-correction state.

## Independent review

A fresh follow-up review confirmed that the symlinked-root, materialization-cleanup, and malformed-replay findings were resolved. It identified one residual limitation: pathname cleanup performs containment/lstat validation followed by pathname removal. A hostile non-Ganesh process with concurrent write access to the project tree could theoretically swap an ancestor between those operations.

The human-approved E15 threat model treats Ganesh-controlled concurrent launches as in scope and arbitrary hostile mutation of the application-owned project directory as out of scope; the project lock serializes Ganesh writers. If that threat model changes, an fd-relative, no-follow deletion primitive is required before further release work.

## Tooling limitation

The formal `bigpowers audit-code --gate` executable is unavailable in this checkout (`bigpowers: command not found`). This report records the equivalent manual checklist and command evidence; it does not claim that unavailable CLI gate passed.

**No commit, release, archive, publish, deploy, or production-readiness claim was made.**
