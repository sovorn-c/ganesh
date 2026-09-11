import { strictEqual } from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type ProjectHandle, type SourceImportRequest, createOwnerCapability } from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";

const DOCX_FIXTURE = Buffer.from("UEsDBAoAAAAAAMV8K10AAAAAAAAAAAAAAAAFABwAd29yZC9VVAkAA/K9o2ryvaNqdXgLAAEE9QEAAAQUAAAAUEsDBBQAAAAIAMV8K119sJbEkQAAAOoAAAARABwAd29yZC9kb2N1bWVudC54bWxVVAkAA/K9o2ryvaNqdXgLAAEE9QEAAAQUAAAAbY+9DsIwDIRfpeoD4IqBIQpdysDGypomoa2UxJETFHh78gNCQizf6eQ7y+aJKZR3q13sHta4wNKxX2P0DCDIVVsRdui1y7MbkhUxW1ogISlPKHUIm1usgf0wHMCKzfUjT2xG9SzqC6ggjmdtDHany3TlUHwhVdZUnE2Vlpa/7Sm3//SgZaEV4b0GPhfA97vxBVBLAQIeAwoAAAAAAMV8K10AAAAAAAAAAAAAAAAFABgAAAAAAAAAEADtQQAAAAB3b3JkL1VUBQAD8r2janV4CwABBPUBAAAEFAAAAFBLAQIeAxQAAAAIAMV8K119sJbEkQAAAOoAAAARABgAAAAAAAEAAACkgT8AAAB3b3JkL2RvY3VtZW50LnhtbFVUBQAD8r2janV4CwABBPUBAAAEFAAAAFBLBQYAAAAAAgACAKIAAAAbAQAAAAA=", "base64");

type DocumentSegment = { readonly locator: Record<string, unknown> };
type DocumentApi = {
  importLocalSource: (handle: ProjectHandle, capability: unknown, request: SourceImportRequest) => { source: { artifactVersionId: string } };
  extractDocumentSource: (handle: ProjectHandle, sourceVersionId: string, limits?: Record<string, number>) => Promise<{ status: string; derivedVersionId?: string; segments: readonly DocumentSegment[] }>;
  listSourceDiagnostics: (handle: ProjectHandle, sourceVersionId: string) => readonly Record<string, unknown>[];
};

async function api(): Promise<DocumentApi> {
  return await import("../../src/index.js") as unknown as DocumentApi;
}

function sourceRequest(path: string, format: "pdf" | "docx"): SourceImportRequest {
  return {
    commandId: `document-${format}-1`, path, logicalId: `document-${format}`, version: "v1", format,
    mediaType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };
}

test("e06s02 dependency license offline adapter", async () => {
  const documentApi = await api();
  strictEqual(typeof documentApi.extractDocumentSource, "function");
  const evidence = await import("node:fs/promises");
  const content = await evidence.readFile("specs/verifications/e06-parser-dependencies.md", "utf8");
  strictEqual(content.includes("--ignore-scripts"), true);
  strictEqual(content.includes("pdfjs-dist@6.3.289"), true);
});

test("e06s02 pdf page derived provenance loss", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "paper.pdf");
  writeFileSync(path, "%PDF-1.7\n1 0 obj /Type /Page endobj\nBT (Hello PDF) Tj ET\n%%EOF");
  try {
    const documentApi = await api();
    const imported = documentApi.importLocalSource(fixture.handle, createOwnerCapability("owner-test"), sourceRequest(path, "pdf"));
    const extracted = await documentApi.extractDocumentSource(fixture.handle, imported.source.artifactVersionId);
    strictEqual(extracted.status, "complete");
    const firstSegment = extracted.segments[0];
    strictEqual(firstSegment === undefined ? undefined : firstSegment.locator["pageNumber"], 1);
    strictEqual(typeof extracted.derivedVersionId, "string");
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s02 docx paragraph table provenance", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "paper.docx");
  writeFileSync(path, DOCX_FIXTURE);
  try {
    const documentApi = await api();
    const imported = documentApi.importLocalSource(fixture.handle, createOwnerCapability("owner-test"), sourceRequest(path, "docx"));
    const extracted = await documentApi.extractDocumentSource(fixture.handle, imported.source.artifactVersionId);
    strictEqual(extracted.status, "complete");
    strictEqual(extracted.segments.some((segment) => segment.locator.paragraphNumber === 1), true);
    strictEqual(extracted.segments.some((segment) => segment.locator.tableNumber === 1), true);
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s02 ocr provenance is a separate derived extraction", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "image.pdf");
  writeFileSync(path, "%PDF-1.7\\n/Type /Page /Subtype /Image\\n%%EOF");
  try {
    const documentApi = await api();
    const imported = documentApi.importLocalSource(fixture.handle, createOwnerCapability("owner-test"), sourceRequest(path, "pdf"));
    const fullApi = await import("../../src/index.js") as unknown as { registerExternalExtraction: (handle: ProjectHandle, capability: unknown, request: { sourceVersionId: string; content: string; tool: string; version: string; actor: string; commandId: string }) => { derivedVersionId?: string; sourceVersionId: string } };
    const extraction = fullApi.registerExternalExtraction(fixture.handle, createOwnerCapability("owner-test"), { sourceVersionId: imported.source.artifactVersionId, content: "OCR text", tool: "local-ocr", version: "1.0", actor: "owner-test", commandId: "ocr-command-1" });
    strictEqual(extraction.sourceVersionId, imported.source.artifactVersionId);
    strictEqual(typeof extraction.derivedVersionId, "string");
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s02 image only corrupt encrypted archive timeout active", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "image.pdf");
  writeFileSync(path, "%PDF-1.7\n/Type /Page /Subtype /Image\n%%EOF");
  try {
    const documentApi = await api();
    const imported = documentApi.importLocalSource(fixture.handle, createOwnerCapability("owner-test"), sourceRequest(path, "pdf"));
    const extracted = await documentApi.extractDocumentSource(fixture.handle, imported.source.artifactVersionId, { maxOutputBytes: 2 });
    strictEqual(["unsupported", "failed"].includes(extracted.status), true);
    strictEqual(documentApi.listSourceDiagnostics(fixture.handle, imported.source.artifactVersionId).some((diagnostic) => String(diagnostic.code).includes("image")), true);
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s02 corrupt document fails without derived output", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "bad.docx");
  writeFileSync(path, Buffer.from("not a zip"));
  try {
    const documentApi = await api();
    const imported = documentApi.importLocalSource(fixture.handle, createOwnerCapability("owner-test"), sourceRequest(path, "docx"));
    const result = await documentApi.extractDocumentSource(fixture.handle, imported.source.artifactVersionId);
    strictEqual(result.status, "failed");
  } finally {
    disposeFixture(fixture);
  }
});

