# Ganesh — project blueprint

## Purpose and status

This directory defines what Ganesh will do, how research work will proceed, and which boundaries the implementation must enforce. It is the planning baseline, not a description of implemented software.

**Decision status:** the owner confirmed release scope, terminal-first architecture, conventions, and domain distinctions through the discovery interview. Detailed engineering defaults are proposals, not tested guarantees.

This directory is a supplementary blueprint, not a required `bp-discover` artifact. The canonical discovery entry point is [../README.md](../README.md); confirmed intent and domain artifacts take precedence.

**Basis:** the human–agent conversation in [`conv.md`](../../../conv.md) and subsequent explicit owner confirmations. External links were not opened. Local Pi documentation was inspected; prior Pi SDK compatibility is treated as settled, while upstream quality, licensing, provider access, and executable Ganesh integration remain unverified.

**Project decision:** proceed with Ganesh as a persistent, collaborative research-supervision assistant. Its purpose is defensible research progress through evidence work, methodological reasoning, critique, and recorded human decisions. It is not an autonomous researcher or a substitute for an academic supervisor.

## Read in this order

| Document | Authority |
|---|---|
| [01-product.md](01-product.md) | Users, scope, use cases, inputs, outcomes, interaction model |
| [02-research-workflow.md](02-research-workflow.md) | Research objects, task contracts, lifecycle, gates, revision behavior |
| [03-agents-and-skills.md](03-agents-and-skills.md) | Agent responsibilities, skill catalog, research-quality standards |
| [04-system-architecture.md](04-system-architecture.md) | Runtime boundaries, storage, security, recovery, technical dependencies |
| [05-decisions-and-acceptance.md](05-decisions-and-acceptance.md) | Decision rationale, acceptance scenarios, delivery dependencies |

These documents define one project. They are not separate v1/v2 proposals. Delivery order follows technical dependencies; it does not redefine the intended product.

## Settled principles

1. The human owns research commitments; agents propose and investigate.
2. One Supervisor is the human's conversational interface. Specialists perform bounded work.
3. Deterministic application code owns permissions, validation, approvals, and durable state changes.
4. Research is iterative. Users may enter at any stage; prerequisites constrain claims and commitments, not their ability to ask questions.
5. Evidence quality, search coverage, methodological fit, and novelty are judgments—not facts established by a schema or another agent's agreement.
6. Every consequential research claim is traceable to source evidence or explicitly identified as a hypothesis, interpretation, or unsupported assertion.
7. Existing commitments are versioned. New evidence may make them stale; it never silently replaces them.
8. Ethics, privacy, cultural responsibilities, and institutional requirements apply from intake onward.
9. Research decisions remain understandable without replaying a conversation.
10. Skills carry procedures; tools provide capabilities; neither grants authority to override application policy.

## How to use this baseline

Implementation plans must map their work to the acceptance scenarios in document 05. A material change to scope, authority, research semantics, or persistence requires an explicit amendment here before code assumes the new behavior.

Pi SDK compatibility is treated as settled from prior verification. Adjustments to provider APIs do not require reopening the product design unless they weaken a documented guarantee; existing provider workflows and skills are the starting point. Technical uncertainty that affects a guarantee must still be recorded rather than quietly converted into weaker behavior.

## Documentation verification

From the repository root:

```bash
python3 - <<'PY'
from pathlib import Path
import re
root = Path('ganesh/specs/docs')
files = sorted(root.glob('*.md'))
assert len(files) == 6, files
for path in files:
    text = path.read_text()
    assert len(text.splitlines()) <= 300, path
    for target in re.findall(r'\]\(([^)]+)\)', text):
        if '://' not in target and not target.startswith('#'):
            assert (path.parent / target.split('#')[0]).exists(), (path, target)
print('Documentation files, line limits, and relative links checked.')
PY
```

This checks document integrity only. It does not prove implementation correctness or scholarly quality.
