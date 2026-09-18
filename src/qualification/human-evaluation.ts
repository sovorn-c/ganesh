// story: e17s04
import fs from "node:fs";
import path from "node:path";
import { redactDiagnostic } from "../runtime/preflight.js";
import type {
  CasePack,
  CasePackCatalog,
  DisciplinaryContextId,
  EvaluatorKind,
  HumanEvaluationProtocolOptions,
  HumanEvaluationProtocolReport,
  HumanEvaluationRecord,
  HumanEvaluationRow,
  QualificationMethodProfileId
} from "./qualification-types.js";

export const REQUIRED_METHOD_PROFILES: readonly QualificationMethodProfileId[] = Object.freeze([
  "quantitative",
  "qualitative",
  "mixed-methods",
  "artifact-evaluation"
]);

export const REQUIRED_DISCIPLINARY_CONTEXTS: readonly DisciplinaryContextId[] = Object.freeze([
  "empirical-social-science",
  "information-systems",
  "hci",
  "education",
  "computing"
]);

export function loadCasePacks(
  projectRoot: string,
  options?: HumanEvaluationProtocolOptions
): readonly CasePack[] {
  const customFile = options?.casePacksFile;
  if (customFile) {
    if (!fs.existsSync(customFile)) {
      throw new Error(`Case packs file not found: ${customFile}`);
    }
    const raw = fs.readFileSync(customFile, "utf8");
    const parsed = JSON.parse(raw) as CasePackCatalog | { cases?: readonly CasePack[] };
    return parsed.cases ? [...parsed.cases] : [];
  }

  const baseDir = options?.casePacksDir ?? path.join(projectRoot, "specs", "qualification", "case-packs");
  if (!fs.existsSync(baseDir)) {
    throw new Error(`Case packs directory not found: ${baseDir}`);
  }

  const mainFile = path.join(baseDir, "case-packs.json");
  if (fs.existsSync(mainFile)) {
    const raw = fs.readFileSync(mainFile, "utf8");
    const parsed = JSON.parse(raw) as CasePackCatalog | { cases?: readonly CasePack[] };
    if (Array.isArray(parsed.cases)) {
      return [...parsed.cases];
    }
  }

  // Look for any .json files in the directory
  const files = fs.readdirSync(baseDir).filter((f) => f.endsWith(".json"));
  const allCases: CasePack[] = [];
  for (const f of files) {
    const filePath = path.join(baseDir, f);
    const raw = fs.readFileSync(filePath, "utf8");
    try {
      const parsed = JSON.parse(raw) as CasePack | CasePackCatalog | { cases?: CasePack[] };
      if ("cases" in parsed && Array.isArray(parsed.cases)) {
        allCases.push(...parsed.cases);
      } else if ("id" in parsed && "methodProfile" in parsed) {
        allCases.push(parsed as CasePack);
      }
    } catch {
      // ignore invalid files
    }
  }

  if (allCases.length === 0) {
    throw new Error(`No valid case packs found in ${baseDir}`);
  }

  return allCases;
}

export function loadHumanEvaluationRecords(
  projectRoot: string,
  options?: HumanEvaluationProtocolOptions
): readonly HumanEvaluationRecord[] {
  const customFile = options?.evaluationsFile;
  if (customFile) {
    if (!fs.existsSync(customFile)) {
      return [];
    }
    const raw = fs.readFileSync(customFile, "utf8");
    const parsed = JSON.parse(raw) as { records?: readonly HumanEvaluationRecord[] };
    return parsed.records ? [...parsed.records] : [];
  }

  const baseDir = options?.evaluationsDir ?? path.join(projectRoot, "specs", "qualification", "human-evaluations");
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  const mainFile = path.join(baseDir, "evaluations.json");
  if (fs.existsSync(mainFile)) {
    const raw = fs.readFileSync(mainFile, "utf8");
    const parsed = JSON.parse(raw) as { records?: readonly HumanEvaluationRecord[] };
    if (Array.isArray(parsed.records)) {
      return [...parsed.records];
    }
  }

  const files = fs.readdirSync(baseDir).filter((f) => f.endsWith(".json"));
  const allRecords: HumanEvaluationRecord[] = [];
  for (const f of files) {
    const filePath = path.join(baseDir, f);
    const raw = fs.readFileSync(filePath, "utf8");
    try {
      const parsed = JSON.parse(raw) as HumanEvaluationRecord | { records?: readonly HumanEvaluationRecord[] };
      if ("records" in parsed && Array.isArray(parsed.records)) {
        allRecords.push(...parsed.records);
      } else if ("caseId" in parsed && "evaluatorKind" in parsed) {
        allRecords.push(parsed as HumanEvaluationRecord);
      }
    } catch {
      // ignore
    }
  }

  return allRecords;
}

