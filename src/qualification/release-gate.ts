// story: e17s05
import fs from "node:fs";
import path from "node:path";
import { redactDiagnostic } from "../runtime/preflight.js";
import { runAcceptanceEvidence } from "./acceptance-evidence.js";
import { runAdversarialQualification } from "./adversarial-suite.js";
import { validateCompetencyInventory } from "./competency-inventory.js";
import { evaluateHumanProtocol } from "./human-evaluation.js";
import { validatePackagingEvidence } from "../distribution/packaging-evidence.js";
import type {
  OutcomeEvidenceItem,
  OutcomeEvidenceCatalog,
  ReleaseQualificationOptions,
  ReleaseQualificationReport,
  SafetyDefectItem,
  SafetyDefectLedger
} from "./qualification-types.js";

const E19_VERIFICATION_POINTERS = new Set([
  "specs/tech-architecture/e19-TEST_PLAN_LATEST.md",
  "tests/workspace/launch-guidance.test.ts",
  "tests/workspace/research-entry-points.test.ts",
  "tests/workspace/competency-affordances.test.ts",
  "tests/workspace/execution-mode-guidance.test.ts",
  "tests/distribution/release-messaging.test.ts",
  "tests/distribution/continuous-verification.test.ts",
  "tests/qualification/e19-release-gate.test.ts",
  ".github/workflows/local-gates.yml"
]);

function validateE19VerificationPointer(projectRoot: string, pointer: string | undefined): boolean {
  if (!pointer) {
    return false;
  }
  const pointers = pointer.split(";").map((value) => value.trim()).filter(Boolean);
  return pointers.length > 0 && pointers.every((value) => {
    if (path.isAbsolute(value) || !E19_VERIFICATION_POINTERS.has(value)) {
      return false;
    }
    try {
      const rootPath = fs.realpathSync(projectRoot);
      const evidencePath = fs.realpathSync(path.resolve(projectRoot, value));
      return evidencePath.startsWith(`${rootPath}${path.sep}`) && fs.statSync(evidencePath).isFile();
    } catch {
      return false;
    }
  });
}

const DEFAULT_OUTCOME_METADATA: Readonly<Record<string, { readonly epicId: string; readonly title: string }>> = Object.freeze({
  R01: { epicId: "e01", title: "Verified development and runtime baseline" },
  R02: { epicId: "e02", title: "Durable versioned research projects" },
  R03: { epicId: "e03", title: "Enforced data-use and capability controls" },
  R04: { epicId: "e04", title: "Transparent lifecycle and decision governance" },
  R05: { epicId: "e05", title: "Bounded autonomous research execution" },
  R06: { epicId: "e06", title: "Safe research source and material intake" },
  R07: { epicId: "e07", title: "Located research evidence and claims" },
  R08: { epicId: "e08", title: "Literature discovery and contribution grounding" },
  R09: { epicId: "e09", title: "Method-sensitive research design guidance" },
  R10: { epicId: "e10", title: "Research ethics, data governance, and authorization" },
  R11: { epicId: "e11", title: "Isolated, reproducible research analysis" },
  R12: { epicId: "e12", title: "Study progress, deviations, and human oversight" },
  R13: { epicId: "e13", title: "Traceable research writing and review cycles" },
  R14: { epicId: "e14", title: "Terminal workspace integration and accessible live state" },
  R15: { epicId: "e15", title: "Research state recovery, portability, and clean deletion" },
  R16: { epicId: "e16", title: "Operational reliability, budgets, and redacted diagnostics" },
  R17: { epicId: "e17", title: "Scholarly and adversarial release qualification" },
  R18: { epicId: "e18", title: "Installable maintained local release" },
  R19: { epicId: "e19", title: "Researcher-facing workspace polish and continuous verification" }
});

export function loadSafetyDefects(
  projectRoot: string,
  fileName?: string
): SafetyDefectItem[] {
  const filePath = fileName
    ? fileName
    : path.join(projectRoot, "specs", "qualification", "safety-defects.json");
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as SafetyDefectLedger | { defects?: SafetyDefectItem[] };
    return parsed.defects ? [...parsed.defects] : [];
  } catch {
    return [];
  }
}

export function loadOutcomeEvidence(
  projectRoot: string,
  fileName?: string
): OutcomeEvidenceItem[] {
  const filePath = fileName
    ? fileName
    : path.join(projectRoot, "specs", "qualification", "outcome-evidence.json");
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as OutcomeEvidenceCatalog | { outcomes?: OutcomeEvidenceItem[] };
    return parsed.outcomes ? [...parsed.outcomes] : [];
  } catch {
    return [];
  }
}

