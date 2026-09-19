// story: e18s01
import fs from "node:fs";
import path from "node:path";
import type {
  SupportMatrix,
  SupportMatrixCombination,
  SupportMatrixValidationResult
} from "./types.js";

export function loadSupportMatrix(
  root: string = process.cwd(),
  catalogPath?: string
): SupportMatrix {
  const targetFile = catalogPath ?? path.join(root, "specs", "distribution", "support-matrix.json");
  if (!fs.existsSync(targetFile)) {
    throw new Error(`Support matrix catalog not found: ${targetFile}`);
  }

  const raw = fs.readFileSync(targetFile, "utf8");
  const parsed = JSON.parse(raw) as Partial<SupportMatrix>;

  const combinations: SupportMatrixCombination[] = Array.isArray(parsed.combinations)
    ? parsed.combinations.map((c) => ({
        os: String(c.os ?? ""),
        arch: String(c.arch ?? ""),
        nodeMajor: Number(c.nodeMajor ?? 0),
        status: c.status === "verified" ? "verified" : "unverified",
        evidencePointer: String(c.evidencePointer ?? ""),
        notes: c.notes ? String(c.notes) : undefined
      }))
    : [];

  return {
    version: parsed.version ?? "0.1.0",
    combinations,
    scholarlyCertification: false
  };
}

export function validateSupportMatrix(
  matrix: SupportMatrix,
  options?: { projectRoot?: string }
): SupportMatrixValidationResult {
  const reasons: string[] = [];

  if (matrix.scholarlyCertification !== false) {
    reasons.push("Scholarly certification must not be claimed or inferred");
  }

  if (!matrix.combinations || matrix.combinations.length === 0) {
    reasons.push("Support matrix must declare at least one platform combination");
  }

  for (const combination of matrix.combinations ?? []) {
    if (combination.status === "verified") {
      if (combination.nodeMajor !== 24) {
        reasons.push(
          `Verified combination ${combination.os}-${combination.arch} must target Node.js 24, got ${combination.nodeMajor}`
        );
      }
      if (!combination.evidencePointer || combination.evidencePointer.trim().length === 0) {
        reasons.push(
          `Verified combination ${combination.os}-${combination.arch} must have an evidencePointer`
        );
      } else if (options?.projectRoot) {
        const rootResolved = path.resolve(options.projectRoot);
        const evidenceFile = path.resolve(rootResolved, combination.evidencePointer);
        const relative = path.relative(rootResolved, evidenceFile);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          reasons.push(
            `Verified combination ${combination.os}-${combination.arch} evidence pointer must be under project root: ${combination.evidencePointer}`
          );
        } else if (!fs.existsSync(evidenceFile)) {
          reasons.push(
            `Verified combination ${combination.os}-${combination.arch} evidence pointer not found: ${combination.evidencePointer}`
          );
        } else {
          try {
            const stat = fs.statSync(evidenceFile);
            if (!stat.isFile()) {
              reasons.push(
                `Verified combination ${combination.os}-${combination.arch} evidence pointer must be a regular file: ${combination.evidencePointer}`
              );
            }
          } catch {
            reasons.push(
              `Verified combination ${combination.os}-${combination.arch} evidence pointer stat failed: ${combination.evidencePointer}`
            );
          }
        }
      }
    }
  }

  return {
    status: reasons.length === 0 ? "pass" : "fail",
    reasons: reasons.length > 0 ? reasons : undefined
  };
}
