import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SupportMatrix } from "../../src/distribution/types.js";

export function createTempPrefix(prefix = "ganesh-dist-"): {
  dir: string;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  };
}

export function createSampleSupportMatrix(overrides?: Partial<SupportMatrix>): SupportMatrix {
  return {
    version: "0.1.0",
    scholarlyCertification: false,
    combinations: [
      {
        os: process.platform,
        arch: process.arch,
        nodeMajor: 24,
        status: "verified",
        evidencePointer: "specs/verifications/e18s01-verify.yaml",
        notes: `Verified on ${process.platform} ${process.arch} Node 24`
      },
      {
        os: "darwin",
        arch: "arm64",
        nodeMajor: 24,
        status: "unverified",
        evidencePointer: "",
        notes: "Apple Silicon unverified without smoke run"
      },
      {
        os: "darwin",
        arch: "x64",
        nodeMajor: 24,
        status: "unverified",
        evidencePointer: "",
        notes: "macOS Intel unverified without smoke run"
      }
    ],
    ...overrides
  };
}

export function writeTempSupportMatrix(
  projectRoot: string,
  matrix: unknown,
  fileName = "support-matrix.json"
): string {
  const dir = path.join(projectRoot, "specs", "distribution");
  fs.mkdirSync(dir, { recursive: true });
  const targetPath = path.join(dir, fileName);
  fs.writeFileSync(targetPath, JSON.stringify(matrix, null, 2), "utf8");
  return targetPath;
}
