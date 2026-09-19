import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  validateGuideInventory,
  loadGuideInventory,
  REQUIRED_GUIDE_IDS,
  EXPECTED_RUNBOOK_IDS
} from "../../src/distribution/guide-inventory.js";

test("e18s04 SC-e18s04-P0-01 guide inventory requires user developer accessibility privacy local-execution and support", () => {
  const root = process.cwd();
  const inventory = loadGuideInventory(root);

  assert.ok(inventory.guides.length >= REQUIRED_GUIDE_IDS.length);
  for (const id of REQUIRED_GUIDE_IDS) {
    const found = inventory.guides.find((g) => g.id === id);
    assert.ok(found, `Expected guide id '${id}' in inventory`);
    assert.ok(fs.existsSync(path.join(root, found.path)), `File for guide '${id}' must exist on disk`);
  }

  const report = validateGuideInventory(root);
  assert.equal(report.status, "pass");
  assert.equal(report.missingGuides.length, 0);
  assert.equal(report.limitationsValid, true);
  assert.equal(report.secretsOmitted, true);
  for (const runbookId of EXPECTED_RUNBOOK_IDS) {
    assert.ok(report.runbookIds.includes(runbookId), `Expected runbook id '${runbookId}' in report`);
  }
});

test("e18s04 SC-e18s04-P0-02 missing packed guide fails closed and preserves E16 runbook list", () => {
  const root = process.cwd();
  const inventory = loadGuideInventory(root);

  // Incomplete packed list omitting docs/guides/privacy.md
  const incompletePackedFiles = inventory.guides
    .filter((g) => g.id !== "privacy")
    .map((g) => g.path);

  const report = validateGuideInventory(root, { packedFiles: incompletePackedFiles });
  assert.equal(report.status, "fail");
  assert.ok(report.missingGuides.includes("privacy"));
  assert.ok(report.reasons?.some((r) => r.includes("privacy") && r.includes("packed")));
  assert.equal(report.runbookIds.length, EXPECTED_RUNBOOK_IDS.length);
});

test("e18s04 SC-e18s04-P0-03 limitations guide refuses production-ready and sandbox over-claim", () => {
  const root = process.cwd();
  const limitationsPath = path.join(root, "docs", "guides", "limitations.md");
  assert.ok(fs.existsSync(limitationsPath));

  const content = fs.readFileSync(limitationsPath, "utf8");
  assert.ok(
    content.toLowerCase().includes("qualify pass is not production-ready"),
    "Must state qualify pass is not production-ready"
  );
  assert.ok(
    content.toLowerCase().includes("full-access is not a sandbox"),
    "Must state full-access is not a sandbox"
  );

  // Test failure when claims are missing
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ganesh-limitations-test-"));
  try {
    const specsDir = path.join(tempDir, "specs", "distribution");
    const docsDir = path.join(tempDir, "docs", "guides");
    const runbooksDir = path.join(tempDir, "docs", "runbooks");
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(docsDir, { recursive: true });
    fs.mkdirSync(runbooksDir, { recursive: true });

    // Copy runbooks so runbook check passes
    for (const rb of EXPECTED_RUNBOOK_IDS) {
      fs.writeFileSync(path.join(runbooksDir, `${rb}.md`), `# ${rb}\nContent`);
    }

    // Write incomplete limitations guide
    fs.writeFileSync(
      path.join(docsDir, "limitations.md"),
      "# Limitations\nEverything is completely production-ready and sandboxed."
    );

    const guides = REQUIRED_GUIDE_IDS.map((id) => {
      const p = id === "release-notes" ? "docs/RELEASE_NOTES.md" : `docs/guides/${id}.md`;
      if (id !== "limitations") {
        const target = path.join(tempDir, p);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `# ${id}\nSafe content.`);
      }
      return { id, path: p, title: id };
    });

    fs.writeFileSync(
      path.join(specsDir, "guide-inventory.json"),
      JSON.stringify({ version: "0.1.0", guides }, null, 2)
    );

    const badReport = validateGuideInventory(tempDir);
    assert.equal(badReport.status, "fail");
    assert.equal(badReport.limitationsValid, false);
    assert.ok(badReport.reasons?.some((r) => r.includes("production-ready")));
    assert.ok(badReport.reasons?.some((r) => r.includes("sandbox")));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("e18s04 SC-e18s04-P1-04 guides omit secrets and participant PII", () => {
  const root = process.cwd();
  const inventory = loadGuideInventory(root);

  for (const guide of inventory.guides) {
    const fullPath = path.join(root, guide.path);
    assert.ok(fs.existsSync(fullPath), `Guide file ${guide.path} must exist`);
    const content = fs.readFileSync(fullPath, "utf8");

    assert.equal(
      /token\s*=/i.test(content),
      false,
      `Guide ${guide.id} (${guide.path}) must not contain credential token shapes`
    );
    assert.equal(
      /participant@example\.test/i.test(content),
      false,
      `Guide ${guide.id} (${guide.path}) must not contain fixture participant emails`
    );
  }
});
