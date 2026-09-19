import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  buildPackageArtifact,
  verifyPackageArtifact
} from "../../src/distribution/package-artifact.js";
import { createTempPrefix } from "../support/distribution-fixtures.js";

test("e18s02 SC-e18s02-P0-01 buildPackageArtifact applies files whitelist and computes sha256 digest", async () => {
  const temp = createTempPrefix("artifact-test-");
  try {
    const report = await buildPackageArtifact(process.cwd(), {
      destination: temp.dir,
      writeManifest: true
    });

    assert.equal(report.status, "pass");
    assert.equal(report.filesWhitelisted, true);
    assert.equal(report.sensitiveFilesExcluded, true);
    assert.ok(report.tarballPath && fs.existsSync(report.tarballPath));
    assert.match(report.digest, /^[a-f0-9]{64}$/);

    // Verify computed sha256 against actual tarball bytes
    const tarballBytes = fs.readFileSync(report.tarballPath);
    const expectedDigest = crypto.createHash("sha256").update(tarballBytes).digest("hex");
    assert.equal(report.digest, expectedDigest);

    // Verify manifest
    assert.ok(report.manifest);
    assert.equal(report.manifest.digest, expectedDigest);
    assert.ok(report.manifest.files.length > 0);

    // Sensitive files must be excluded
    const includedFiles = report.manifest.files;
    assert.ok(!includedFiles.some((f: string) => f.includes(".env")), ".env must not be in tarball");
    assert.ok(!includedFiles.some((f: string) => f.includes(".ganesh")), ".ganesh must not be in tarball");
    assert.ok(!includedFiles.some((f: string) => f.startsWith("tests/")), "tests/ must not be in tarball");
  } finally {
    temp.cleanup();
  }
});

test("e18s02 SC-e18s02-P1-04 empty or mismatched digest fails closed", () => {
  const temp = createTempPrefix("artifact-mismatch-");
  try {
    const fakeTarball = path.join(temp.dir, "fake-0.1.0.tgz");
    fs.writeFileSync(fakeTarball, "fake-bytes", "utf8");

    // Empty digest fails
    const emptyCheck = verifyPackageArtifact({
      tarballPath: fakeTarball,
      expectedDigest: ""
    });
    assert.equal(emptyCheck.status, "fail");
    assert.ok(emptyCheck.reasons && emptyCheck.reasons.some((r: string) => r.includes("empty")));

    // Mismatched digest fails
    const mismatchCheck = verifyPackageArtifact({
      tarballPath: fakeTarball,
      expectedDigest: "0000000000000000000000000000000000000000000000000000000000000000"
    });
    assert.equal(mismatchCheck.status, "fail");
    assert.ok(mismatchCheck.reasons && mismatchCheck.reasons.some((r: string) => r.includes("mismatch")));
  } finally {
    temp.cleanup();
  }
});

test("e18s02 SC-e18s02-P0-01 consecutive packs produce identical digest (package-manifest excluded from pack)", async () => {
  const temp1 = createTempPrefix("artifact-repro-1-");
  const temp2 = createTempPrefix("artifact-repro-2-");
  try {
    const report1 = await buildPackageArtifact(process.cwd(), {
      destination: temp1.dir,
      writeManifest: true
    });
    assert.equal(report1.status, "pass");

    const report2 = await buildPackageArtifact(process.cwd(), {
      destination: temp2.dir,
      writeManifest: true
    });
    assert.equal(report2.status, "pass");

    assert.equal(report1.digest, report2.digest, "consecutive pack digests must match");
  } finally {
    temp1.cleanup();
    temp2.cleanup();
  }
});
