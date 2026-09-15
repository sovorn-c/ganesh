import { type ProjectHandle } from "../project/project-types.js";
import {
  ActivityAuthorizationAssessment,
  ActivityAuthorizationContext,
  ResearchActivity,
  RESEARCH_ACTIVITIES
} from "./ethics-types.js";
import { assertEthicsSchema } from "./ethics-utils.js";
import { mapAuthRow } from "./authorization-store.js";

type AssessmentRequest = ActivityAuthorizationContext & {
  readonly requireExplicitScope?: boolean;
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim() !== "") ? [...value] : undefined;
}

function scopeObject(value: Record<string, unknown> | string): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function scopeValue(scope: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(scope, key)) {
      return scope[key];
    }
  }
  return undefined;
}

function matchesStringScope(authorized: unknown, requested: string): boolean {
  if (typeof authorized === "string") {
    return normalize(authorized) === normalize(requested);
  }
  return stringArray(authorized)?.some((value) => normalize(value) === normalize(requested)) ?? false;
}

function populationCovered(scope: Record<string, unknown> | string, requested: string): boolean {
  if (typeof scope === "string") {
    return normalize(scope) === normalize(requested);
  }
  const population = scopeValue(scope, "population", "populations");
  return matchesStringScope(population, requested);
}

function dataClassesFor(scope: Record<string, unknown> | string): readonly string[] | undefined {
  const object = scopeObject(scope);
  if (!object || !Object.prototype.hasOwnProperty.call(object, "dataClasses")) {
    return undefined;
  }
  return stringArray(object.dataClasses);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).sort().join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function conditionsCovered(authorized: unknown, requested: unknown): boolean {
  if (Array.isArray(authorized)) {
    if (Array.isArray(requested)) {
      return canonical(authorized) === canonical(requested);
    }
    return authorized.length === 1 && canonical(authorized[0]) === canonical(requested);
  }
  if (Array.isArray(requested) && typeof authorized === "string") {
    return requested.length === 1 && typeof requested[0] === "string" && normalize(requested[0]) === normalize(authorized);
  }
  return canonical(authorized) === canonical(requested);
}

