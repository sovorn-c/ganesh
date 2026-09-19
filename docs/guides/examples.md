# Examples and Walkthroughs

This guide provides practical examples of working with Ganesh in everyday research scenarios.

## Example: Initializing a Research Project

Create a directory for a study and launch Ganesh:

```bash
mkdir -p /tmp/ganesh-example-project
cd /tmp/ganesh-example-project
ganesh .
```

Ganesh initializes `.ganesh/project.sqlite` and the `.ganesh/artifacts/` store, creating the initial branch `main` at revision 0.

## Example: Registering Research Evidence

When importing a study artifact (such as a PDF or BibTeX file), Ganesh content-addresses the file, computes its SHA-256 hash, and registers an immutable artifact version record.

```bash
# Research evidence is hashed and verified upon entry
ganesh import --file ./paper-draft.md
```

## Example: Creating a Verified Backup

Before performing schema updates or major project re-organizations, generate an E15 backup:

```bash
ganesh backup --destination /tmp/ganesh-example-project/backups
```

The backup bundle preserves the full SQLite database, all available artifact bytes, and an integrity manifest with per-file SHA-256 digests.
