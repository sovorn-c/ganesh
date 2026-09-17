// story: e13s04
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { bytesFor, isoNow, newId, sha256 } from "../persistence/storage-utils.js";
import { requestDisclosure } from "../policy/disclosure-gateway.js";
import { listBibliographicRecords } from "../sources/structured-parser.js";
import {
  assertWritingSchema,
  assertOwner,
  assertWritingRecordAccess,
  findWritingOperation,
  recordWritingOperation
} from "./writing-utils.js";
import type {
  DraftTable,
  DraftTableRequest,
  ExportBibliographyRequest,
  ExportReviewPacketRequest,
  ExportWritingRequest,
  ReviewPacketExport,
  WritingExport
} from "./writing-types.js";

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipFileEntry {
  readonly path: string;
  readonly data: Buffer;
}

function buildZipArchive(entries: readonly ZipFileEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, "utf-8");
    const compressed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30 + nameBuf.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    compressed.copy(local, 30 + nameBuf.length);
    localHeaders.push(local);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralDir = Buffer.concat(centralHeaders);
  const centralDirOffset = offset;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(centralDirOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, centralDir, end]);
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildDocx(paragraphs: readonly string[]): Buffer {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const pNodes = paragraphs
    .map((p) => `<w:p><w:r><w:t>${escapeXml(p)}</w:t></w:r></w:p>`)
    .join("\n    ");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${pNodes}
  </w:body>
</w:document>`;

  return buildZipArchive([
    { path: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf-8") },
    { path: "_rels/.rels", data: Buffer.from(relsXml, "utf-8") },
    { path: "word/document.xml", data: Buffer.from(documentXml, "utf-8") }
  ]);
}

function escapeCsvValue(val: string): string {
  let sanitized = val;
  if (/^\s*[=+\-@\t\r]/u.test(sanitized)) {
    sanitized = `'${sanitized}`;
  }
  if (sanitized.includes(",") || sanitized.includes('"') || sanitized.includes("\n") || sanitized.includes("\r")) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

function mapTableRow(row: Record<string, unknown>): DraftTable {
  return {
    id: String(row.id),
    draftId: String(row.draft_id),
    title: String(row.title),
    headers: JSON.parse(String(row.headers)) as string[],
    rows: JSON.parse(String(row.rows)) as string[][],
    notes: row.notes ? String(row.notes) : undefined,
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  };
}

function mapExportRow(row: Record<string, unknown>): WritingExport {
  return {
    id: String(row.id),
    draftId: String(row.draft_id),
    format: String(row.format),
    destinationPath: String(row.destination_path),
    artifactVersionId: row.artifact_version_id ? String(row.artifact_version_id) : undefined,
    formatLimits: JSON.parse(String(row.format_limits ?? "[]")) as string[],
    provenanceLimits: JSON.parse(String(row.provenance_limits ?? "[]")) as string[],
    omissions: JSON.parse(String(row.omissions ?? "[]")) as string[],
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  };
}

function mapPacketExportRow(row: Record<string, unknown>): ReviewPacketExport {
  return {
    id: String(row.id),
    draftId: String(row.draft_id),
    cycleId: row.cycle_id ? String(row.cycle_id) : undefined,
    packetPath: String(row.packet_path),
    artifactVersionId: row.artifact_version_id ? String(row.artifact_version_id) : undefined,
    manifest: JSON.parse(String(row.manifest)) as Record<string, unknown>,
    omissions: JSON.parse(String(row.omissions ?? "[]")) as string[],
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  };
}

