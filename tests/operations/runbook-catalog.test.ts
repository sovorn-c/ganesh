// story: e16s04 — Resource Limits, Performance Budgets, Retention and Runbooks
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listRunbooks } from "../../src/index.js";

describe("E16s04 runbook catalog and secret hygiene", () => {
  const requiredTopics = [
    "provider-outage",
    "credential-rotation",
    "disk-exhaustion",
    "recovery",
    "incident-response",
    "vulnerability-reporting",
    "performance-budgets"
  ];

  it("e16s04 SC-e16s04-P1-04 listRunbooks catalog includes all required outage credential disk recovery incident and vulnerability topics", () => {
    const runbooks = listRunbooks();
    assert.ok(runbooks.length >= 7, `expected at least 7 runbooks, found ${runbooks.length}`);

    const foundIds = new Set(runbooks.map((r) => r.id));
    for (const topic of requiredTopics) {
      assert.ok(foundIds.has(topic), `missing required runbook topic: ${topic}`);
    }

    for (const runbook of runbooks) {
      assert.ok(runbook.title && runbook.title.length > 0, `runbook ${runbook.id} must have a non-empty title`);
      assert.ok(runbook.path && runbook.path.endsWith(".md"), `runbook ${runbook.id} must have a valid path`);
      assert.ok(runbook.content && runbook.content.length > 50, `runbook ${runbook.id} must have substantial content`);
    }
  });

  it("e16s04 SC-e16s04-P1-04 runbook bodies contain no live credentials tokens or test secret strings", () => {
    const runbooks = listRunbooks();

    // Adversarial patterns that must never appear in production runbooks
    const forbiddenPatterns = [
      /test-secret-value/i,
      /patient@example\.test/i,
      /Alice Example MRN/i,
      /bearer\s+[a-zA-Z0-9_\-\.]{20,}/i,
      /sk-[a-zA-Z0-9]{20,}/i,
      /ghp_[a-zA-Z0-9]{20,}/i
    ];

    for (const runbook of runbooks) {
      for (const pattern of forbiddenPatterns) {
        assert.ok(
          !pattern.test(runbook.content),
          `runbook ${runbook.id} contains forbidden credential/participant pattern: ${pattern}`
        );
      }
    }
  });

  it("e16s04 SC-e16s04-P1-04 listRunbooks supports custom runbooks directory injection", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ganesh-custom-runbooks-"));
    try {
      writeFileSync(join(tempDir, "custom-procedure.md"), "# Custom Ops Procedure\nStep 1: Do work.");
      const customRunbooks = listRunbooks({ runbooksDir: tempDir });
      assert.equal(customRunbooks.length, 1);
      assert.equal(customRunbooks[0].id, "custom-procedure");
      assert.equal(customRunbooks[0].title, "Custom Ops Procedure");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
