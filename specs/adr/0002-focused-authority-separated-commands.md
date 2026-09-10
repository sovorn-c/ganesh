# Focused commands with separate owner authority

Status: selected for blueprinting by the assistant under the owner's delegated design direction.

## Context

ADR 0001 keeps research authority outside Pi sessions. Exact-version commitments, current data-use permissions, and cumulative work budgets must agree across owner actions, coordinator requests, and restricted workers.
There is no existing implementation to refactor.

## Decision

Use focused use-case commands for each caller within one local application. Trusted local interaction alone exposes owner dispositions, permission changes, and work authorization. Coordinator and worker interfaces expose only their bounded operations.
Share command identity, expected-version checks, transactions, policy enforcement, and accounting internally. Keep durable history and run recovery without a general-purpose event workflow engine.
An owner role field or hidden agent tool is not a security mechanism; the runtime must enforce unavailable authority and broker all protected operations.

## Alternatives and consequences

A minimal generic dispatcher reduces entry-point count but conceals the operation and authority surface inside payload unions.
An extensible event workflow supports arbitrary orchestration but adds ordering, replay, and schema obligations without a current requirement.
Focused commands improve discoverability and misuse resistance at the cost of more named operations. Grouped terminal actions avoid requiring command memorization.

See [interface comparison](../tech-architecture/DESIGN_PLAN_LATEST.md) for signatures, examples, races, and test obligations.
Pi command/data-policy coverage and user-controlled local execution modes remain implementation concerns. Prior Pi SDK compatibility is treated as settled; no Python/R-specific sandbox is required. This decision is not evidence that the remaining controls work.