export function recordDraftTable(
  handle: ProjectHandle,
  capability: unknown,
  request: DraftTableRequest
): DraftTable {
  assertWritingSchema(handle);
  assertWritable(handle);
  assertWritingRecordAccess(handle, capability);

  const draftRow = handle.db.prepare("SELECT id FROM drafts WHERE id = ?").get(request.draftId);
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft not found: ${request.draftId}`);
  }

  const payloadHash = sha256(bytesFor(JSON.stringify(request)));
  const existingOp = findWritingOperation(handle.db, request.commandId, "record-draft-table");
  if (existingOp && existingOp.entityId) {
    const existingRow = handle.db.prepare("SELECT * FROM draft_tables WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (existingRow) {
      return mapTableRow(existingRow);
    }
  }

  const id = newId("table");
  const now = isoNow();

  handle.db.prepare(`
    INSERT INTO draft_tables (id, draft_id, title, headers, rows, notes, command_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    request.draftId,
    request.title,
    JSON.stringify(request.headers),
    JSON.stringify(request.rows),
    request.notes ?? null,
    request.commandId,
    now
  );

  recordWritingOperation(handle.db, request.commandId, "record-draft-table", payloadHash, id, null);

  const row = handle.db.prepare("SELECT * FROM draft_tables WHERE id = ?").get(id) as Record<string, unknown>;
  return mapTableRow(row);
}

