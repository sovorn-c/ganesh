// story: e18s04
import fs from "node:fs";
import path from "node:path";
import { listRunbooks } from "../operations/runbooks.js";
import type {
  GuideInventory,
  GuideInventoryOptions,
  GuideInventoryReport
} from "./types.js";

export const REQUIRED_GUIDE_IDS = [
  "user",
  "developer",
  "accessibility",
  "privacy",
  "local-execution",
  "examples",
  "limitations",
  "release-notes",
  "support"
] as const;

export const EXPECTED_RUNBOOK_IDS = [
  "credential-rotation",
  "disk-exhaustion",
  "incident-response",
  "performance-budgets",
  "provider-outage",
  "recovery",
  "vulnerability-reporting"
] as const;

export function loadGuideInventory(
  root: string = process.cwd(),
  inventoryPath?: string
): GuideInventory {
  const projectRoot = path.resolve(root);
  const targetPath = inventoryPath
    ? path.resolve(inventoryPath)
    : path.join(projectRoot, "specs", "distribution", "guide-inventory.json");

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Guide inventory file not found at ${targetPath}`);
  }

  const raw = fs.readFileSync(targetPath, "utf8");
  return JSON.parse(raw) as GuideInventory;
}

export function validateGuideInventory(
  root: string = process.cwd(),
  options?: GuideInventoryOptions
): GuideInventoryReport {
  const projectRoot = path.resolve(root);
  const reasons: string[] = [];
  const missingGuides: string[] = [];

  let inventory: GuideInventory;
  try {
    inventory = loadGuideInventory(projectRoot, options?.inventoryPath);
  } catch (error) {
    return {
      status: "fail",
      guidesChecked: 0,
      missingGuides: [...REQUIRED_GUIDE_IDS],
      runbookIds: [],
      limitationsValid: false,
      secretsOmitted: false,
      reasons: [(error as Error).message]
    };
  }

  const guideMap = new Map<string, { id: string; path: string; title: string }>();
  for (const guide of inventory.guides) {
    guideMap.set(guide.id, guide);
  }

  // Normalized packed file set if provided
  const packedSet = options?.packedFiles
    ? new Set(options.packedFiles.map((p) => p.replace(/^\.\//, "").replace(/\\/g, "/")))
    : undefined;

  let limitationsValid = true;
  let secretsOmitted = true;
  let guidesChecked = 0;

  for (const requiredId of REQUIRED_GUIDE_IDS) {
    guidesChecked++;
    const item = guideMap.get(requiredId);
    if (!item) {
      missingGuides.push(requiredId);
      reasons.push(`Required guide id '${requiredId}' is missing from inventory`);
      continue;
    }

    const normalizedPath = item.path.replace(/^\.\//, "").replace(/\\/g, "/");

    // Check packed completeness if packedFiles was supplied
    if (packedSet) {
      if (!packedSet.has(normalizedPath) && !packedSet.has(`package/${normalizedPath}`)) {
        missingGuides.push(requiredId);
        reasons.push(`Required guide '${requiredId}' (${item.path}) is missing from packed file list`);
        continue;
      }
    }

    const diskPath = path.join(projectRoot, item.path);
    if (!fs.existsSync(diskPath)) {
      missingGuides.push(requiredId);
      reasons.push(`Guide file for '${requiredId}' does not exist on disk at ${item.path}`);
      continue;
    }

    const content = fs.readFileSync(diskPath, "utf8");
    if (content.trim().length === 0) {
      missingGuides.push(requiredId);
      reasons.push(`Guide file for '${requiredId}' is empty`);
      continue;
    }

    // Check limitations content
    if (requiredId === "limitations") {
      const lower = content.toLowerCase();
      const mentionsQualifyNotProductionReady = lower.includes("qualify pass is not production-ready") ||
        (lower.includes("qualify") && lower.includes("not production-ready"));
      const mentionsFullAccessNotSandbox = lower.includes("full-access is not a sandbox") ||
        (lower.includes("full-access") && lower.includes("not a sandbox"));

      if (!mentionsQualifyNotProductionReady) {
        limitationsValid = false;
        reasons.push("Limitations guide must state that a qualify pass is not production-ready");
      }
      if (!mentionsFullAccessNotSandbox) {
        limitationsValid = false;
        reasons.push("Limitations guide must state that full-access is not a sandbox");
      }
    }

    // Scan for secrets and participant PII
    if (/token\s*=/i.test(content) || /bearer\s+[a-zA-Z0-9_\-.]{16,}/i.test(content)) {
      secretsOmitted = false;
      reasons.push(`Guide '${requiredId}' contains credential token shape`);
    }
    if (/participant@example\.test/i.test(content) || /participant-[0-9a-f]{8}/i.test(content)) {
      secretsOmitted = false;
      reasons.push(`Guide '${requiredId}' contains participant PII identifier`);
    }
  }

  // Check runbooks
  const runbooksDir = path.join(projectRoot, "docs", "runbooks");
  const runbooks = listRunbooks({ runbooksDir });
  const runbookIds = runbooks.map((r) => r.id);

  for (const expectedRunbookId of EXPECTED_RUNBOOK_IDS) {
    if (!runbookIds.includes(expectedRunbookId)) {
      reasons.push(`Expected E16 runbook '${expectedRunbookId}' is missing from docs/runbooks/`);
    }
  }

  const passed = missingGuides.length === 0 &&
    limitationsValid &&
    secretsOmitted &&
    reasons.length === 0;

  return {
    status: passed ? "pass" : "fail",
    guidesChecked,
    missingGuides,
    runbookIds,
    limitationsValid,
    secretsOmitted,
    reasons: passed ? undefined : reasons
  };
}
