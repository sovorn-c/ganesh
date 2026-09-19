import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import {
  loadSupportMatrix,
  validateSupportMatrix
} from "../../src/distribution/support-matrix.js";
import {
  createTempPrefix,
  createSampleSupportMatrix,
  writeTempSupportMatrix
} from "../support/distribution-fixtures.js";

test("e18s01 SC-e18s01-P0-01 loadSupportMatrix lists verified and unverified combination catalog without inferring certification", () => {
  const temp = createTempPrefix("test-matrix-");
  try {
    const sample = createSampleSupportMatrix();
    writeTempSupportMatrix(temp.dir, sample);

    const loaded = loadSupportMatrix(temp.dir);
    assert.equal(loaded.version, "0.1.0");
    assert.equal(loaded.scholarlyCertification, false);
    assert.equal(loaded.combinations.length, 3);

    const verified = loaded.combinations.filter((c) => c.status === "verified");
    const unverified = loaded.combinations.filter((c) => c.status === "unverified");

    assert.equal(verified.length, 1);
    assert.equal(unverified.length, 2);
    assert.equal(verified[0].os, process.platform);
    assert.equal(verified[0].arch, process.arch);
    assert.equal(verified[0].nodeMajor, 24);
    assert.ok(verified[0].evidencePointer.length > 0);
  } finally {
    temp.cleanup();
  }
});

test("e18s01 SC-e18s01-P0-01 support matrix catalog validates successfully with proper combinations", () => {
  const temp = createTempPrefix("test-matrix-valid-");
  try {
    const sample = createSampleSupportMatrix();
    // Create the evidence file pointed to by verified row
    const evidencePath = path.join(temp.dir, "specs", "verifications", "e18s01-verify.yaml");
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, "status: pass\n", "utf8");

    writeTempSupportMatrix(temp.dir, sample);
    const loaded = loadSupportMatrix(temp.dir);
    const validation = validateSupportMatrix(loaded, { projectRoot: temp.dir });
    assert.equal(validation.status, "pass");
  } finally {
    temp.cleanup();
  }
});

test("e18s01 SC-e18s01-P0-03 invented verified combination without evidence fails closed in matrix validation", () => {
  const temp = createTempPrefix("test-matrix-invent-");
  try {
    const sample = createSampleSupportMatrix({
      combinations: [
        {
          os: "darwin",
          arch: "arm64",
          nodeMajor: 24,
          status: "verified",
          evidencePointer: "specs/verifications/non-existent-darwin.yaml"
        }
      ]
    });
    writeTempSupportMatrix(temp.dir, sample);
    const loaded = loadSupportMatrix(temp.dir);
    const validation = validateSupportMatrix(loaded, { projectRoot: temp.dir });
    assert.equal(validation.status, "fail");
    assert.ok(validation.reasons && validation.reasons.some((r) => r.includes("evidence pointer not found")));
  } finally {
    temp.cleanup();
  }
});

test("e18s01 SC-e18s01-P0-03 evidence pointer pointing to directory fails closed", () => {
  const temp = createTempPrefix("test-matrix-dir-");
  try {
    const sample = createSampleSupportMatrix({
      combinations: [
        {
          os: process.platform,
          arch: process.arch,
          nodeMajor: 24,
          status: "verified",
          evidencePointer: "." // Directory, not regular file!
        }
      ]
    });
    writeTempSupportMatrix(temp.dir, sample);
    const loaded = loadSupportMatrix(temp.dir);
    const validation = validateSupportMatrix(loaded, { projectRoot: temp.dir });
    assert.equal(validation.status, "fail");
    assert.ok(
      validation.reasons && validation.reasons.some((r) => r.includes("must be a regular file")),
      "must reject directory evidence pointer"
    );
  } finally {
    temp.cleanup();
  }
});

test("e18s01 SC-e18s01-P0-03 evidence pointer escaping project root fails closed", () => {
  const temp = createTempPrefix("test-matrix-traversal-");
  try {
    const sample = createSampleSupportMatrix({
      combinations: [
        {
          os: process.platform,
          arch: process.arch,
          nodeMajor: 24,
          status: "verified",
          evidencePointer: "../../etc/passwd" // Directory traversal!
        }
      ]
    });
    writeTempSupportMatrix(temp.dir, sample);
    const loaded = loadSupportMatrix(temp.dir);
    const validation = validateSupportMatrix(loaded, { projectRoot: temp.dir });
    assert.equal(validation.status, "fail");
    assert.ok(
      validation.reasons && validation.reasons.some((r) => r.includes("must be under project root")),
      "must reject path traversal evidence pointer"
    );
  } finally {
    temp.cleanup();
  }
});

test("e18s01 SC-e18s01-P0-03 evidence pointer inside root symlinked to external file fails closed via canonical containment", () => {
  const temp = createTempPrefix("test-matrix-symlink-");
  try {
    const verifyDir = path.join(temp.dir, "specs", "verifications");
    fs.mkdirSync(verifyDir, { recursive: true });
    const symlinkPath = path.join(verifyDir, "symlink-evidence.yaml");
    try {
      fs.symlinkSync("/etc/passwd", symlinkPath);
    } catch {
      // If unprivileged environment prevents symlinks, skip
      return;
    }

    const sample = createSampleSupportMatrix({
      combinations: [
        {
          os: process.platform,
          arch: process.arch,
          nodeMajor: 24,
          status: "verified",
          evidencePointer: "specs/verifications/symlink-evidence.yaml"
        }
      ]
    });
    writeTempSupportMatrix(temp.dir, sample);
    const loaded = loadSupportMatrix(temp.dir);
    const validation = validateSupportMatrix(loaded, { projectRoot: temp.dir });
    assert.equal(validation.status, "fail");
    assert.ok(
      validation.reasons && validation.reasons.some((r) => r.includes("must be under project root")),
      "must reject symlinked evidence pointer pointing outside project root"
    );
  } finally {
    temp.cleanup();
  }
});

test("e18s01 SC-e18s01-P0-03 matrix row marked verified with wrong node major fails closed", () => {
  const sample = createSampleSupportMatrix({
    combinations: [
      {
        os: "linux",
        arch: "x64",
        nodeMajor: 26,
        status: "verified",
        evidencePointer: "specs/verifications/some.yaml"
      }
    ]
  });
  const validation = validateSupportMatrix(sample);
  assert.equal(validation.status, "fail");
  assert.ok(validation.reasons && validation.reasons.some((r) => r.includes("must target Node.js 24")));
});

test("e18s01 SC-e18s01-P1-04 operator docs point at support matrix and avoid macos product boundary", () => {
  const readme = fs.readFileSync(path.resolve(process.cwd(), "README.md"), "utf8");
  const setupDocs = fs.readFileSync(path.resolve(process.cwd(), "docs/setup-and-recovery.md"), "utf8");

  assert.ok(
    readme.includes("support-matrix") || readme.includes("Support matrix"),
    "README.md must reference the support matrix"
  );
  assert.ok(
    setupDocs.includes("support-matrix") || setupDocs.includes("Support matrix"),
    "setup-and-recovery.md must reference the support matrix"
  );
  assert.ok(
    !readme.includes("macOS is the current product target; broader platform support has not been verified"),
    "README.md must not state macOS is current product target boundary"
  );
});
