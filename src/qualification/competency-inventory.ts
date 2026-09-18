// story: e17s03
import fs from "node:fs";
import path from "node:path";
import { redactDiagnostic } from "../runtime/preflight.js";
import type {
  CompetencyInventory,
  CompetencyInventoryOptions,
  CompetencyInventoryReport,
  CompetencyInventoryRow,
  CompetencyItem
} from "./qualification-types.js";

export function extractDirectDependencies(dependenciesDocPath: string): Set<string> {
  const result = new Set<string>();
  if (!fs.existsSync(dependenciesDocPath)) {
    return result;
  }
  const content = fs.readFileSync(dependenciesDocPath, "utf8");
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }
    const parts = trimmed.split("|").map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length >= 5) {
      const rawPkg = parts[0].replace(/`/g, "");
      if (rawPkg.toLowerCase() !== "package" && !rawPkg.startsWith("---")) {
        result.add(rawPkg);
      }
    }
  }
  return result;
}

export function loadCompetencyInventory(
  projectRoot: string,
  fileName = "competency-inventory.json"
): CompetencyInventory {
  const inventoryPath = path.join(projectRoot, "specs", "qualification", fileName);
  if (!fs.existsSync(inventoryPath)) {
    throw new Error(`Competency inventory file not found: ${inventoryPath}`);
  }

  let parsed: unknown;
  try {
    const raw = fs.readFileSync(inventoryPath, "utf8");
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse competency inventory at ${inventoryPath}: ${(err as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Competency inventory must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  if (
    record.certified !== undefined ||
    record.scholarlyCertified !== undefined ||
    record.statisticallyValidated !== undefined
  ) {
    throw new Error("Competency inventory cannot claim certified or statistically validated status");
  }

  if (!Array.isArray(record.competencies)) {
    throw new Error("Competency inventory competencies must be an array");
  }

  return parsed as CompetencyInventory;
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function hasWorkedExample(val: unknown): boolean {
  if (isNonEmptyString(val)) {
    return true;
  }
  if (typeof val === "object" && val !== null) {
    const rec = val as Record<string, unknown>;
    return (
      isNonEmptyString(rec.summary) &&
      (isNonEmptyString(rec.outcome) || isNonEmptyString(rec.context))
    );
  }
  return false;
}

export function validateCompetencyInventory(
  projectRoot: string,
  options?: CompetencyInventoryOptions
): CompetencyInventoryReport {
  let inventory: CompetencyInventory;
  try {
    inventory = loadCompetencyInventory(projectRoot, options?.inventoryFile);
  } catch (err) {
    const errorMsg = redactDiagnostic((err as Error).message);
    return {
      status: "failed",
      competenciesTotal: 0,
      competenciesPassing: 0,
      competenciesFailing: 0,
      rows: [],
      scholarlyCertification: "not-inferred",
      reasons: [errorMsg]
    };
  }

  const reasons: string[] = [];
  const recInventory = (inventory as unknown) as Record<string, unknown>;
  if (
    recInventory.certified !== undefined ||
    recInventory.scholarlyCertified !== undefined ||
    recInventory.statisticallyValidated !== undefined
  ) {
    reasons.push("Competency inventory claims scholarly certification or statistical validation");
  }

  const depDocPath = options?.dependenciesDocPath ?? path.join(projectRoot, "docs", "dependencies.md");
  const knownDirectDeps = extractDirectDependencies(depDocPath);

  const rows: CompetencyInventoryRow[] = [];
  const items = inventory.competencies ?? [];

  if (items.length === 0) {
    reasons.push("Competency inventory contains 0 competencies");
  }

  for (const rawItem of items) {
    const item = rawItem as CompetencyItem & Record<string, unknown>;
    const itemId = isNonEmptyString(item.id) ? item.id : "unknown-id";
    const itemName = isNonEmptyString(item.name) ? item.name : "Unnamed competency";

    const itemFailures: string[] = [];

    // Reject certification claims on item
    if (
      item.certified !== undefined ||
      item.scholarlyCertified !== undefined ||
      item.statisticallyValidated !== undefined
    ) {
      itemFailures.push(`Competency ${itemId} claims scholarly-certified or statistically-validated status`);
    }

    if (!isNonEmptyString(item.id)) {
      itemFailures.push("Missing required field: id");
    }
    if (!isNonEmptyString(item.name)) {
      itemFailures.push("Missing required field: name");
    }
    if (!isNonEmptyString(item.version)) {
      itemFailures.push("Missing required field: version");
    }
    if (!isNonEmptyString(item.purpose)) {
      itemFailures.push("Missing required field: purpose");
    }
    if (!isNonEmptyString(item.owningRole)) {
      itemFailures.push("Missing required field: owningRole");
    }
    if (!Array.isArray(item.applicableProfiles) || item.applicableProfiles.length === 0) {
      itemFailures.push("Missing or empty required field: applicableProfiles");
    }
    if (
      (!Array.isArray(item.unsupportedContexts) || item.unsupportedContexts.length === 0) &&
      !isNonEmptyString(item.unsupportedContexts)
    ) {
      itemFailures.push("Missing or empty required field: unsupportedContexts");
    }
    if (!Array.isArray(item.requiredInputs) || item.requiredInputs.length === 0) {
      itemFailures.push("Missing or empty required field: requiredInputs");
    }
    if (
      (!Array.isArray(item.failureConditions) || item.failureConditions.length === 0) &&
      !isNonEmptyString(item.failureConditions)
    ) {
      itemFailures.push("Missing or empty required field: failureConditions");
    }

    // Source & License
    if (!isNonEmptyString(item.source)) {
      itemFailures.push("Missing required field: source");
    }
    if (!isNonEmptyString(item.license)) {
      itemFailures.push("Missing required field: license");
    }

    // Worked examples (Success & Failure)
    if (!hasWorkedExample(item.workedSuccess)) {
      itemFailures.push("Missing required field: workedSuccess example");
    }
    if (!hasWorkedExample(item.workedFailure)) {
      itemFailures.push("Missing required field: workedFailure example");
    }

    // Output schema & provenance
    if (typeof item.outputSchema !== "object" || item.outputSchema === null) {
      itemFailures.push("Missing required field: outputSchema");
    } else {
      if (item.outputSchema.separatesObservationsFromInferences !== true) {
        itemFailures.push("Output schema must separate observations from inferences");
      }
      if (item.outputSchema.includesContraryOrLimitations !== true) {
        itemFailures.push("Output schema must include contrary or limitation fields");
      }
    }

    if (item.outputProvenance) {
      if (item.outputProvenance.separatesObservationInferenceRecommendation === false) {
        itemFailures.push("Output provenance must separate observation, inference, and recommendation");
      }
      if (item.outputProvenance.includesContraryEvidence === false) {
        itemFailures.push("Output provenance must include contrary evidence");
      }
    }

    // Direct dependency license cross-check
    if (Array.isArray(item.directDependencies) && fs.existsSync(depDocPath)) {
      for (const dep of item.directDependencies) {
        if (!knownDirectDeps.has(dep)) {
          itemFailures.push(`Direct package dependency '${dep}' is not documented in docs/dependencies.md`);
        }
      }
    }

    if (itemFailures.length === 0) {
      rows.push({
        id: itemId,
        name: itemName,
        status: "pass"
      });
    } else {
      const combinedReason = itemFailures.join("; ");
      reasons.push(`${itemId}: ${combinedReason}`);
      rows.push({
        id: itemId,
        name: itemName,
        status: "failed",
        reason: redactDiagnostic(combinedReason)
      });
    }
  }

  const competenciesPassing = rows.filter((r) => r.status === "pass").length;
  const competenciesFailing = rows.filter((r) => r.status === "failed").length;
  const passedOverall = reasons.length === 0 && competenciesFailing === 0 && competenciesPassing > 0;

  return {
    status: passedOverall ? "pass" : "failed",
    competenciesTotal: rows.length,
    competenciesPassing,
    competenciesFailing,
    rows,
    scholarlyCertification: "not-inferred",
    ...(reasons.length > 0 ? { reasons: reasons.map((r) => redactDiagnostic(r)) } : {})
  };
}
