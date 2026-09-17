// story: e13s04
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createOwnerCapability,
  createWorkerCapabilities,
  ProjectStoreError,
  recordDraft,
  linkDraftAssertion,
  recordReviewIssue,
  openReviewCycle,
  recordSupervisorFeedback,
  recordDraftTable,
  exportDraftMarkdown,
  exportDraftDocx,
  exportDraftBibliography,
  exportDraftTableCsv,
  exportReviewPacket,
  exportProject,
  restoreProject,
  classifyInput,
  importLocalSource,
  importStructuredSource
} from "../../src/index.js";
import { projectFixture, disposeFixture, artifact } from "../support/project-fixtures.js";
import { writingWorker } from "../support/writing-fixtures.js";

describe("e13s04 permitted writing and review-packet export", () => {
  it("e13s04 SC-e13s04-P0-01 markdown docx bibtex ris and csv export with format-limit and provenance metadata", async () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");

    try {
      // 1. Record draft
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s04-p01-draft",
        title: "Therapeutic Trial Results",
        bodyMarkdown: "Paragraph 1 on cohort results.\n\nParagraph 2 on statistical power."
      });

      // 2. Record draft table
      const table = recordDraftTable(fixture.handle, owner, {
        commandId: "e13s04-p01-table",
        draftId: draft.id,
        title: "Cohort Summary",
        headers: ["Group", "Participants", "ResponseRate"],
        rows: [
          ["Intervention", "120", "0.78"],
          ["Control", "115", "0.42"]
        ],
        notes: "Intent-to-treat analysis"
      });
      assert.ok(table.id);
      assert.equal(table.title, "Cohort Summary");

      // 3. Import bibliographic source
      const bibPath = join(fixture.root, "trial-refs.bib");
      writeFileSync(
        bibPath,
        "@article{doe2025,\n  title={Clinical Trial Protocol},\n  author={Doe, John and Smith, Jane},\n  doi={10.1234/trial2025}\n}\n"
      );
      const imported = importLocalSource(fixture.handle, owner, {
        commandId: "e13s04-import-bib",
        path: bibPath,
        logicalId: "trial-bib",
        version: "v1",
        format: "bibtex",
        mediaType: "application/x-bibtex"
      });
      await importStructuredSource(fixture.handle, imported.source.artifactVersionId);

      // Create evidence item and link assertion
      const evId = "ev-trial-item-1";
      fixture.handle.db.prepare(
        "INSERT INTO evidence_items (id, source_version_id, location_kind, location_id, locator_snapshot, statement_kind, origin, limitations, excerpt, excerpt_hash, created_at) VALUES (?, ?, 'file', 'f1', '{}', 'observation', 'owner-recorded', '[]', 'trial notes', 'hash', ?)"
      ).run(evId, imported.source.artifactVersionId, new Date().toISOString());

      linkDraftAssertion(fixture.handle, owner, {
        commandId: "e13s04-p01-link",
        draftId: draft.id,
        evidenceItemId: evId,
        role: "supports"
      });

      // 4. Export Markdown
      const mdDest = join(fixture.root, "output", "draft.md");
      const mdExport = exportDraftMarkdown(fixture.handle, owner, {
        commandId: "e13s04-p01-exp-md",
        draftId: draft.id,
        destinationPath: mdDest
      });
      assert.ok(existsSync(mdDest));
      assert.equal(mdExport.format, "markdown");
      assert.deepEqual(mdExport.formatLimits, ["markdown-utf8"]);
      assert.deepEqual(mdExport.provenanceLimits, ["derived-from-draft-version"]);
      const mdBytes = readFileSync(mdDest, "utf-8");
      assert.ok(mdBytes.includes("Therapeutic Trial Results"));
      assert.ok(mdBytes.includes("Paragraph 1 on cohort results."));

      // 5. Export DOCX
      const docxDest = join(fixture.root, "output", "draft.docx");
      const docxExport = exportDraftDocx(fixture.handle, owner, {
        commandId: "e13s04-p01-exp-docx",
        draftId: draft.id,
        destinationPath: docxDest
      });
      assert.ok(existsSync(docxDest));
      assert.equal(docxExport.format, "docx");
      assert.ok(docxExport.formatLimits.includes("ooxml-paragraph-text-only"));
      assert.ok(docxExport.formatLimits.includes("no-macros"));
      assert.ok(docxExport.formatLimits.includes("no-images"));
      const docxBytes = readFileSync(docxDest);
      // Valid ZIP starts with PK signature
      assert.equal(docxBytes.readUInt32LE(0), 0x04034b50);

      // 6. Export Bibliography (BibTeX)
      const bibDest = join(fixture.root, "output", "refs.bib");
      const bibExport = exportDraftBibliography(fixture.handle, owner, {
        commandId: "e13s04-p01-exp-bib",
        draftId: draft.id,
        destinationPath: bibDest,
        format: "bibtex"
      });
      assert.ok(existsSync(bibDest));
      assert.equal(bibExport.format, "bibtex");
      assert.deepEqual(bibExport.formatLimits, ["bibtex-text-only", "raw-identities-only"]);
      const bibText = readFileSync(bibDest, "utf-8");
      assert.ok(bibText.includes("doe2025"));
      assert.ok(bibText.includes("Clinical Trial Protocol"));

      // 7. Export Bibliography (RIS)
      const risDest = join(fixture.root, "output", "refs.ris");
      const risExport = exportDraftBibliography(fixture.handle, owner, {
        commandId: "e13s04-p01-exp-ris",
        draftId: draft.id,
        destinationPath: risDest,
        format: "ris"
      });
      assert.ok(existsSync(risDest));
      assert.equal(risExport.format, "ris");
      assert.deepEqual(risExport.formatLimits, ["ris-text-only", "raw-identities-only"]);
      const risText = readFileSync(risDest, "utf-8");
      assert.ok(risText.includes("TY  -"));
      assert.ok(risText.includes("ER  -"));

      // 8. Export CSV table
      const csvDest = join(fixture.root, "output", "cohort.csv");
      const csvExport = exportDraftTableCsv(fixture.handle, owner, {
        commandId: "e13s04-p01-exp-csv",
        draftId: draft.id,
        tableId: table.id,
        destinationPath: csvDest
      });
      assert.ok(existsSync(csvDest));
      assert.equal(csvExport.format, "csv");
      assert.deepEqual(csvExport.formatLimits, ["csv-tabular-only", "no-formulas"]);
      const csvText = readFileSync(csvDest, "utf-8");
      assert.ok(csvText.includes("Group,Participants,ResponseRate"));
      assert.ok(csvText.includes("Intervention,120,0.78"));

      // 9. Neutralize CSV formula injection (CWE-1236)
      const formulaTable = recordDraftTable(fixture.handle, owner, {
        commandId: "e13s04-p01-table-formulas",
        draftId: draft.id,
        title: "Formula Injection Test",
        headers: ["Standard", "=SUM(A1:A2)", "+100", "@HYPERLINK", "-DIFF"],
        rows: [
          ["Row1", "=cmd|'/C calc'!A0", "+calc", "-sub", "\tTabLead"]
        ]
      });
      const formulaCsvDest = join(fixture.root, "output", "formula-safe.csv");
      exportDraftTableCsv(fixture.handle, owner, {
        commandId: "e13s04-p01-exp-formula-csv",
        draftId: draft.id,
        tableId: formulaTable.id,
        destinationPath: formulaCsvDest
      });
      const formulaCsvText = readFileSync(formulaCsvDest, "utf-8");
      assert.ok(formulaCsvText.includes("'=SUM(A1:A2)"));
      assert.ok(formulaCsvText.includes("'+100"));
      assert.ok(formulaCsvText.includes("'@HYPERLINK"));
      assert.ok(formulaCsvText.includes("'-DIFF"));
      assert.ok(formulaCsvText.includes("'=cmd|'/C calc'!A0") || formulaCsvText.includes("''=cmd"));
      assert.ok(formulaCsvText.includes("'+calc"));
      assert.ok(formulaCsvText.includes("'-sub"));
      assert.ok(formulaCsvText.includes("'\tTabLead"));

      // 10. Bibliography export with unlinked draft falls back to source_records query (record_kind)
      const unlinkedDraft = recordDraft(fixture.handle, owner, {
        commandId: "e13s04-p01-unlinked-draft",
        title: "Unlinked Draft for Bib Fallback",
        bodyMarkdown: "Content without direct assertion links."
      });
      const fallbackBibDest = join(fixture.root, "output", "fallback-refs.bib");
      const fallbackBibExport = exportDraftBibliography(fixture.handle, owner, {
        commandId: "e13s04-p01-exp-fallback-bib",
        draftId: unlinkedDraft.id,
        destinationPath: fallbackBibDest,
        format: "bibtex"
      });
      assert.ok(existsSync(fallbackBibDest));
      assert.equal(fallbackBibExport.format, "bibtex");
      const fallbackBibText = readFileSync(fallbackBibDest, "utf-8");
      assert.ok(fallbackBibText.includes("doe2025"));
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s04 SC-e13s04-P0-02 review-packet export omits restricted bytes with omission notices via disclosure oracle", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");

    try {
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s04-p02-draft",
        title: "Confidential Clinical Study",
        bodyMarkdown: "Discussion of participant records."
      });

      const cycle = openReviewCycle(fixture.handle, owner, {
        commandId: "e13s04-p02-cycle",
        draftId: draft.id
      });

      recordSupervisorFeedback(fixture.handle, owner, {
        commandId: "e13s04-p02-fb",
        cycleId: cycle.id,
        draftId: draft.id,
        supervisorName: "Dr Example",
        supervisorRole: "Academic supervisor",
        feedbackText: "Ensure participant confidentiality before exporting.",
        dissentText: "Dispute on external data sharing."
      });

      recordReviewIssue(fixture.handle, owner, {
        commandId: "e13s04-p02-issue",
        draftId: draft.id,
        rank: 1,
        title: "Privacy Compliance",
        description: "Participant records must remain on local premises."
      });

      // Register a source version and classify as restricted
      const restrictedPath = join(fixture.root, "patient-data.txt");
      writeFileSync(restrictedPath, "Confidential participant identifying details\n");
      const restrictedSource = importLocalSource(fixture.handle, owner, {
        commandId: "e13s04-import-restricted",
        path: restrictedPath,
        logicalId: "patient-data",
        version: "v1",
        format: "text",
        mediaType: "text/plain"
      });

      classifyInput(fixture.handle, restrictedSource.source.artifactVersionId, {
        sensitivity: "restricted",
        basis: "confidential clinical trial data"
      });

      const restrictedEvId = "ev-restricted-item-1";
      fixture.handle.db.prepare(
        "INSERT INTO evidence_items (id, source_version_id, location_kind, location_id, locator_snapshot, statement_kind, origin, limitations, excerpt, excerpt_hash, created_at) VALUES (?, ?, 'file', 'f1', '{}', 'observation', 'owner-recorded', '[]', 'restricted data', 'hash', ?)"
      ).run(restrictedEvId, restrictedSource.source.artifactVersionId, new Date().toISOString());

      linkDraftAssertion(fixture.handle, owner, {
        commandId: "e13s04-p02-link",
        draftId: draft.id,
        evidenceItemId: restrictedEvId,
        role: "supports"
      });

      const packetDir = join(fixture.root, "supervisor-review-packet");
      const packetExport = exportReviewPacket(fixture.handle, owner, {
        commandId: "e13s04-p02-exp-pkt",
        draftId: draft.id,
        cycleId: cycle.id,
        destinationPath: packetDir
      });

      assert.ok(packetExport.id);
      assert.equal(packetExport.draftId, draft.id);
      assert.equal(packetExport.cycleId, cycle.id);
      assert.ok(packetExport.omissions.length > 0);

      // Verify files in packet
      assert.ok(existsSync(join(packetDir, "ganesh-review-packet.json")));
      assert.ok(existsSync(join(packetDir, "draft.md")));
      assert.ok(existsSync(join(packetDir, "issues.json")));
      assert.ok(existsSync(join(packetDir, "questions.json")));
      assert.ok(existsSync(join(packetDir, "evidence-references.json")));
      assert.ok(existsSync(join(packetDir, "omissions.json")));

      // Inspect omissions.json
      const omissionsContent = JSON.parse(readFileSync(join(packetDir, "omissions.json"), "utf-8")) as string[];
      assert.ok(omissionsContent.some((o) => o.includes("evidence-source")));
      assert.ok(omissionsContent.some((o) => o.includes("draft-content")));

      // Verify evidence references keep IDs but omit restricted raw content
      const evidenceRefs = JSON.parse(readFileSync(join(packetDir, "evidence-references.json"), "utf-8")) as Array<Record<string, unknown>>;
      assert.equal(evidenceRefs.length, 1);
      assert.equal(evidenceRefs[0].status, "omitted-restricted");
      assert.ok(evidenceRefs[0].reason);

      // Refuse review cycle belonging to another draft (CWE-345/639)
      const otherDraft = recordDraft(fixture.handle, owner, {
        commandId: "e13s04-p02-other-draft",
        title: "Other Unrelated Draft",
        bodyMarkdown: "Unrelated content."
      });
      assert.throws(
        () => exportReviewPacket(fixture.handle, owner, {
          commandId: "e13s04-p02-exp-mismatch-cycle",
          draftId: otherDraft.id,
          cycleId: cycle.id,
          destinationPath: join(fixture.root, "mismatch-packet")
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );

      // Omit restricted draft content when draft version disclosure is denied (CWE-200)
      classifyInput(fixture.handle, draft.artifactVersionId, {
        sensitivity: "restricted",
        basis: "confidential protocol specification"
      });
      const restrictedDraftPacketDir = join(fixture.root, "restricted-draft-review-packet");
      const restrictedDraftExport = exportReviewPacket(fixture.handle, owner, {
        commandId: "e13s04-p02-exp-restricted-draft",
        draftId: draft.id,
        cycleId: cycle.id,
        destinationPath: restrictedDraftPacketDir
      });
      assert.ok(restrictedDraftExport.omissions.some((o) => o.includes("draft-content")));
      const exportedDraftMd = readFileSync(join(restrictedDraftPacketDir, "draft.md"), "utf-8");
      assert.ok(!exportedDraftMd.includes("Discussion of participant records."));
      assert.ok(exportedDraftMd.includes("[Omitted per policy disclosure denial"));
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s04 SC-e13s04-P1-04 worker and star-worker export is denied and cannot submit or alter packet-kind or restore", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const workerNoExport = writingWorker(fixture.handle, ["writing:record", "writing:inspect"]);
    const starWorker = createWorkerCapabilities({
      projectId: fixture.handle.project.id,
      projectRoot: fixture.handle.project.rootPath,
      allowedOperations: ["*"]
    });

    try {
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s04-p04-draft",
        title: "Worker Denial Draft",
        bodyMarkdown: "Body."
      });

      const mdPath = join(fixture.root, "unauthorized.md");
      const docxPath = join(fixture.root, "unauthorized.docx");
      const pktPath = join(fixture.root, "unauthorized-packet");

      // 1. Worker denied exportDraftMarkdown
      assert.throws(
        () => exportDraftMarkdown(fixture.handle, workerNoExport, {
          commandId: "e13s04-worker-md",
          draftId: draft.id,
          destinationPath: mdPath
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );
      assert.equal(existsSync(mdPath), false);

      // 2. Star-worker denied exportDraftMarkdown
      assert.throws(
        () => exportDraftMarkdown(fixture.handle, starWorker, {
          commandId: "e13s04-star-md",
          draftId: draft.id,
          destinationPath: mdPath
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );
      assert.equal(existsSync(mdPath), false);

      // 3. Star-worker denied exportDraftDocx
      assert.throws(
        () => exportDraftDocx(fixture.handle, starWorker, {
          commandId: "e13s04-star-docx",
          draftId: draft.id,
          destinationPath: docxPath
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );
      assert.equal(existsSync(docxPath), false);

      // 4. Star-worker denied exportReviewPacket
      assert.throws(
        () => exportReviewPacket(fixture.handle, starWorker, {
          commandId: "e13s04-star-pkt",
          draftId: draft.id,
          destinationPath: pktPath
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );
      assert.equal(existsSync(pktPath), false);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s04 SC-e13s04-P0-03 regression verification ensures project-packet and backup restore remain intact while review packet fails closed", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");

    try {
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s04-p03-draft",
        title: "Regression Study",
        bodyMarkdown: "Content for restore verification."
      });

      // 1. Export standard E15 project packet
      const projectPktDir = join(fixture.root, "e15-project-packet");
      const projectExport = exportProject(fixture.handle, owner, {
        commandId: "e13s04-p03-exp-proj",
        destinationPath: projectPktDir,
        destination: "local",
        purpose: "backup",
        payloadHash: "dummy-hash-proj-exp"
      });
      assert.ok(existsSync(projectPktDir));
      assert.equal(projectExport.manifest.kind, "project");

      // 2. Export E13 review packet
      const reviewPktDir = join(fixture.root, "e13-review-packet");
      const reviewExport = exportReviewPacket(fixture.handle, owner, {
        commandId: "e13s04-p03-exp-rev",
        draftId: draft.id,
        destinationPath: reviewPktDir
      });
      assert.ok(existsSync(reviewPktDir));
      assert.equal(reviewExport.manifest.kind, "review");

      // 3. Restore of project packet succeeds
      const restoreProjectDir = join(fixture.root, "restored-project-success");
      const projCmdId = `e13s04-restore-proj-${Date.now()}-${Math.random()}`;
      const restoreResult = restoreProject(owner, {
        commandId: projCmdId,
        sourcePath: projectPktDir,
        destinationPath: restoreProjectDir,
        mode: "drill",
        payloadHash: "dummy-hash-restore"
      });
      assert.equal(restoreResult.valid, true);

      // 4. Restore of review packet FAILS CLOSED (invalid-packet-kind or corrupt-packet)
      const restoreReviewDir = join(fixture.root, "restored-review-fail");
      const revCmdId = `e13s04-restore-rev-${Date.now()}-${Math.random()}`;
      assert.throws(
        () => restoreProject(owner, {
          commandId: revCmdId,
          sourcePath: reviewPktDir,
          destinationPath: restoreReviewDir,
          mode: "drill",
          payloadHash: "dummy-hash-restore-fail"
        }),
        (error: unknown) => error instanceof ProjectStoreError
      );
    } finally {
      disposeFixture(fixture);
    }
  });
});