function scopeMismatch(scope: Record<string, unknown> | string, request: AssessmentRequest): string | undefined {
  const object = scopeObject(scope);
  // Named activity authorization is always fail-closed. The optional flag is
  // retained for API compatibility but cannot weaken a persisted grant.
  const requireExplicit = true;

  if (typeof scope === "string") {
    if (request.population === undefined && request.dataUse === undefined) {
      return "authorization scope context is required for the current population or data use";
    }
    if (request.population !== undefined && request.dataUse !== undefined) {
      return "string authorization scope cannot validate both population and data use";
    }
    if (request.population !== undefined && !populationCovered(scope, request.population)) {
      return `current population "${request.population}" is outside authorized grant population "${scope}"`;
    }
    if (request.dataUse !== undefined && !matchesStringScope(scope, request.dataUse)) {
      return `current data use "${request.dataUse}" is outside authorized grant data use "${scope}"`;
    }
    if (request.dataClasses !== undefined || request.destination !== undefined || request.purpose !== undefined || request.conditions !== undefined) {
      return "string authorization scope does not document the supplied execution context";
    }
    return undefined;
  }
  if (object === undefined) {
    return "authorization scope is not a valid object or label";
  }

  const authorizedPopulation = scopeValue(object, "population", "populations");
  const authorizedDataUse = scopeValue(object, "dataUse", "data-use");
  if (authorizedPopulation === undefined && authorizedDataUse === undefined) {
    return "authorization scope does not document a population or data use";
  }
  if (authorizedPopulation !== undefined) {
    if (typeof authorizedPopulation !== "string" && stringArray(authorizedPopulation) === undefined) {
      return "authorization scope population is malformed";
    }
    if (request.population !== undefined && !populationCovered(scope, request.population)) {
      return `current population "${request.population}" is outside authorized grant population "${JSON.stringify(authorizedPopulation)}"`;
    }
    if (requireExplicit && request.population === undefined) {
      return "authorization scope requires an explicit population";
    }
  }

  const hasDataClasses = Object.prototype.hasOwnProperty.call(object, "dataClasses");
  const authorizedDataClasses = dataClassesFor(scope);
  if (hasDataClasses && authorizedDataClasses === undefined) {
    return "authorization scope data classes are malformed";
  }
  if (authorizedDataClasses !== undefined) {
    if (authorizedDataClasses.length === 0 && request.dataClasses !== undefined && request.dataClasses.length > 0) {
      return "current data classes are outside authorized grant data use";
    }
    if (request.dataClasses !== undefined) {
      const outside = request.dataClasses.filter((dataClass) => !authorizedDataClasses.some((authorized) => normalize(authorized) === normalize(dataClass)));
      if (outside.length > 0) {
        return `current data classes [${outside.join(", ")}] are outside authorized grant data use`;
      }
    }
    if (requireExplicit && request.dataClasses === undefined) {
      return "authorization scope requires explicit data classes";
    }
  }

  if (authorizedDataUse !== undefined) {
    if (typeof authorizedDataUse !== "string" && stringArray(authorizedDataUse) === undefined) {
      return "authorization scope data use is malformed";
    }
    if (request.dataUse !== undefined && !matchesStringScope(authorizedDataUse, request.dataUse)) {
      return `current data use "${request.dataUse}" is outside authorized grant data use "${JSON.stringify(authorizedDataUse)}"`;
    }
    if (requireExplicit && request.dataUse === undefined) {
      return "authorization scope requires an explicit data use";
    }
  }

  for (const [label, requested, keys] of [
    ["destination", request.destination, ["destination", "destinations"]],
    ["purpose", request.purpose, ["purpose", "purposes"]]
  ] as const) {
    const authorized = scopeValue(object, ...keys);
    if (authorized === undefined) {
      continue;
    }
    if (requested === undefined) {
      return `authorization scope requires an explicit ${label}`;
    }
    if (!matchesStringScope(authorized, requested)) {
      return `current ${label} "${requested}" is outside authorized grant ${label} "${JSON.stringify(authorized)}"`;
    }
  }

  const authorizedConditions = scopeValue(object, "conditions");
  if (authorizedConditions !== undefined) {
    if (authorizedConditions === null) {
      return "authorization scope conditions are malformed";
    }
    if (request.conditions === undefined) {
      if (requireExplicit) {
        return "authorization scope requires explicit conditions";
      }
    } else if (!conditionsCovered(authorizedConditions, request.conditions)) {
      return `current conditions are outside authorized grant conditions "${JSON.stringify(authorizedConditions)}"`;
    }
  }

  if (authorizedPopulation === undefined && request.population !== undefined) {
    return "current population is not documented by the authorization scope";
  }
  if (authorizedDataClasses === undefined && request.dataClasses !== undefined) {
    return "current data classes are not documented by the authorization scope";
  }
  if (authorizedDataUse === undefined && request.dataUse !== undefined) {
    return "current data use is not documented by the authorization scope";
  }
  if (scopeValue(object, "destination", "destinations") === undefined && request.destination !== undefined) {
    return "current destination is not documented by the authorization scope";
  }
  if (scopeValue(object, "purpose", "purposes") === undefined && request.purpose !== undefined) {
    return "current purpose is not documented by the authorization scope";
  }
  if (authorizedConditions === undefined && request.conditions !== undefined) {
    return "current conditions are not documented by the authorization scope";
  }
  return undefined;
}

function denied(
  request: AssessmentRequest,
  status: ActivityAuthorizationAssessment["status"],
  reason: string,
  authorizationId?: string,
  applicabilityBasis?: string
): ActivityAuthorizationAssessment {
  return { activity: request.activity, status, authorizationId, applicabilityBasis, reason, permitted: false };
}

