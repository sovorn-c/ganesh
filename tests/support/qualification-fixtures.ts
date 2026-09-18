import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  AcceptanceCatalog,
  QualificationRunnerPort,
  QualificationRunResult
} from "../../src/qualification/qualification-types.js";

export function createValidAcceptanceCatalog(): AcceptanceCatalog {
  const scenarios = [];
  for (let i = 1; i <= 20; i++) {
    const id = `AC-${String(i).padStart(2, "0")}`;
    scenarios.push({
      scenarioId: id,
      title: `Scenario ${id}`,
      testPattern: `e17s01.*${id}`,
      verificationPointer: `tests/qualification/test-${id}.test.ts`
    });
  }
  return {
    version: "1.0.0",
    catalog: "acceptance-scenarios",
    scenarios
  };
}

export function writeTempProjectCatalog(
  projectRoot: string,
  catalog: unknown,
  fileName = "acceptance-catalog.json"
): string {
  const dir = path.join(projectRoot, "specs", "qualification");
  fs.mkdirSync(dir, { recursive: true });
  const catalogPath = path.join(dir, fileName);
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");
  return catalogPath;
}

export function createTempDir(prefix = "ganesh-qual-test-"): {
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

export function createFakeRunner(
  defaultResult: QualificationRunResult = { passed: true, matchedCount: 1 },
  patternOverrides: Record<string, QualificationRunResult> = {}
): QualificationRunnerPort {
  return {
    run: (pattern: string): QualificationRunResult => {
      if (pattern in patternOverrides) {
        return patternOverrides[pattern];
      }
      return defaultResult;
    }
  };
}
