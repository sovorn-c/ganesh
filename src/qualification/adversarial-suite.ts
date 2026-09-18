// story: e17s02
import fs from "node:fs";
import path from "node:path";
import { redactDiagnostic } from "../runtime/preflight.js";
import { defaultQualificationRunner } from "./acceptance-evidence.js";
import type {
  AdversarialCatalog,
  AdversarialClassId,
  AdversarialClassMapping,
  AdversarialEvidenceRow,
  AdversarialQualificationOptions,
  AdversarialQualificationReport,
  QualificationRunner,
  QualificationRunnerPort
} from "./qualification-types.js";

export const REQUIRED_ADVERSARIAL_CLASSES: readonly AdversarialClassId[] = Object.freeze([
  "approval-forgery",
  "stale-state",
  "malicious-import",
  "permission-race",
  "cancellation",
  "recovery"
]);

const CLASS_DOMAIN_PATTERNS: Record<string, RegExp> = {
  "approval-forgery": /approval-forgery|forg|approval/i,
  "stale-state": /stale-state|stale/i,
  "malicious-import": /malicious-import|malicious|adversarial|injection|cross\.project|boundary/i,
  "permission-race": /permission-race|race|withdraw|revoke|classify/i,
  "cancellation": /cancellation|cancel/i,
  "recovery": /recovery|recover|crash/i
};

