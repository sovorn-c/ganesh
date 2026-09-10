# e01 security review

**Pass-2 status:** historical blocker resolved. Later whole-epic review evidence is recorded in `specs/verifications/e01-review-pass-3.yaml`, `specs/verifications/e01-review-pass-4.yaml`, and `specs/verifications/e01-review-pass-7.yaml`; the e01 release was completed locally after pass 7.

## Scope

The review covered the complete `feat/e01-runtime-baseline` branch, including the preflight CLI, clean-install process, package metadata, local plan-consistency tooling, and diagnostic output.

## Resolved finding

- **`scripts/lib/extract-story-verify.rb:22,32` — HIGH — unsafe deserialization.** The first review found `YAML.load_file` on project-controlled epic and task files. The extractor now uses Ruby-compatible safe parsing:

```ruby
document = YAML.safe_load(File.read(epic_path), [], [], false) || {}
```

The same safe loader is used for task ledgers. A full Ruby `YAML.safe_load` scan of `specs/**/*.yaml` and the plan-consistency gate both pass after the correction.

## Checks

- `npx --yes --package=node@24 npm audit --audit-level=high`: passed; 0 vulnerabilities.
- Credential-pattern scan over tracked source: no matches.
- Application paths inspected for command injection, path traversal, secret leakage, and unsafe network/auth sinks: no additional high-confidence finding.
- `bash scripts/bp-timing.sh start verify-work`: passed after repairing the state YAML gate.

## Pass-2 limitation

The section above records the resolved pass-2 security finding and its checks. It is historical evidence, not an independent release approval; current pass-4 checks are recorded below.

## Pass-4 correction review

- `npm audit --audit-level=high`: passed; 0 vulnerabilities under Node.js 24.20.0.
- Credential-shaped literal scan and changed-file unsafe-sink spot check: passed.
- The correction only adds narrow CLI argument validation, a deterministic unsupported-runtime fixture, standard-library status parsing, and regression checks. No external API, auth, or research-data path was introduced.
- Request-review was not run because subagents, interactive forks, and filesystem worktrees were prohibited for this fallback review. This is a process limitation, not an independent security approval.

## Pass-7 current-branch release evidence

- The fresh whole-epic review pass 7 covered the current `feat/e01-runtime-baseline` branch after the coverage and whitespace corrections.
- `npm audit --audit-level=high`, credential-pattern scanning, and unsafe-sink scanning passed under Node.js 24 with no unresolved high-confidence findings.
- The current review artifact is `specs/verifications/e01-review-pass-7.yaml`; release and merge were not performed during that review.
