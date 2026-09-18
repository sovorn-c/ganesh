// story: e17s01
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { redactDiagnostic } from "../runtime/preflight.js";
import type {
  AcceptanceCatalog,
  AcceptanceEvidenceOptions,
  AcceptanceEvidenceReport,
  AcceptanceEvidenceRow,
  AcceptanceScenarioMapping,
  QualificationRunner,
  QualificationRunnerPort,
  QualificationRunResult
} from "./qualification-types.js";

export const REQUIRED_ACCEPTANCE_SCENARIO_IDS: readonly string[] = Object.freeze(
  Array.from({ length: 20 }, (_, i) => `AC-${String(i + 1).padStart(2, "0")}`)
);

export function loadAcceptanceCatalog(projectRoot: string, fileName = "acceptance-catalog.json"): AcceptanceCatalog {
  const catalogPath = path.join(projectRoot, "specs", "qualification", fileName);
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Acceptance catalog file not found: ${catalogPath}`);
  }

  let parsed: unknown;
  try {
    const raw = fs.readFileSync(catalogPath, "utf8");
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse acceptance catalog at ${catalogPath}: ${(err as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Acceptance catalog must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  if (record.certified !== undefined || record.scholarlyCertification === "certified") {
    throw new Error("Acceptance catalog cannot claim certified status: certified flag is rejected");
  }

  if (!Array.isArray(record.scenarios)) {
    throw new Error("Acceptance catalog scenarios must be an array");
  }

  return parsed as AcceptanceCatalog;
}

export function defaultQualificationRunner(
  testPattern: string,
  verificationPointer?: string
): QualificationRunResult {
  const root = path.resolve(".");
  const testFile = verificationPointer
    ? path.join(root, verificationPointer.replace(/\.ts$/, ".js").replace(/^tests\//, "dist/tests/"))
    : undefined;
  const targetFiles = testFile && fs.existsSync(testFile)
    ? [testFile]
    : [path.join(root, "dist", "tests", "*", "*.test.js")];

  const scriptPath = path.join(root, "scripts", "require-test-match.mjs");
  const result = spawnSync(process.execPath, [scriptPath, testPattern, ...targetFiles], {
    encoding: "utf8"
  });

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0) {
    const passedMatch = output.match(/(?:ℹ|#) pass (\d+)/);
    const count = passedMatch ? Number(passedMatch[1]) : 1;
    return { passed: true, matchedCount: count };
  }

  const isZeroMatch = /matched no tests/i.test(output);
  return {
    passed: false,
    matchedCount: isZeroMatch ? 0 : 1,
    error: redactDiagnostic(output.trim() || "Test pattern execution failed")
  };
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

export function runAcceptanceEvidence(
  projectRoot: string,
  options?: AcceptanceEvidenceOptions
): AcceptanceEvidenceReport {
  let catalog: AcceptanceCatalog;
  try {
    catalog = loadAcceptanceCatalog(projectRoot, options?.catalogFile);
  } catch (err) {
    const errorMsg = redactDiagnostic((err as Error).message);
    return {
      status: "failed",
      scenariosTotal: 0,
      scenariosPassing: 0,
      scenariosFailing: 0,
      rows: [],
      scholarlyCertification: "not-inferred",
      reasons: [errorMsg]
    };
  }

  const reasons: string[] = [];
  const scenarioMap = new Map<string, AcceptanceScenarioMapping[]>();

  for (const item of catalog.scenarios) {
    if (!item || typeof item.scenarioId !== "string") {
      reasons.push("Catalog contains item without valid scenarioId");
      continue;
    }
    const list = scenarioMap.get(item.scenarioId) ?? [];
    list.push(item);
    scenarioMap.set(item.scenarioId, list);
  }

  // Check for duplicate scenario IDs
  for (const [id, list] of scenarioMap.entries()) {
    if (list.length > 1) {
      reasons.push(`Duplicate scenario id in catalog: ${id}`);
    }
  }

  // Check for unknown scenario IDs
  for (const id of scenarioMap.keys()) {
    if (!REQUIRED_ACCEPTANCE_SCENARIO_IDS.includes(id)) {
      reasons.push(`Unknown scenario id in catalog: ${id}`);
    }
  }

  // Check for missing required scenario IDs
  for (const reqId of REQUIRED_ACCEPTANCE_SCENARIO_IDS) {
    if (!scenarioMap.has(reqId)) {
      reasons.push(`Missing required scenario id: ${reqId}`);
    }
  }

  const isExecuteMode = options?.mode === "execute";
  const runner = isExecuteMode ? resolveRunner(options?.runner) : undefined;
  const rows: AcceptanceEvidenceRow[] = [];

  for (const reqId of REQUIRED_ACCEPTANCE_SCENARIO_IDS) {
    const list = scenarioMap.get(reqId);
    if (!list || list.length === 0) {
      rows.push({
        scenarioId: reqId,
        testPattern: "",
        verificationPointer: "",
        status: "failed",
        reason: redactDiagnostic(`Missing scenario mapping for ${reqId}`)
      });
      continue;
    }

    const mapping = list[0];
    const hasPattern = typeof mapping.testPattern === "string" && mapping.testPattern.trim().length > 0;
    const hasPointer = typeof mapping.verificationPointer === "string" && mapping.verificationPointer.trim().length > 0;

    if (!hasPattern || !hasPointer) {
      rows.push({
        scenarioId: reqId,
        title: mapping.title,
        testPattern: mapping.testPattern ?? "",
        verificationPointer: mapping.verificationPointer ?? "",
        status: "failed",
        reason: redactDiagnostic("Pattern or verification pointer is missing or empty")
      });
      continue;
    }

    if (isExecuteMode && runner) {
      try {
        const runRes = runner(mapping.testPattern, mapping.verificationPointer);
        if (runRes.passed && runRes.matchedCount > 0) {
          rows.push({
            scenarioId: reqId,
            title: mapping.title,
            testPattern: mapping.testPattern,
            verificationPointer: mapping.verificationPointer,
            status: "pass",
            matchedCount: runRes.matchedCount
          });
        } else if (runRes.matchedCount === 0) {
          const reason = redactDiagnostic(runRes.error ?? `No tests matched pattern: ${mapping.testPattern} (non-match)`);
          rows.push({
            scenarioId: reqId,
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
            scenarioId: reqId,
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
          scenarioId: reqId,
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
        scenarioId: reqId,
        title: mapping.title,
        testPattern: mapping.testPattern,
        verificationPointer: mapping.verificationPointer,
        status: "pass"
      });
    }
  }

  const scenariosPassing = rows.filter((r) => r.status === "pass").length;
  const scenariosFailing = rows.filter((r) => r.status === "failed").length;
  const passedOverall = reasons.length === 0 && scenariosFailing === 0 && scenariosPassing === REQUIRED_ACCEPTANCE_SCENARIO_IDS.length;

  return {
    status: passedOverall ? "pass" : "failed",
    scenariosTotal: rows.length,
    scenariosPassing,
    scenariosFailing,
    rows,
    scholarlyCertification: "not-inferred",
    ...(reasons.length > 0 ? { reasons: reasons.map((r) => redactDiagnostic(r)) } : {})
  };
}