export function loadAdversarialCatalog(
  projectRoot: string,
  fileName = "adversarial-catalog.json"
): AdversarialCatalog {
  const catalogPath = path.join(projectRoot, "specs", "qualification", fileName);
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Adversarial catalog file not found: ${catalogPath}`);
  }

  let parsed: unknown;
  try {
    const raw = fs.readFileSync(catalogPath, "utf8");
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse adversarial catalog at ${catalogPath}: ${(err as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Adversarial catalog must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  if (record.certified !== undefined || record.securityCertification === "certified") {
    throw new Error("Adversarial catalog cannot claim certified status: certified flag is rejected");
  }

  if (!Array.isArray(record.classes)) {
    throw new Error("Adversarial catalog classes must be an array");
  }

  return parsed as AdversarialCatalog;
}

function resolveRunner(
  runnerOption?: QualificationRunnerPort | QualificationRunner
): QualificationRunner {
  if (!runnerOption) {
    return defaultQualificationRunner;
  }
  if (typeof runnerOption === "function") {
    return runnerOption;
  }
  return runnerOption.run.bind(runnerOption);
}

export function runAdversarialQualification(
  projectRoot: string,
  options?: AdversarialQualificationOptions
): AdversarialQualificationReport {
  let catalog: AdversarialCatalog;
  try {
    catalog = loadAdversarialCatalog(projectRoot, options?.catalogFile);
  } catch (err) {
    const errorMsg = redactDiagnostic((err as Error).message);
    return {
      status: "failed",
      classesTotal: 0,
      classesPassing: 0,
      classesFailing: 0,
      rows: [],
      securityCertification: "not-inferred",
      reasons: [errorMsg]
    };
  }

  const reasons: string[] = [];
  const classMap = new Map<string, AdversarialClassMapping[]>();

  for (const item of catalog.classes) {
    if (!item || typeof item.classId !== "string") {
      reasons.push("Adversarial catalog contains entry without valid classId");
      continue;
    }
    const list = classMap.get(item.classId) ?? [];
    list.push(item);
    classMap.set(item.classId, list);
  }

  // Check duplicates
  for (const [id, list] of classMap.entries()) {
    if (list.length > 1) {
      reasons.push(`Duplicate adversarial safety class in catalog: ${id}`);
    }
  }

  // Check unknown classes
  for (const id of classMap.keys()) {
    if (!REQUIRED_ADVERSARIAL_CLASSES.includes(id as AdversarialClassId)) {
      reasons.push(`Unknown adversarial safety class in catalog: ${id}`);
    }
  }

  // Check missing required classes
  for (const reqClass of REQUIRED_ADVERSARIAL_CLASSES) {
    if (!classMap.has(reqClass)) {
      reasons.push(`Missing required adversarial safety class: ${reqClass}`);
    }
  }

  const isExecuteMode = options?.mode === "execute";
  const runner = isExecuteMode ? resolveRunner(options?.runner) : undefined;
  const rows: AdversarialEvidenceRow[] = [];

  for (const reqClass of REQUIRED_ADVERSARIAL_CLASSES) {
    const list = classMap.get(reqClass);
    if (!list || list.length === 0) {
      rows.push({
        classId: reqClass,
        testPattern: "",
        verificationPointer: "",
        status: "failed",
        reason: redactDiagnostic(`Missing class mapping for ${reqClass}`)
      });
      continue;
    }

    const mapping = list[0];
    const hasPattern = typeof mapping.testPattern === "string" && mapping.testPattern.trim().length > 0;
    const hasPointer = typeof mapping.verificationPointer === "string" && mapping.verificationPointer.trim().length > 0;

    if (!hasPattern || !hasPointer) {
      rows.push({
        classId: reqClass,
        title: mapping.title,
        testPattern: mapping.testPattern ?? "",
        verificationPointer: mapping.verificationPointer ?? "",
        status: "failed",
        reason: redactDiagnostic("Pattern or verification pointer is missing or empty")
      });
      continue;
    }

    // Check safety domain pattern match
    const domainPattern = CLASS_DOMAIN_PATTERNS[reqClass];
    const matchesDomain = domainPattern && domainPattern.test(mapping.testPattern);
    if (!matchesDomain) {
      const reason = redactDiagnostic(
        `Class mapping for ${reqClass} does not match expected safety domain: ${mapping.testPattern}`
      );
      reasons.push(reason);
      rows.push({
        classId: reqClass,
        title: mapping.title,
        testPattern: mapping.testPattern,
        verificationPointer: mapping.verificationPointer,
        status: "failed",
        reason
      });
      continue;
    }

    if (isExecuteMode && runner) {
      try {
        const runRes = runner(mapping.testPattern, mapping.verificationPointer);
        if (runRes.passed && runRes.matchedCount > 0) {
          rows.push({
            classId: reqClass,
            title: mapping.title,
            testPattern: mapping.testPattern,
            verificationPointer: mapping.verificationPointer,
            status: "pass",
            matchedCount: runRes.matchedCount
          });
        } else if (runRes.matchedCount === 0) {
          const reason = redactDiagnostic(runRes.error ?? `No tests matched pattern: ${mapping.testPattern} (0 tests matched)`);
          rows.push({
            classId: reqClass,
            title: mapping.title,
            testPattern: mapping.testPattern,
            verificationPointer: mapping.verificationPointer,
            status: "failed",
            matchedCount: 0,
            reason
          });
        } else {
          const reason = redactDiagnostic(runRes.error ?? "Test execution failed");
          rows.push({
            classId: reqClass,
            title: mapping.title,
            testPattern: mapping.testPattern,
            verificationPointer: mapping.verificationPointer,
            status: "failed",
            matchedCount: runRes.matchedCount,
            reason
          });
        }
      } catch (runErr) {
        rows.push({
          classId: reqClass,
          title: mapping.title,
          testPattern: mapping.testPattern,
          verificationPointer: mapping.verificationPointer,
          status: "failed",
          reason: redactDiagnostic((runErr as Error).message)
        });
      }
    } else {
      // Catalog validation mode
      rows.push({
        classId: reqClass,
        title: mapping.title,
        testPattern: mapping.testPattern,
        verificationPointer: mapping.verificationPointer,
        status: "pass"
      });
    }
  }

  const classesPassing = rows.filter((r) => r.status === "pass").length;
  const classesFailing = rows.filter((r) => r.status === "failed").length;
  const passedOverall = reasons.length === 0 && classesFailing === 0 && classesPassing === REQUIRED_ADVERSARIAL_CLASSES.length;

  return {
    status: passedOverall ? "pass" : "failed",
    classesTotal: rows.length,
    classesPassing,
    classesFailing,
    rows,
    securityCertification: "not-inferred",
    ...(reasons.length > 0 ? { reasons: reasons.map((r) => redactDiagnostic(r)) } : {})
  };
}
