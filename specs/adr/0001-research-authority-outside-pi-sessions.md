# Keep research authority outside Pi sessions

Status: accepted by the project owner during domain modeling.

Reuse Pi's SDK and terminal UI, but keep authoritative research versions, approvals, permissions, and work budgets in Ganesh's project state. Conversation branching, compaction, resumption, imported text, and agent output cannot change a research commitment. An explicit local owner action adopts exact artifact versions after current checks.

This rejects the simpler-looking alternative of using chat history or an “approved” message as the research database. Research decisions must remain reconstructable when a session changes, and revoked permissions must remain revoked across old branches. The cost is a separate domain command and persistence boundary; the benefit is enforceable authority without forking Pi or rebuilding its interface.

Pi integration still requires executable checks proving that built-in commands, attachments, resource loading, and session transitions cannot bypass the Ganesh boundary. Reuse is an architectural decision, not a tested security guarantee.
