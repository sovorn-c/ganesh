# User Guide

Ganesh is a local-first research-supervision assistant for individual researchers. It combines autonomous research work, deterministic controls, and human decisions across the research lifecycle.

## Getting Started

To launch Ganesh on a research project folder:

```bash
ganesh /path/to/my-project
```

If the project folder does not yet contain a `.ganesh` store, Ganesh creates a fresh research project database and initializes baseline records. If the project already exists, Ganesh reopens the database in ready state.

## Core Concepts

- **Canonical State:** All durable research artifacts and database records are stored inside `<project-folder>/.ganesh/project.sqlite` and `.ganesh/artifacts/`.
- **Durable Artifacts:** Every imported paper, dataset, synthesis draft, and extracted figure is content-addressed and SHA-256 hashed.
- **Human Supervision:** Critical research transitions require explicit owner confirmation. Assistant proposals never substitute for human decisions.
- **Terminal UI:** Ganesh reuses the Pi terminal interface to provide full visibility into active work, tool executions, and project status.