export function assessActivityAuthorization(
  handle: ProjectHandle,
  request: AssessmentRequest
): ActivityAuthorizationAssessment {
  assertEthicsSchema(handle);

  if (typeof request.activity !== "string" || !RESEARCH_ACTIVITIES.includes(request.activity as ResearchActivity)) {
    return denied(request, "unauthorized", "research activity is invalid");
  }
  for (const [label, value] of [["population", request.population], ["dataUse", request.dataUse], ["destination", request.destination], ["purpose", request.purpose]] as const) {
    if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
      return denied(request, "needs-review", `${label} authorization context is malformed`);
    }
  }
  if (request.dataClasses !== undefined && stringArray(request.dataClasses) === undefined) {
    return denied(request, "needs-review", "dataClasses authorization context is malformed");
  }
  if (request.conditions === null) {
    return denied(request, "needs-review", "conditions authorization context is malformed");
  }

  const rows = handle.db
    .prepare("SELECT * FROM external_authorizations ORDER BY created_at DESC, rowid DESC")
    .all() as Array<Record<string, unknown>>;

  let matchingRows: ReturnType<typeof mapAuthRow>[];
  try {
    matchingRows = rows
      .map(mapAuthRow)
      .filter((record) => record.activities.includes(request.activity));
  } catch {
    return denied(request, "unauthorized", "external authorization registry contains an invalid status or provenance value");
  }

  if (matchingRows.length === 0) {
    return denied(request, "unauthorized", `No external authorization record found for activity ${request.activity}`);
  }

  const latest = matchingRows[0];
  const details = { authorizationId: latest.id, applicabilityBasis: latest.applicabilityBasis };

  if ((latest.status === "documented-approved" || latest.status === "not-required") && latest.applicabilityBasis.trim() === "") {
    return denied(request, "unauthorized", `External authorization ${latest.id} requires a non-empty applicability basis`, details.authorizationId);
  }

  if (latest.status === "withdrawn") {
    return denied(request, "withdrawn", `External authorization ${latest.id} for activity ${request.activity} was withdrawn: ${latest.withdrawalReason ?? "withdrawn by owner"}`, details.authorizationId, details.applicabilityBasis);
  }
  if (latest.expiresAt && Number.isNaN(Date.parse(latest.expiresAt))) {
    return denied(request, "unauthorized", `External authorization ${latest.id} has an invalid expiry timestamp`, details.authorizationId, details.applicabilityBasis);
  }
  if (latest.status === "expired" || (latest.expiresAt && new Date(latest.expiresAt).getTime() <= Date.now())) {
    return denied(request, "expired", `External authorization ${latest.id} for activity ${request.activity} has expired`, details.authorizationId, details.applicabilityBasis);
  }
  if (latest.status === "pending" || latest.status === "unknown") {
    return denied(request, latest.status, `External authorization ${latest.id} for activity ${request.activity} is ${latest.status}`, details.authorizationId, details.applicabilityBasis);
  }
  if (latest.status === "not-required") {
    if (!latest.applicabilityBasis.trim()) {
      return denied(request, "unauthorized", "not-required status requires non-empty applicabilityBasis in registry", details.authorizationId);
    }
    const mismatch = scopeMismatch(latest.populationOrDataUse, request);
    if (mismatch !== undefined) {
      return denied(request, "needs-review", `Material change: ${mismatch}`, details.authorizationId, details.applicabilityBasis);
    }
    return { activity: request.activity, status: "not-required", ...details, reason: `External authorization not required: ${latest.applicabilityBasis}`, permitted: true };
  }
  if (latest.status !== "documented-approved") {
    return denied(request, "unauthorized", `External authorization ${latest.id} has unsupported status`, details.authorizationId, details.applicabilityBasis);
  }

  const mismatch = scopeMismatch(latest.populationOrDataUse, request);
  if (mismatch !== undefined) {
    return denied(request, "needs-review", `Material change: ${mismatch}`, details.authorizationId, details.applicabilityBasis);
  }

  return { activity: request.activity, status: "documented-approved", ...details, reason: "External authorization is documented and approved", permitted: true };
}
