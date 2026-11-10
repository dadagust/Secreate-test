---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

In this repository a handoff is a checkpoint, not a separate document: update `WORKLOG.md` and copy the checkpoint into the notes of the active Backlog.md task (`npm run backlog -- task edit <id> --append-notes ...`), as `AGENTS.md` describes. Do not create handoff files.

Include a "suggested skills" line in the checkpoint, naming which skills the next agent should call the Skill tool for.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