export function runReleaseQualification(
  projectRoot: string,
  options?: ReleaseQualificationOptions
): ReleaseQualificationReport {
  const reasons: string[] = [];

  // 1. Acceptance scenarios
  const acceptance = runAcceptanceEvidence(projectRoot, {
    runner: options?.runner,
    mode: options?.mode,
    catalogFile: options?.acceptanceCatalogFile
  });
  if (acceptance.status !== "pass") {
    reasons.push("Acceptance scenario behavioral catalog failed");
    if (acceptance.reasons) {
      reasons.push(...acceptance.reasons);
    }
  }

  // 2. Adversarial safety classes
  const adversarial = runAdversarialQualification(projectRoot, {
    runner: options?.runner,
    mode: options?.mode,
    catalogFile: options?.adversarialCatalogFile
  });
  if (adversarial.status !== "pass") {
    reasons.push("Adversarial safety classes qualification failed");
    if (adversarial.reasons) {
      reasons.push(...adversarial.reasons);
    }
  }

  // 3. Competency metadata and provenance
  const competency = validateCompetencyInventory(projectRoot, {
    inventoryFile: options?.competencyInventoryFile
  });
  if (competency.status !== "pass") {
    reasons.push("Competency inventory validation failed");
    if (competency.reasons) {
      reasons.push(...competency.reasons);
    }
  }

  // 4. Human-evaluation protocol
  const humanEvaluation = evaluateHumanProtocol(projectRoot, {
    casePacksFile: options?.casePacksFile,
    evaluationsFile: options?.evaluationsFile
  });
  if (humanEvaluation.status !== "pass") {
    reasons.push("Human-evaluation protocol validation failed");
    if (humanEvaluation.reasons) {
      reasons.push(...humanEvaluation.reasons);
    }
  }

  // 5. Safety defects ledger
  const safetyDefects = loadSafetyDefects(projectRoot, options?.safetyDefectsFile);
  const criticalDefects = safetyDefects.filter(
    (d) => d.severity === "critical" && d.status !== "resolved"
  );
  if (criticalDefects.length > 0) {
    for (const defect of criticalDefects) {
      reasons.push(`Critical safety defect open: ${defect.id} - ${defect.title}`);
    }
  }

  // 6. Outcome evidence (R01 through R19)
  const rawOutcomes = loadOutcomeEvidence(projectRoot, options?.outcomeEvidenceFile);
  const rawOutcomeMap = new Map<string, OutcomeEvidenceItem>();
  for (const item of rawOutcomes) {
    rawOutcomeMap.set(item.id, item);
  }

  const allOutcomeIds = Array.from({ length: 19 }, (_, i) => `R${String(i + 1).padStart(2, "0")}`);
  const outcomes: OutcomeEvidenceItem[] = [];

  for (const id of allOutcomeIds) {
    const existing = rawOutcomeMap.get(id);
    const meta = DEFAULT_OUTCOME_METADATA[id] ?? { epicId: `e${id.slice(1).toLowerCase()}`, title: `Scope outcome ${id}` };
    if (id === "R18") {
      const packagingEvidence = validatePackagingEvidence(projectRoot);
      const catalogClaimsPassed = existing?.status === "passed";

      if (catalogClaimsPassed) {
        if (packagingEvidence.status === "pass") {
          outcomes.push({
            id: "R18",
            epicId: existing?.epicId ?? meta.epicId,
            title: existing?.title ?? meta.title,
            status: "passed",
            verificationPointer: existing?.verificationPointer ?? "specs/verifications/e18-verify.yaml"
          });
        } else {
          // Reject invented evidence: catalog claims passed but packaging evidence is missing or invalid
          outcomes.push({
            id: "R18",
            epicId: existing?.epicId ?? meta.epicId,
            title: existing?.title ?? meta.title,
            status: "blocked",
            verificationPointer: existing?.verificationPointer ?? "invented evidence: packaging evidence missing or invalid"
          });
          reasons.push(
            `Invented evidence: R18 is marked passed in catalog but packaging evidence is invalid: ${packagingEvidence.reasons?.join("; ") ?? "missing packaging artifacts"}`
          );
        }
      } else {
        outcomes.push({
          id: "R18",
          epicId: existing?.epicId ?? meta.epicId,
          title: existing?.title ?? meta.title,
          status: existing?.status ?? "blocked",
          verificationPointer: existing?.verificationPointer ?? "unimplemented; assigned to E18 release packaging"
        });
      }
    } else if (id === "R19") {
      const catalogClaimsPassed = existing?.status === "passed";
      const pointer = existing?.verificationPointer;
      const hasE19Pointer = validateE19VerificationPointer(projectRoot, pointer);
      if (catalogClaimsPassed && !hasE19Pointer) {
        outcomes.push({
          id: "R19",
          epicId: existing?.epicId ?? meta.epicId,
          title: existing?.title ?? meta.title,
          status: "blocked",
          verificationPointer: pointer ?? "invented evidence: R19 requires an allowlisted E19 verification pointer"
        });
        reasons.push("Invented evidence: R19 is marked passed without an E19 verification pointer");
      } else {
        outcomes.push({
          id: "R19",
          epicId: existing?.epicId ?? meta.epicId,
          title: existing?.title ?? meta.title,
          status: existing?.status ?? "unimplemented",
          ...(pointer === undefined ? { verificationPointer: "missing from outcome evidence catalog" } : { verificationPointer: pointer })
        });
        if (existing && existing.status !== "passed") {
          reasons.push(`Required local scope outcome R19 is not passed: ${existing.status}`);
        }
      }
    } else if (existing) {
      outcomes.push(existing);
      if (existing.status !== "passed") {
        reasons.push(`Required local scope outcome ${id} is not passed: ${existing.status}`);
      }
    } else {
      // Emit non-passing placeholder for missing outcome
      outcomes.push({
        id,
        epicId: meta.epicId,
        title: meta.title,
        status: "unimplemented",
        verificationPointer: "missing from outcome evidence catalog"
      });
      reasons.push(`Missing scope outcome in catalog: ${id}`);
    }
  }

  // R19 is optional for pre-E19 catalogs, but any supplied R19 claim must be verified.
  const localOutcomeIds = allOutcomeIds.filter((id) => id !== "R18" && id !== "R19");
  const allRequiredLocalOutcomesPresent = localOutcomeIds.every((id) => rawOutcomeMap.has(id));
  const localScopeOutcomesPassed = localOutcomeIds.every((id) => rawOutcomeMap.get(id)?.status === "passed");
  const r19Satisfied = !rawOutcomeMap.has("R19") || outcomes.some((outcome) => outcome.id === "R19" && outcome.status === "passed");

  const localQualificationPassed =
    acceptance.status === "pass" &&
    adversarial.status === "pass" &&
    competency.status === "pass" &&
    humanEvaluation.status === "pass" &&
    criticalDefects.length === 0 &&
    allRequiredLocalOutcomesPresent &&
    localScopeOutcomesPassed &&
    r19Satisfied &&
    reasons.length === 0;

  // Shipment requires:
  // - localQualification === "pass"
  // - no critical safety defects
  // - qualified human coverage (not just synthetic)
  // - R18 and R19 implemented and verified (R18 is not yet implemented in the current local release)
  const hasShipmentBlockers =
    !localQualificationPassed ||
    criticalDefects.length > 0 ||
    !humanEvaluation.hasQualifiedHumanCoverage ||
    outcomes.some((o) => o.status === "blocked" || o.status === "unimplemented");

  const shipmentStatus = hasShipmentBlockers ? "blocked" : "authorized";

  return {
    localQualification: localQualificationPassed ? "pass" : "failed",
    shipment: shipmentStatus,
    acceptance,
    adversarial,
    competency,
    humanEvaluation,
    outcomes,
    safetyDefects,
    hostedCi: false,
    productionReady: false,
    scholarlyCertification: "not-inferred",
    ...(reasons.length > 0 ? { reasons: reasons.map((r) => redactDiagnostic(r)) } : {})
  };
}

