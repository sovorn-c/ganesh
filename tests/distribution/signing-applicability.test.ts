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

test("e18s02 SC-e18s02-P0-03 validateSigningApplicability fails closed on non-npm channel or invalid npmProvenance", () => {
  const temp = createTempPrefix("signing-channel-");
  try {
    const fakeSigning = {
      channel: "not-npm", // Arbitrary channel!
      artifactDigest: "sha256",
      lockfileIntegrity: true,
      appleCodesign: "not-applicable",
      npmProvenance: "not-applicable-until-authorized-registry-publication"
    };
    const signingPath = path.join(temp.dir, "signing.json");
    fs.writeFileSync(signingPath, JSON.stringify(fakeSigning, null, 2), "utf8");

    const report = validateSigningApplicability(temp.dir, { filePath: signingPath });
    assert.equal(report.status, "fail");
    assert.ok(
      report.reasons && report.reasons.some((r: string) => r.includes("Channel must be \"npm-pack-tarball\"")),
      "must reject arbitrary channel"
    );

    // Also test invalid npmProvenance
    const fakeSigning2 = {
      channel: "npm-pack-tarball",
      artifactDigest: "sha256",
      lockfileIntegrity: true,
      appleCodesign: "not-applicable",
      npmProvenance: "published-active" // Invalid claim!
    };
    fs.writeFileSync(signingPath, JSON.stringify(fakeSigning2, null, 2), "utf8");
    const report2 = validateSigningApplicability(temp.dir, { filePath: signingPath });
    assert.equal(report2.status, "fail");
    assert.ok(
      report2.reasons && report2.reasons.some((r: string) => r.includes("npmProvenance")),
      "must reject published-active npmProvenance"
    );

    // Test missing npmProvenance entirely
    const fakeSigning3 = {
      channel: "npm-pack-tarball",
      artifactDigest: "sha256",
      lockfileIntegrity: true,
      appleCodesign: "not-applicable"
      // no npmProvenance
    };
    fs.writeFileSync(signingPath, JSON.stringify(fakeSigning3, null, 2), "utf8");
    const report3 = validateSigningApplicability(temp.dir, { filePath: signingPath });
    assert.equal(report3.status, "fail");
    assert.ok(
      report3.reasons && report3.reasons.some((r: string) => r.includes("npmProvenance")),
      "must reject missing npmProvenance"
    );

    // Test forged npmProvenance: "not-applicable-forged"
    const fakeSigning4 = {
      channel: "npm-pack-tarball",
      artifactDigest: "sha256",
      lockfileIntegrity: true,
      appleCodesign: "not-applicable",
      npmProvenance: "not-applicable-forged" // Forged provenance!
    };
    fs.writeFileSync(signingPath, JSON.stringify(fakeSigning4, null, 2), "utf8");
    const report4 = validateSigningApplicability(temp.dir, { filePath: signingPath });
    assert.equal(report4.status, "fail");
    assert.ok(
      report4.reasons && report4.reasons.some((r: string) => r.includes("npmProvenance") || r.includes("exact approved value")),
      "must reject forged not-applicable-forged npmProvenance"
    );
  } finally {
    temp.cleanup();
  }
});
