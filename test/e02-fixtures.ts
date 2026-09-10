import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createProject,
  registerArtifactVersion,
  type ArtifactVersionRecord,
  type ProjectHandle,
  type DependencyInput
} from "../src/index.js";

export interface ProjectFixture {
  readonly root: string;
  readonly handle: ProjectHandle;
}

export function projectFixture(): ProjectFixture {
  const root = mkdtempSync(join(tmpdir(), "ganesh-e02-"));
  return { root, handle: createProject({ rootPath: root, ownerId: "owner-test" }) };
}

export function artifact(
  handle: ProjectHandle,
  logicalId: string,
  version: string,
  content: string,
  dependencies: readonly DependencyInput[] = []
): ArtifactVersionRecord {
  return registerArtifactVersion(handle, {
    logicalId,
    version,
    versionId: `${logicalId}-${version}`,
    content,
    dependencies
  });
}

export function disposeFixture(fixture: ProjectFixture): void {
  fixture.handle.close();
  rmSync(fixture.root, { recursive: true, force: true });
}
