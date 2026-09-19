// story: e18s02
import fs from "node:fs";
import path from "node:path";
import type { SigningApplicability, SigningApplicabilityReport } from "./types.js";

export function validateSigningApplicability(
  root: string = process.cwd(),
  options?: {
    filePath?: string;
  }
): SigningApplicabilityReport {
  const projectRoot = path.resolve(root);
  const targetFile =
    options?.filePath ??
    path.join(projectRoot, "specs", "distribution", "signing-applicability.json");

  if (!fs.existsSync(targetFile)) {
    return {
      status: "fail",
      channel: "unknown",
      artifactDigest: "",
      lockfileIntegrity: false,
      appleCodesign: "unknown",
      reasons: [`Signing applicability file not found at ${targetFile}`]
    };
  }

  const raw = fs.readFileSync(targetFile, "utf8");
  const data = JSON.parse(raw) as Partial<SigningApplicability>;

  const reasons: string[] = [];

  const channel = data.channel ?? "";
  const artifactDigest = data.artifactDigest ?? "";
  const lockfileIntegrity = data.lockfileIntegrity === true;
  const appleCodesign = data.appleCodesign ?? "";
  const npmProvenance = data.npmProvenance ?? "";

  if (channel !== "npm-pack-tarball") {
    reasons.push(`Channel must be "npm-pack-tarball", got "${channel}"`);
  }

  if (!artifactDigest || artifactDigest.toLowerCase() !== "sha256") {
    reasons.push(`Artifact digest algorithm must be sha256, got "${artifactDigest}"`);
  }

  if (!lockfileIntegrity) {
    reasons.push("Lockfile integrity must be true for reproducible package verification");
  }

  if (appleCodesign !== "not-applicable") {
    reasons.push(
      `Apple codesign must be "not-applicable" for npm-pack-tarball channel; got "${appleCodesign}"`
    );
  }

  const APPROVED_NPM_PROVENANCE = "not-applicable-until-authorized-registry-publication";
  if (npmProvenance !== APPROVED_NPM_PROVENANCE) {
    reasons.push(
      `npmProvenance must be exact approved value "${APPROVED_NPM_PROVENANCE}", got "${npmProvenance}"`
    );
  }

  const passed = reasons.length === 0;

  return {
    status: passed ? "pass" : "fail",
    channel,
    artifactDigest,
    lockfileIntegrity,
    appleCodesign,
    npmProvenance,
    reasons: passed ? undefined : reasons
  };
}
