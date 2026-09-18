import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  AcceptanceCatalog,
  AdversarialCatalog,
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

export function createValidAdversarialCatalog(): AdversarialCatalog {
  return {
    version: "1.0.0",
    catalog: "adversarial-safety-classes",
    classes: [
      {
        classId: "approval-forgery",
        title: "Human approval cannot be forged",
        testPattern: "e17s02.*approval-forgery",
        verificationPointer: "tests/decisions/decision-packets.test.ts"
      },
      {
        classId: "stale-state",
        title: "Stale decision packets are rejected",
        testPattern: "e17s02.*stale",
        verificationPointer: "tests/decisions/decision-packets.test.ts"
      },
      {
        classId: "malicious-import",
        title: "Adversarial imports fail closed",
        testPattern: "e17s02.*malicious",
        verificationPointer: "tests/policy/declassification-boundaries.test.ts"
      },
      {
        classId: "permission-race",
        title: "Permission races follow current policy",
        testPattern: "e17s02.*permission-race",
        verificationPointer: "tests/qualification/permission-races.test.ts"
      },
      {
        classId: "cancellation",
        title: "Cancellation fences and quarantines late outputs",
        testPattern: "e17s02.*cancel",
        verificationPointer: "tests/work/provider-cancellation.test.ts"
      },
      {
        classId: "recovery",
        title: "Interrupted execution and crash recovery preserves complete state",
        testPattern: "e17s02.*recover",
        verificationPointer: "tests/portability/crash-concurrency.test.ts"
      }
    ]
  };
}