export function renderReleaseQualificationReport(report: ReleaseQualificationReport): string {
  const lines: string[] = [];
  lines.push("=== Ganesh Release Qualification Report ===");
  lines.push(`Local Qualification: ${report.localQualification.toUpperCase()}`);
  lines.push(`Shipment:            ${report.shipment.toUpperCase()}`);
  lines.push(`Hosted CI:           ${report.hostedCi}`);
  lines.push(`Production Ready:    ${report.productionReady}`);
  lines.push(`Scholarly Certified: ${report.scholarlyCertification}`);
  lines.push("");

  lines.push("--- Composed Sections ---");
  lines.push(
    `Acceptance Catalog:   ${report.acceptance.status.toUpperCase()} (${report.acceptance.scenariosPassing}/${report.acceptance.scenariosTotal} scenarios)`
  );
  lines.push(
    `Adversarial Classes:  ${report.adversarial.status.toUpperCase()} (${report.adversarial.classesPassing}/${report.adversarial.classesTotal} classes)`
  );
  lines.push(
    `Competency Metadata:  ${report.competency.status.toUpperCase()} (${report.competency.competenciesPassing}/${report.competency.competenciesTotal} competencies)`
  );
  lines.push(
    `Human Evaluation:     ${report.humanEvaluation.status.toUpperCase()} (${report.humanEvaluation.casesEvaluated}/${report.humanEvaluation.casesTotal} cases evaluated, qualifiedHumanCoverage: ${report.humanEvaluation.hasQualifiedHumanCoverage})`
  );
  lines.push("");

  lines.push(`--- Safety Defects (${report.safetyDefects.length}) ---`);
  if (report.safetyDefects.length === 0) {
    lines.push("No safety defects recorded.");
  } else {
    for (const d of report.safetyDefects) {
      lines.push(`  [${d.severity.toUpperCase()}] ${d.id}: ${d.title} (${d.status})`);
    }
  }
  lines.push("");

  lines.push(`--- Scope Outcomes R01–R19 (${report.outcomes.length}) ---`);
  for (const o of report.outcomes) {
    lines.push(`  ${o.id} (${o.epicId}): ${o.status.toUpperCase()} - ${o.title}`);
  }

  if (report.reasons && report.reasons.length > 0) {
    lines.push("");
    lines.push("--- Diagnostics & Blockers ---");
    for (const r of report.reasons) {
      lines.push(`  * ${r}`);
    }
  }

  return lines.join("\n");
}