export function evaluateHumanProtocol(
  projectRoot: string,
  options?: HumanEvaluationProtocolOptions
): HumanEvaluationProtocolReport {
  let casePacks: readonly CasePack[];
  try {
    casePacks = loadCasePacks(projectRoot, options);
  } catch (err) {
    const errorMsg = redactDiagnostic((err as Error).message);
    return {
      status: "failed",
      casesTotal: 0,
      casesEvaluated: 0,
      profilesCovered: [],
      contextsCovered: [],
      evaluatorKindsPresent: [],
      hasQualifiedHumanCoverage: false,
      rows: [],
      scholarlyCertification: "not-inferred",
      reasons: [errorMsg]
    };
  }

  const reasons: string[] = [];
  const profilesPresent = new Set<string>();
  const contextsPresent = new Set<string>();

  for (const cp of casePacks) {
    if (cp.methodProfile) {
      profilesPresent.add(cp.methodProfile);
    }
    if (cp.disciplinaryContext) {
      contextsPresent.add(cp.disciplinaryContext);
    }
    if (!cp.rubric || !cp.rubric.dimensions || cp.rubric.dimensions.length === 0) {
      reasons.push(`Case pack ${cp.id} lacks an explicit rubric or dimensions`);
    }
  }

  // Verify profile coverage
  for (const reqProfile of REQUIRED_METHOD_PROFILES) {
    if (!profilesPresent.has(reqProfile)) {
      reasons.push(`Missing required method profile coverage: ${reqProfile}`);
    }
  }

  // Verify context coverage
  for (const reqContext of REQUIRED_DISCIPLINARY_CONTEXTS) {
    if (!contextsPresent.has(reqContext)) {
      reasons.push(`Missing required disciplinary context coverage: ${reqContext}`);
    }
  }

  const evaluationRecords = loadHumanEvaluationRecords(projectRoot, options);
  const recordMap = new Map<string, HumanEvaluationRecord>();
  for (const r of evaluationRecords) {
    if (r && r.caseId) {
      recordMap.set(r.caseId, r);
    }
  }

  const rows: HumanEvaluationRow[] = [];
  const evaluatorKindsPresent = new Set<EvaluatorKind>();

  for (const cp of casePacks) {
    const rec = recordMap.get(cp.id);
    if (!rec) {
      const reason = redactDiagnostic(`Missing human-evaluation record for required case: ${cp.id}`);
      reasons.push(reason);
      rows.push({
        caseId: cp.id,
        methodProfile: cp.methodProfile,
        disciplinaryContext: cp.disciplinaryContext,
        status: "failed",
        reason
      });
      continue;
    }

    if (rec.evaluatorKind) {
      evaluatorKindsPresent.add(rec.evaluatorKind);
    }

    // Check disagreement case: reject model-only ground truth, require retained positions
    if (cp.isDisagreementCase) {
      if (
        rec.modelGroundTruthOnly === true ||
        rec.oracleKind === "model-only" ||
        rec.oracleKind === "model-written-answer"
      ) {
        const reason = redactDiagnostic(
          `Disagreement case ${cp.id} rejects model-written answer as sole ground truth`
        );
        reasons.push(reason);
        rows.push({
          caseId: cp.id,
          methodProfile: cp.methodProfile,
          disciplinaryContext: cp.disciplinaryContext,
          status: "failed",
          evaluatorKind: rec.evaluatorKind,
          reason
        });
        continue;
      }

      const hasRetainedDissent =
        rec.dissentPreserved === true ||
        (Array.isArray(rec.retainedPositions) && rec.retainedPositions.length >= 2);

      if (!hasRetainedDissent) {
        const reason = redactDiagnostic(
          `Disagreement case ${cp.id} must retain both positions and preserve dissent`
        );
        reasons.push(reason);
        rows.push({
          caseId: cp.id,
          methodProfile: cp.methodProfile,
          disciplinaryContext: cp.disciplinaryContext,
          status: "failed",
          evaluatorKind: rec.evaluatorKind,
          reason
        });
        continue;
      }
    }

    // Check out-of-competence case: must require escalation
    if (cp.outOfCompetence) {
      const isEscalated =
        rec.escalationRequired === true ||
        rec.escalated === true ||
        rec.disposition === "escalated";

      if (!isEscalated) {
        const reason = redactDiagnostic(
          `Out-of-competence case ${cp.id} requires escalation; graded without escalation`
        );
        reasons.push(reason);
        rows.push({
          caseId: cp.id,
          methodProfile: cp.methodProfile,
          disciplinaryContext: cp.disciplinaryContext,
          status: "failed",
          evaluatorKind: rec.evaluatorKind,
          reason
        });
        continue;
      }
    }

    // Valid record
    rows.push({
      caseId: cp.id,
      methodProfile: cp.methodProfile,
      disciplinaryContext: cp.disciplinaryContext,
      status: "pass",
      evaluatorKind: rec.evaluatorKind
    });
  }

  const casesEvaluated = rows.filter((r) => r.status === "pass").length;
  const casesFailing = rows.filter((r) => r.status === "failed").length;
  const passedOverall = reasons.length === 0 && casesFailing === 0 && casesEvaluated === casePacks.length;

  const hasQualifiedHumanCoverage =
    rows.length > 0 &&
    rows.every((r) => r.status === "pass" && r.evaluatorKind === "qualified-human");

  return {
    status: passedOverall ? "pass" : "failed",
    casesTotal: casePacks.length,
    casesEvaluated,
    profilesCovered: Array.from(profilesPresent),
    contextsCovered: Array.from(contextsPresent),
    evaluatorKindsPresent: Array.from(evaluatorKindsPresent),
    hasQualifiedHumanCoverage,
    rows,
    scholarlyCertification: "not-inferred",
    ...(reasons.length > 0 ? { reasons: reasons.map((r) => redactDiagnostic(r)) } : {})
  };
}
