# Prior Art

## Review boundary

This is a local, documentation-based prior-art review for the confirmed release intent.
No registry requests, external links, dependency installations, source caches, secrets, or generated output were explored.
The owner's requested sequence takes precedence over the skill's usual survey-first ordering.
No application integration was executed.

## Findings, ranked by fit

| Candidate | Evidence | Verdict | Boundary |
|---|---|---|---|
| Pi SDK and existing terminal UI | Installed Pi `docs/sdk.md`, Run Modes → InteractiveMode; session-runtime example | Extend | Reuse runtime and terminal presentation; configure approved resources and brokered tools |
| Pi extension API | Installed Pi `docs/extensions.md`; `examples/extensions/plan-mode/index.ts` | Extend | Commands, widgets, custom components, and event hooks support research interaction; they are not security isolation |
| Ganesh planning material | `../planning-context.yaml`, `../docs/01-product.md` through `05-decisions-and-acceptance.md` | Compose | Reuse research contracts after reconciling the browser proposal with the confirmed terminal interface |
| Bigpowers `model-domain`, `define-language`, and `elaborate-spec` | Installed skill frontmatter and full instructions | Compose | Useful development-discovery procedures, not production research-methodology expertise |
| SQLite and local artifact files | Owner-approved storage decision; no binding or runtime contract executed | Adopt, pending binding verification | Use transactional records and exact artifact versions; do not introduce a second authoritative database |
| Existing local analysis tools and libraries | User-selected runtimes and tools remain environment-specific | Compose, selected by the researcher | Ganesh can plan, inspect, and record local computation without mandating Python, R, or another language |
| Research repositories named in `conv.md` | Conversation references only; upstream content and licenses not inspected | Candidate only | Do not copy skills, claim license compatibility, or endorse methodological quality from the conversation |
| Ganesh research policy and durable domain records | Confirmed release intent; no Ganesh application source exists in the inspected product tree | Build | Pi supplies agent infrastructure, not research approval, provenance, ethics, or dependency semantics |

The local skill ranking favors domain modeling, canonical terminology, and specification dialogue.
No inspected Bigpowers skill replaces scholarly appraisal or the production research controller.

## One verified API detail

The installed SDK documentation exports `InteractiveMode` and demonstrates `new InteractiveMode(runtime, options)` followed by `await mode.run()`.
Its example builds the runtime with `createAgentSessionRuntime` and session services.
The installed imports use `@earendil-works/pi-coding-agent`.
Do not assume another Pi distribution or version has identical signatures.

Local evidence paths:

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`, lines 1039–1076.
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`, UI and tool-operation sections.
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples/sdk/13-session-runtime.ts`.
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/plan-mode/index.ts`.

The session-runtime example explicitly rebinds subscriptions and extensions after session replacement.
That supports a lifecycle requirement; it is not proof of Ganesh recovery behavior.
The plan-mode example demonstrates tool filtering and tool-call hooks, not a complete sandbox.

## Corrections to assumptions

- Reusing Pi does not require a browser application or a replacement terminal interface.
- Reusing its UI does not automatically enforce Ganesh permissions across built-in commands, attachments, exports, or session switches.
- A curated launcher must cover every disclosure and mutation path, not only custom research tools.
- Pi conversation branches do not create versioned research branches.
- Trusted extension code can use host APIs; prompts and removed tool names do not constrain its process authority.
- Pi SDK compatibility is treated as settled from prior verification; Node.js 24 LTS remains the target runtime choice to resolve during project setup.

## Required evidence before integration

1. Resolve the selected Pi package/version, license, Node target, resource-loading controls, and exported APIs when creating the adapter; prior SDK compatibility work is accepted.
2. Define how built-in commands, typed/pasted input, attachments, compaction, session switches, and exports preserve research authority and data policy.
3. Define and verify Pi-compatible `ask`, `approve`, and `full-access` modes plus the per-project bash guard; document that these are user controls, not sandbox containment.
4. Select and evaluate parsers/exporters against every required format, including source-locator fidelity and hostile files.
5. Reuse existing provider workflows and record access, terms, rate limits, credential handling, and permitted source redistribution.
6. Verify SQLite binding behavior, atomic artifact registration, migrations, backup, and recovery.
7. Inspect any reused research skill's source, license, and methodological behavior before adoption.

## Outcome

**Extend Pi; compose existing computational tools; build only Ganesh's research-specific domain and controls.**
The local prior-art gate establishes that reuse direction.
Registry, licensing, and executable integration checks remain explicitly unperformed and block implementation relying on them.
