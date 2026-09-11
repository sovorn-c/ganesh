import { strictEqual } from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  authorizeSourceHandoff,
  createOwnerCapability,
  createWorkerCapabilities,
  importLocalSource,
  importStructuredSource,
  inspectArtifactVersion,
  inspectSource,
  listBibliographicRecords,
  proposeSourceMatches,
  recordSourceRelationship,
  type SourceImportRequest
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";

function bibRequest(path: string, commandId: string): SourceImportRequest {
  return { commandId, path, logicalId: commandId, version: "v1", format: "bibtex", mediaType: "application/x-bibtex" };
}

function textRequest(path: string, commandId: string, access?: "full-text" | "metadata-only"): SourceImportRequest {
  return { commandId, path, logicalId: commandId, version: "v1", format: "text", mediaType: "text/plain", ...(access === undefined ? {} : { access }) };
}

test("e06s04 AC-05 doi.v1 and content duplicate proposals keep distinct versions", async () => {
  const fixture = projectFixture();
  const firstPath = join(fixture.root, "first.bib");
  const secondPath = join(fixture.root, "second.bib");
  writeFileSync(firstPath, "@article{a, title={Same}, doi={DOI:10.1234/ABC}}\n");
  writeFileSync(secondPath, "@article{b, title={Other}, doi={https://doi.org/10.1234/abc}}\n");
  try {
    const first = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), bibRequest(firstPath, "match-first"));
    const second = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), bibRequest(secondPath, "match-second"));
    await importStructuredSource(fixture.handle, first.source.artifactVersionId);
    await importStructuredSource(fixture.handle, second.source.artifactVersionId);
    const proposals = proposeSourceMatches(fixture.handle, first.source.artifactVersionId);
    strictEqual(proposals.length, 1);
    strictEqual(proposals[0]?.relation, "exact-duplicate");
    strictEqual(proposals[0]?.basis.algorithm, "doi-v1");
    strictEqual(proposals[0]?.rightVersionId, second.source.artifactVersionId);
    strictEqual(listBibliographicRecords(fixture.handle, first.source.artifactVersionId).length, 1);
    strictEqual(listBibliographicRecords(fixture.handle, second.source.artifactVersionId).length, 1);
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s04 title.author.year.v1 threshold and deterministic ties yield possible matches", async () => {
  const fixture = projectFixture();
  const base = join(fixture.root, "base.bib");
  const candidate = join(fixture.root, "candidate.bib");
  writeFileSync(base, "@article{a, title={A careful study of evidence}, author={Smith, Jane}, year={2024}}\n");
  writeFileSync(candidate, "@article{b, title={A careful study of evidence}, author={Smith, John}, year={2025}}\n");
  try {
    const first = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), bibRequest(base, "fuzzy-first"));
    const second = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), bibRequest(candidate, "fuzzy-second"));
    await importStructuredSource(fixture.handle, first.source.artifactVersionId);
    await importStructuredSource(fixture.handle, second.source.artifactVersionId);
    const proposals = proposeSourceMatches(fixture.handle, first.source.artifactVersionId, 10);
    strictEqual(proposals[0]?.relation, "possible-match");
    strictEqual(proposals[0]?.basis.algorithm, "title-author-year-v1");
    strictEqual(proposals[0]?.basis.yearDistance, 1);
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s04 related and correction relationships are explicit and non-destructive", () => {
  const fixture = projectFixture();
  const firstPath = join(fixture.root, "first.txt");
  const secondPath = join(fixture.root, "second.txt");
  writeFileSync(firstPath, "preprint");
  writeFileSync(secondPath, "correction");
  try {
    const first = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), textRequest(firstPath, "related-first"));
    const second = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), textRequest(secondPath, "related-second"));
    const relationship = recordSourceRelationship(fixture.handle, createOwnerCapability("owner-test"), { leftVersionId: first.source.artifactVersionId, rightVersionId: second.source.artifactVersionId, relation: "related-version", basis: { label: "correction", algorithm: "owner-recorded-v1" }, actor: "owner-test" });
    strictEqual(relationship.relation, "related-version");
    strictEqual(Number((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM source_versions").get() as { count: number }).count), 2);
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s04 AC-10 inspect metadata.only and verified located content without inventing quotations", () => {
  const fixture = projectFixture();
  const fullPath = join(fixture.root, "full.txt");
  const metadataPath = join(fixture.root, "meta.txt");
  writeFileSync(fullPath, "verified source text");
  writeFileSync(metadataPath, "restricted source text");
  try {
    const owner = createOwnerCapability("owner-test");
    const full = importLocalSource(fixture.handle, owner, textRequest(fullPath, "inspect-full"));
    const metadata = importLocalSource(fixture.handle, owner, textRequest(metadataPath, "inspect-meta", "metadata-only"));
    const allowed = inspectSource(fixture.handle, owner, { sourceVersionId: full.source.artifactVersionId, includeContent: true });
    const restricted = inspectSource(fixture.handle, owner, { sourceVersionId: metadata.source.artifactVersionId, includeContent: true });
    strictEqual(allowed.integrity, "verified");
    strictEqual(allowed.content, "verified source text");
    strictEqual(restricted.content, undefined);
    strictEqual(restricted.limitations.includes("access-metadata-only"), true);
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s04 AC-20 viewer handoff checks capability disclosure and integrity with no fallback", () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "viewer.txt");
  writeFileSync(path, "viewer source");
  try {
    const owner = createOwnerCapability("owner-test");
    const imported = importLocalSource(fixture.handle, owner, textRequest(path, "viewer-source"));
    const worker = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["source:handoff", "source:inspect"], allowedPaths: [fixture.root] });
    const allowed = authorizeSourceHandoff(fixture.handle, worker, { sourceVersionId: imported.source.artifactVersionId, operation: "inspection", destination: "local", purpose: "view source", includeContent: true });
    strictEqual(allowed.status, "allow");
    strictEqual(typeof allowed.path, "string");
    const forged = authorizeSourceHandoff(fixture.handle, createOwnerCapability("other-owner"), { sourceVersionId: imported.source.artifactVersionId, operation: "inspection", destination: "local", purpose: "view source" });
    strictEqual(forged.status, "deny");
    strictEqual(forged.path, undefined);
    const remote = authorizeSourceHandoff(fixture.handle, owner, { sourceVersionId: imported.source.artifactVersionId, operation: "analysis", destination: "remote-provider", purpose: "analyze source" });
    strictEqual(remote.status, "deny");
    strictEqual(remote.content, undefined);
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s04 forged wrong.project capability and corrupt source deny safely", () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "corrupt.txt");
  writeFileSync(path, "original");
  try {
    const owner = createOwnerCapability("owner-test");
    const imported = importLocalSource(fixture.handle, owner, textRequest(path, "corrupt-source"));
    const storagePath = inspectArtifactVersion(fixture.handle, imported.source.artifactVersionId).storagePath;
    if (storagePath === null) {throw new Error("test artifact path missing");}
    writeFileSync(storagePath, "tampered");
    const wrongWorker = createWorkerCapabilities({ projectId: "wrong-project", projectRoot: fixture.root, allowedOperations: ["source:inspect"], allowedPaths: [fixture.root] });
    strictEqual(inspectSource(fixture.handle, wrongWorker, { sourceVersionId: imported.source.artifactVersionId, includeContent: true }).status, "denied");
    const corrupt = inspectSource(fixture.handle, owner, { sourceVersionId: imported.source.artifactVersionId, includeContent: true });
    strictEqual(corrupt.integrity, "failed");
    strictEqual(corrupt.content, undefined);
  } finally {
    disposeFixture(fixture);
  }
});
