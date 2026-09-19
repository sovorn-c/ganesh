import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { validateSigningApplicability } from "../../src/distribution/signing-applicability.js";
import { createTempPrefix } from "../support/distribution-fixtures.js";

test("e18s02 SC-e18s02-P0-03 validateSigningApplicability records sha256 digest and appleCodesign not-applicable for npm-pack-tarball", () => {
  const report = validateSigningApplicability(process.cwd());
  assert.equal(report.status, "pass");
  assert.equal(report.artifactDigest, "sha256");
  assert.equal(report.lockfileIntegrity, true);
  assert.equal(report.appleCodesign, "not-applicable");
});

test("e18s02 SC-e18s02-P0-03 validateSigningApplicability fails closed if codesign is claimed or not not-applicable", () => {
  const temp = createTempPrefix("signing-claimed-");
  try {
    const fakeSigning = {
      channel: "npm-pack-tarball",
      artifactDigest: "sha256",
      lockfileIntegrity: true,
      appleCodesign: "verified", // Forbidden codesign claim!
      npmProvenance: "not-applicable-until-authorized-registry-publication"
    };
    const signingPath = path.join(temp.dir, "signing.json");
    fs.writeFileSync(signingPath, JSON.stringify(fakeSigning, null, 2), "utf8");

    const report = validateSigningApplicability(temp.dir, { filePath: signingPath });
    assert.equal(report.status, "fail");
    assert.ok(
      report.reasons && report.reasons.some((r: string) => r.includes("Apple codesign") || r.includes("not-applicable")),
      "must reject claimed Apple codesign"
    );
  } finally {
    temp.cleanup();
  }
});

test("e18s02 SC-e18s02-P1-04 validateSigningApplicability fails closed on missing digest or lockfile integrity false", () => {
  const temp = createTempPrefix("signing-missing-");
  try {
    const fakeSigning = {
      channel: "npm-pack-tarball",
      artifactDigest: "", // Missing digest
      lockfileIntegrity: false, // False integrity
      appleCodesign: "not-applicable",
      npmProvenance: "not-applicable-until-authorized-registry-publication"
    };
    const signingPath = path.join(temp.dir, "signing.json");
    fs.writeFileSync(signingPath, JSON.stringify(fakeSigning, null, 2), "utf8");

    const report = validateSigningApplicability(temp.dir, { filePath: signingPath });
    assert.equal(report.status, "fail");
    assert.ok(report.reasons && report.reasons.length >= 2);
  } finally {
    temp.cleanup();
  }
});
