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

export function createValidCompetencyInventory(): Record<string, unknown> {
  return {
    version: "0.1.0",
    catalog: "competency-inventory",
    competencies: [
      {
        id: "comp-test-01",
        name: "Test research framing competency",
        version: "0.1.0",
        purpose: "Test purpose",
        owningRole: "Methodology",
        applicableProfiles: ["quantitative", "qualitative"],
        unsupportedContexts: ["unauthorized network"],
        requiredInputs: ["topic"],
        outputSchema: {
          separatesObservationsFromInferences: true,
          includesContraryOrLimitations: true
        },
        failureConditions: ["conflation of terms"],
        workedSuccess: {
          summary: "Success example summary",
          context: "Test context",
          outcome: "Expected test outcome"
        },
        workedFailure: {
          summary: "Failure example summary",
          context: "Failure test context",
          outcome: "Handled failure outcome"
        },
        source: "docs/03-agents-and-skills.md §4",
        license: "MIT",
        adaptationRecord: "Test adaptation",
        directDependencies: ["typescript", "eslint"],
        outputProvenance: {
          requiresLocators: true,
          separatesObservationInferenceRecommendation: true,
          includesContraryEvidence: true
        }
      }
    ]
  };
}

export function createValidCasePacks(): Record<string, unknown> {
  return {
    version: "0.1.0",
    cases: [
      {
        id: "CP-TEST-01",
        title: "Test Quant Education Case",
        methodProfile: "quantitative",
        disciplinaryContext: "education",
        rubric: {
          id: "rubric-1",
          name: "Rubric 1",
          dimensions: ["unsupportedClaimSeverity", "sourceLocatorAccuracy", "escalation"]
        }
      },
      {
        id: "CP-TEST-02",
        title: "Test Qual HCI Case",
        methodProfile: "qualitative",
        disciplinaryContext: "hci",
        rubric: {
          id: "rubric-2",
          name: "Rubric 2",
          dimensions: ["unsupportedClaimSeverity", "sourceLocatorAccuracy", "escalation"]
        }
      },
      {
        id: "CP-TEST-03",
        title: "Test Mixed IS Case",
        methodProfile: "mixed-methods",
        disciplinaryContext: "information-systems",
        rubric: {
          id: "rubric-3",
          name: "Rubric 3",
          dimensions: ["unsupportedClaimSeverity", "contradictionRetention", "escalation"]
        }
      },
      {
        id: "CP-TEST-04",
        title: "Test Artifact Computing Case",
        methodProfile: "artifact-evaluation",
        disciplinaryContext: "computing",
        rubric: {
          id: "rubric-4",
          name: "Rubric 4",
          dimensions: ["unsupportedClaimSeverity", "sourceLocatorAccuracy", "escalation"]
        }
      },
      {
        id: "CP-TEST-05",
        title: "Test Quant Social Science Case",
        methodProfile: "quantitative",
        disciplinaryContext: "empirical-social-science",
        rubric: {
          id: "rubric-5",
          name: "Rubric 5",
          dimensions: ["unsupportedClaimSeverity", "sourceLocatorAccuracy", "escalation"]
        }
      }
    ]
  };
}

export function createValidHumanEvaluations(): Record<string, unknown> {
  return {
    version: "0.1.0",
    records: [
      {
        caseId: "CP-TEST-01",
        evaluatorKind: "synthetic",
        evaluatorRole: "research-methods-qualified-human",
        disposition: "accept",
        rubricScores: { unsupportedClaimSeverity: 5, sourceLocatorAccuracy: 5, escalation: 5 }
      },
      {
        caseId: "CP-TEST-02",
        evaluatorKind: "synthetic",
        evaluatorRole: "research-methods-qualified-human",
        disposition: "accept",
        rubricScores: { unsupportedClaimSeverity: 5, sourceLocatorAccuracy: 5, escalation: 5 }
      },
      {
        caseId: "CP-TEST-03",
        evaluatorKind: "synthetic",
        evaluatorRole: "research-methods-qualified-human",
        disposition: "accept",
        rubricScores: { unsupportedClaimSeverity: 5, contradictionRetention: 5, escalation: 5 }
      },
      {
        caseId: "CP-TEST-04",
        evaluatorKind: "synthetic",
        evaluatorRole: "research-methods-qualified-human",
        disposition: "accept",
        rubricScores: { unsupportedClaimSeverity: 5, sourceLocatorAccuracy: 5, escalation: 5 }
      },
      {
        caseId: "CP-TEST-05",
        evaluatorKind: "synthetic",
        evaluatorRole: "research-methods-qualified-human",
        disposition: "accept",
        rubricScores: { unsupportedClaimSeverity: 5, sourceLocatorAccuracy: 5, escalation: 5 }
      }
    ]
  };
}

export function writeTempCasePacks(
  projectRoot: string,
  packs: unknown,
  fileName = "case-packs.json"
): string {
  const dir = path.join(projectRoot, "specs", "qualification", "case-packs");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(packs, null, 2), "utf8");
  return filePath;
}

export function writeTempEvaluations(
  projectRoot: string,
  evals: unknown,
  fileName = "evaluations.json"
): string {
  const dir = path.join(projectRoot, "specs", "qualification", "human-evaluations");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(evals, null, 2), "utf8");
  return filePath;
}

export function createValidOutcomeEvidence(): {
  version: string;
  outcomes: Array<{ id: string; epicId: string; title: string; status: string }>;
} {
  const outcomes = Array.from({ length: 17 }, (_, i) => ({
    id: `R${String(i + 1).padStart(2, "0")}`,
    epicId: `e${String(i + 1).padStart(2, "0")}`,
    title: `Outcome R${String(i + 1).padStart(2, "0")}`,
    status: "passed"
  }));
  outcomes.push({
    id: "R18",
    epicId: "e18",
    title: "Installable maintained local release",
    status: "blocked"
  });
  return { version: "0.1.0", outcomes };
}