export function exportDraftMarkdown(
  handle: ProjectHandle,
  capability: unknown,
  request: ExportWritingRequest
): WritingExport {
  assertWritingSchema(handle);
  assertWritable(handle);
  assertOwner(handle, capability, "exportDraftMarkdown");

  const draftRow = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(request.draftId) as Record<string, unknown> | undefined;
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft not found: ${request.draftId}`);
  }

  const payloadHash = sha256(bytesFor(JSON.stringify(request)));
  const existingOp = findWritingOperation(handle.db, request.commandId, "export-draft-markdown");
  if (existingOp && existingOp.entityId) {
    const existingRow = handle.db.prepare("SELECT * FROM writing_exports WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (existingRow) {
      return mapExportRow(existingRow);
    }
  }

  const omissions: string[] = [];
  const disclosure = requestDisclosure(handle, {
    operation: "export",
    destination: "local",
    purpose: "writing-export",
    sourceVersions: [String(draftRow.artifact_version_id)]
  });

  if (disclosure.status === "deny") {
    omissions.push(`draft-content: ${disclosure.reason}`);
  }

  const formatLimits = ["markdown-utf8"];
  const provenanceLimits = ["derived-from-draft-version"];

  const content = [
    `# ${String(draftRow.title)}`,
    "",
    "<!--",
    `artifactVersionId: ${String(draftRow.artifact_version_id)}`,
    `findingKind: ${String(draftRow.finding_kind)}`,
    `attribution: ${String(draftRow.attribution)}`,
    `origin: ${String(draftRow.origin)}`,
    `formatLimits: ${JSON.stringify(formatLimits)}`,
    `provenanceLimits: ${JSON.stringify(provenanceLimits)}`,
    "-->",
    "",
    disclosure.status === "deny" ? "[Omitted per policy disclosure denial]" : String(draftRow.body_markdown)
  ].join("\n");

  const dir = dirname(request.destinationPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(request.destinationPath, content, "utf-8");

  const id = newId("export");
  const now = isoNow();

  handle.db.prepare(`
    INSERT INTO writing_exports (id, draft_id, format, destination_path, artifact_version_id, format_limits, provenance_limits, omissions, command_id, created_at)
    VALUES (?, ?, 'markdown', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    request.draftId,
    request.destinationPath,
    String(draftRow.artifact_version_id),
    JSON.stringify(formatLimits),
    JSON.stringify(provenanceLimits),
    JSON.stringify(omissions),
    request.commandId,
    now
  );

  recordWritingOperation(handle.db, request.commandId, "export-draft-markdown", payloadHash, id, null);

  const row = handle.db.prepare("SELECT * FROM writing_exports WHERE id = ?").get(id) as Record<string, unknown>;
  return mapExportRow(row);
}

export function exportDraftDocx(
  handle: ProjectHandle,
  capability: unknown,
  request: ExportWritingRequest
): WritingExport {
  assertWritingSchema(handle);
  assertWritable(handle);
  assertOwner(handle, capability, "exportDraftDocx");

  const draftRow = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(request.draftId) as Record<string, unknown> | undefined;
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft not found: ${request.draftId}`);
  }

  const payloadHash = sha256(bytesFor(JSON.stringify(request)));
  const existingOp = findWritingOperation(handle.db, request.commandId, "export-draft-docx");
  if (existingOp && existingOp.entityId) {
    const existingRow = handle.db.prepare("SELECT * FROM writing_exports WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (existingRow) {
      return mapExportRow(existingRow);
    }
  }

  const omissions: string[] = [];
  const disclosure = requestDisclosure(handle, {
    operation: "export",
    destination: "local",
    purpose: "writing-export",
    sourceVersions: [String(draftRow.artifact_version_id)]
  });

  if (disclosure.status === "deny") {
    omissions.push(`draft-content: ${disclosure.reason}`);
  }

  const formatLimits = ["ooxml-paragraph-text-only", "no-macros", "no-images", "no-styles"];
  const provenanceLimits = ["derived-from-draft-version"];

  const paragraphs = disclosure.status === "deny"
    ? ["[Omitted per policy disclosure denial]"]
    : [
        String(draftRow.title),
        ...String(draftRow.body_markdown).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
      ];

  const docxBytes = buildDocx(paragraphs);

  const dir = dirname(request.destinationPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(request.destinationPath, docxBytes);

  const id = newId("export");
  const now = isoNow();

  handle.db.prepare(`
    INSERT INTO writing_exports (id, draft_id, format, destination_path, artifact_version_id, format_limits, provenance_limits, omissions, command_id, created_at)
    VALUES (?, ?, 'docx', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    request.draftId,
    request.destinationPath,
    String(draftRow.artifact_version_id),
    JSON.stringify(formatLimits),
    JSON.stringify(provenanceLimits),
    JSON.stringify(omissions),
    request.commandId,
    now
  );

  recordWritingOperation(handle.db, request.commandId, "export-draft-docx", payloadHash, id, null);

  const row = handle.db.prepare("SELECT * FROM writing_exports WHERE id = ?").get(id) as Record<string, unknown>;
  return mapExportRow(row);
}

export function exportDraftBibliography(
  handle: ProjectHandle,
  capability: unknown,
  request: ExportBibliographyRequest
): WritingExport {
  assertWritingSchema(handle);
  assertWritable(handle);
  assertOwner(handle, capability, "exportDraftBibliography");

  const draftRow = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(request.draftId) as Record<string, unknown> | undefined;
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft not found: ${request.draftId}`);
  }

  const payloadHash = sha256(bytesFor(JSON.stringify(request)));
  const existingOp = findWritingOperation(handle.db, request.commandId, "export-draft-bibliography");
  if (existingOp && existingOp.entityId) {
    const existingRow = handle.db.prepare("SELECT * FROM writing_exports WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (existingRow) {
      return mapExportRow(existingRow);
    }
  }

  // Find linked source versions
  const links = handle.db.prepare(
    "SELECT evidence_item_id FROM draft_assertion_links WHERE draft_id = ? AND evidence_item_id IS NOT NULL"
  ).all(request.draftId) as Array<{ evidence_item_id: string }>;

  const sourceVersionIds = new Set<string>();
  for (const link of links) {
    const ev = handle.db.prepare("SELECT source_version_id FROM evidence_items WHERE id = ?").get(link.evidence_item_id) as { source_version_id?: string } | undefined;
    if (ev?.source_version_id) {
      sourceVersionIds.add(ev.source_version_id);
    }
  }

  if (sourceVersionIds.size === 0) {
    const allBibSources = handle.db.prepare(
      "SELECT DISTINCT source_version_id FROM source_records WHERE record_kind = 'bibliographic'"
    ).all() as Array<{ source_version_id: string }>;
    for (const s of allBibSources) {
      sourceVersionIds.add(s.source_version_id);
    }
  }

  const omissions: string[] = [];
  const records = [];
  for (const sVerId of sourceVersionIds) {
    const disclosure = requestDisclosure(handle, {
      operation: "export",
      destination: "local",
      purpose: "writing-export",
      sourceVersions: [sVerId]
    });
    if (disclosure.status === "deny") {
      omissions.push(`source-version-${sVerId}: ${disclosure.reason}`);
      continue;
    }
    records.push(...listBibliographicRecords(handle, sVerId));
  }

  const formatLimits = [`${request.format}-text-only`, "raw-identities-only"];
  const provenanceLimits = ["derived-from-linked-sources"];

  let textContent = "";
  if (request.format === "bibtex") {
    textContent = records.map((rec) => {
      const key = rec.entryKey ?? rec.id;
      const type = rec.rawFields.type ?? rec.rawFields.entryType ?? "article";
      const fieldLines = Object.entries(rec.rawFields)
        .filter(([k]) => k !== "type" && k !== "entryType")
        .map(([k, v]) => `  ${k} = {${v}}`)
        .join(",\n");
      return `@${type}{${key},\n${fieldLines}\n}\n`;
    }).join("\n");
  } else {
    textContent = records.map((rec) => {
      let ris = `TY  - ${rec.rawFields.TY ?? "JOUR"}\n`;
      for (const [k, v] of Object.entries(rec.rawFields)) {
        if (k !== "TY" && k !== "ER") {
          ris += `${k.padEnd(2, " ")}  - ${v}\n`;
        }
      }
      ris += "ER  -\n";
      return ris;
    }).join("\n");
  }

  const dir = dirname(request.destinationPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(request.destinationPath, textContent, "utf-8");

  const id = newId("export");
  const now = isoNow();

  handle.db.prepare(`
    INSERT INTO writing_exports (id, draft_id, format, destination_path, artifact_version_id, format_limits, provenance_limits, omissions, command_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    request.draftId,
    request.format,
    request.destinationPath,
    String(draftRow.artifact_version_id),
    JSON.stringify(formatLimits),
    JSON.stringify(provenanceLimits),
    JSON.stringify(omissions),
    request.commandId,
    now
  );

  recordWritingOperation(handle.db, request.commandId, "export-draft-bibliography", payloadHash, id, null);

  const row = handle.db.prepare("SELECT * FROM writing_exports WHERE id = ?").get(id) as Record<string, unknown>;
  return mapExportRow(row);
}

export function exportDraftTableCsv(
  handle: ProjectHandle,
  capability: unknown,
  request: ExportWritingRequest & { readonly tableId?: string }
): WritingExport {
  assertWritingSchema(handle);
  assertWritable(handle);
  assertOwner(handle, capability, "exportDraftTableCsv");

  const draftRow = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(request.draftId) as Record<string, unknown> | undefined;
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft not found: ${request.draftId}`);
  }

  let tableRow: Record<string, unknown> | undefined;
  if (request.tableId) {
    tableRow = handle.db.prepare("SELECT * FROM draft_tables WHERE id = ? AND draft_id = ?").get(request.tableId, request.draftId) as Record<string, unknown> | undefined;
  } else {
    tableRow = handle.db.prepare("SELECT * FROM draft_tables WHERE draft_id = ? ORDER BY created_at DESC LIMIT 1").get(request.draftId) as Record<string, unknown> | undefined;
  }
  if (!tableRow) {
    throw new ProjectStoreError("not-found", `table not found for draft: ${request.draftId}`);
  }

  const payloadHash = sha256(bytesFor(JSON.stringify(request)));
  const existingOp = findWritingOperation(handle.db, request.commandId, "export-draft-table-csv");
  if (existingOp && existingOp.entityId) {
    const existingRow = handle.db.prepare("SELECT * FROM writing_exports WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (existingRow) {
      return mapExportRow(existingRow);
    }
  }

  const omissions: string[] = [];
  const disclosure = requestDisclosure(handle, {
    operation: "export",
    destination: "local",
    purpose: "writing-export",
    sourceVersions: [String(draftRow.artifact_version_id)]
  });

  if (disclosure.status === "deny") {
    omissions.push(`draft-table: ${disclosure.reason}`);
  }

  const headers = JSON.parse(String(tableRow.headers)) as string[];
  const rows = JSON.parse(String(tableRow.rows)) as string[][];

  const formatLimits = ["csv-tabular-only", "no-formulas"];
  const provenanceLimits = ["derived-from-draft-table"];

  let csvContent = "";
  if (disclosure.status !== "deny") {
    csvContent = [
      headers.map(escapeCsvValue).join(","),
      ...rows.map((r) => r.map(escapeCsvValue).join(","))
    ].join("\n") + "\n";
  }

  const dir = dirname(request.destinationPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(request.destinationPath, csvContent, "utf-8");

  const id = newId("export");
  const now = isoNow();

  handle.db.prepare(`
    INSERT INTO writing_exports (id, draft_id, format, destination_path, artifact_version_id, format_limits, provenance_limits, omissions, command_id, created_at)
    VALUES (?, ?, 'csv', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    request.draftId,
    request.destinationPath,
    String(draftRow.artifact_version_id),
    JSON.stringify(formatLimits),
    JSON.stringify(provenanceLimits),
    JSON.stringify(omissions),
    request.commandId,
    now
  );

  recordWritingOperation(handle.db, request.commandId, "export-draft-table-csv", payloadHash, id, null);

  const row = handle.db.prepare("SELECT * FROM writing_exports WHERE id = ?").get(id) as Record<string, unknown>;
  return mapExportRow(row);
}

export function exportReviewPacket(
  handle: ProjectHandle,
  capability: unknown,
  request: ExportReviewPacketRequest
): ReviewPacketExport {
  assertWritingSchema(handle);
  assertWritable(handle);
  assertOwner(handle, capability, "exportReviewPacket");

  const draftRow = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(request.draftId) as Record<string, unknown> | undefined;
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft not found: ${request.draftId}`);
  }

  const payloadHash = sha256(bytesFor(JSON.stringify(request)));
  const existingOp = findWritingOperation(handle.db, request.commandId, "export-review-packet");
  if (existingOp && existingOp.entityId) {
    const existingRow = handle.db.prepare("SELECT * FROM review_packet_exports WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (existingRow) {
      return mapPacketExportRow(existingRow);
    }
  }

  // Find linked issues
  const issueRows = handle.db.prepare(
    "SELECT * FROM review_issues WHERE draft_id = ? ORDER BY rank ASC"
  ).all(request.draftId) as Array<Record<string, unknown>>;

  // Find cycle and feedbacks
  let cycleRow: Record<string, unknown> | undefined;
  if (request.cycleId) {
    cycleRow = handle.db.prepare("SELECT * FROM review_cycles WHERE id = ?").get(request.cycleId) as Record<string, unknown> | undefined;
    if (!cycleRow) {
      throw new ProjectStoreError("not-found", `review cycle not found: ${request.cycleId}`);
    }
    if (String(cycleRow.draft_id) !== request.draftId) {
      throw new ProjectStoreError("invalid-argument", `review cycle ${request.cycleId} belongs to draft ${String(cycleRow.draft_id)}, not ${request.draftId}`);
    }
  } else {
    cycleRow = handle.db.prepare("SELECT * FROM review_cycles WHERE draft_id = ? ORDER BY created_at DESC LIMIT 1").get(request.draftId) as Record<string, unknown> | undefined;
  }

  const feedbackRows = cycleRow
    ? (handle.db.prepare("SELECT * FROM supervisor_feedbacks WHERE cycle_id = ? ORDER BY created_at ASC").all(String(cycleRow.id)) as Array<Record<string, unknown>>)
    : [];

  // Find linked evidence items
  const linkRows = handle.db.prepare(
    "SELECT * FROM draft_assertion_links WHERE draft_id = ?"
  ).all(request.draftId) as Array<Record<string, unknown>>;

  const omissions: string[] = [];
  const permittedEvidenceRefs: Array<Record<string, unknown>> = [];

  const draftVersionId = String(draftRow.artifact_version_id);
  const draftDisclosure = requestDisclosure(handle, {
    operation: "export",
    destination: "review-packet",
    purpose: "supervisor-review",
    sourceVersions: [draftVersionId]
  });

  if (draftDisclosure.status === "deny") {
    omissions.push(`draft-content-${draftVersionId}: ${draftDisclosure.reason}`);
  }

  for (const link of linkRows) {
    if (link.evidence_item_id) {
      const evRow = handle.db.prepare("SELECT * FROM evidence_items WHERE id = ?").get(String(link.evidence_item_id)) as Record<string, unknown> | undefined;
      if (evRow && evRow.source_version_id) {
        const sourceVerId = String(evRow.source_version_id);
        const disclosure = requestDisclosure(handle, {
          operation: "export",
          destination: "review-packet",
          purpose: "supervisor-review",
          sourceVersions: [sourceVerId]
        });

        if (disclosure.status === "deny") {
          omissions.push(`evidence-source-${sourceVerId}: ${disclosure.reason}`);
          permittedEvidenceRefs.push({
            id: String(evRow.id),
            role: String(link.role),
            status: "omitted-restricted",
            reason: disclosure.reason
          });
        } else {
          permittedEvidenceRefs.push({
            id: String(evRow.id),
            role: String(link.role),
            status: "permitted",
            sourceVersionId: sourceVerId,
            locator: evRow.locator ? JSON.parse(String(evRow.locator)) : undefined
          });
        }
      }
    }
  }

  const now = isoNow();
  const packetDir = request.destinationPath;
  if (!existsSync(packetDir)) {
    mkdirSync(packetDir, { recursive: true });
  }

  const manifest: Record<string, unknown> = {
    kind: "review",
    schemaVersion: 1,
    draftId: request.draftId,
    draftVersionNumber: Number(draftRow.version_number),
    cycleId: cycleRow ? String(cycleRow.id) : null,
    createdAt: now,
    omissions
  };

  // Write packet files
  writeFileSync(join(packetDir, "ganesh-review-packet.json"), JSON.stringify(manifest, null, 2), "utf-8");
  writeFileSync(join(packetDir, "ganesh-project-packet.json"), JSON.stringify({
    kind: "review",
    schemaVersion: 1,
    files: []
  }, null, 2), "utf-8");

  const draftContent = draftDisclosure.status === "deny"
    ? `<!-- [OMITTED: draft content restricted per policy disclosure - ${draftDisclosure.reason}] -->\n[Omitted per policy disclosure denial]\n`
    : `# ${String(draftRow.title)}\n\n${String(draftRow.body_markdown)}\n`;
  writeFileSync(join(packetDir, "draft.md"), draftContent, "utf-8");
  writeFileSync(join(packetDir, "issues.json"), JSON.stringify(issueRows, null, 2), "utf-8");
  writeFileSync(join(packetDir, "questions.json"), JSON.stringify(feedbackRows, null, 2), "utf-8");
  writeFileSync(join(packetDir, "evidence-references.json"), JSON.stringify(permittedEvidenceRefs, null, 2), "utf-8");
  writeFileSync(join(packetDir, "omissions.json"), JSON.stringify(omissions, null, 2), "utf-8");

  const id = newId("reviewpkt");

  handle.db.prepare(`
    INSERT INTO review_packet_exports (id, draft_id, cycle_id, packet_path, artifact_version_id, manifest, omissions, command_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    request.draftId,
    cycleRow ? String(cycleRow.id) : null,
    packetDir,
    String(draftRow.artifact_version_id),
    JSON.stringify(manifest),
    JSON.stringify(omissions),
    request.commandId,
    now
  );

  recordWritingOperation(handle.db, request.commandId, "export-review-packet", payloadHash, id, null);

  const row = handle.db.prepare("SELECT * FROM review_packet_exports WHERE id = ?").get(id) as Record<string, unknown>;
  return mapPacketExportRow(row);
}
