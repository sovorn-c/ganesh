// story: e09s01
import type { ProjectHandle } from "../project/project-types.js";
import type {
  OrientationRecord,
  OrientationRequest,
  ProblemFramingRecord,
  ProblemFramingRequest,
  ResearchQuestionRecord,
  ResearchQuestionRequest,
  ResearchQuestionQuery,
  FramingInspection,
  MethodologyCandidateRecord,
  MethodologyCandidateRequest
} from "./methodology-types.js";

export function recordOrientation(
  _handle: ProjectHandle,
  _capability: unknown,
  _request: OrientationRequest
): OrientationRecord {
  throw new Error("not implemented");
}

export function inspectOrientation(
  _handle: ProjectHandle,
  _capability: unknown,
  _id: string
): OrientationRecord {
  throw new Error("not implemented");
}

export function recordProblemFraming(
  _handle: ProjectHandle,
  _capability: unknown,
  _request: ProblemFramingRequest
): ProblemFramingRecord {
  throw new Error("not implemented");
}

export function recordResearchQuestionAlternative(
  _handle: ProjectHandle,
  _capability: unknown,
  _request: ResearchQuestionRequest
): ResearchQuestionRecord {
  throw new Error("not implemented");
}

export function listResearchQuestionAlternatives(
  _handle: ProjectHandle,
  _capability: unknown,
  _query?: ResearchQuestionQuery
): readonly ResearchQuestionRecord[] {
  throw new Error("not implemented");
}

export function inspectFraming(
  _handle: ProjectHandle,
  _capability: unknown,
  _orientationId: string
): FramingInspection {
  throw new Error("not implemented");
}

export function ingestMethodologyCandidate(
  _handle: ProjectHandle,
  _capability: unknown,
  _request: MethodologyCandidateRequest
): MethodologyCandidateRecord {
  throw new Error("not implemented");
}

export function methodologySchemaAvailable(_target: ProjectHandle | unknown): boolean {
  return false;
}

export function assertMethodologySchema(_target: ProjectHandle | unknown): void {
  throw new Error("not implemented");
}
