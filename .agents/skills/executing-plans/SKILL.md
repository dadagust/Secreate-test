---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Note:** In this repository the plan is the implementation plan of the Backlog.md task (`npm run backlog -- task view <id> --plain`) and the working state is `WORKLOG.md` (see `AGENTS.md`). Independent steps may be delegated to subagents; verify their results against the source before moving on.

## The Process

### Step 1: Load and Review Plan
1. Check `git status`; do not switch branches or create worktrees without the user's approval (`AGENTS.md`, section Git)
2. Read the plan in the Backlog.md task and `WORKLOG.md`
3. Review critically - identify any questions or concerns about the plan
4. If concerns: Raise them with your human partner before starting
5. If no concerns: Create todos for the plan items and proceed

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark as completed

### Step 3: Complete Development

After all tasks complete and verified:
- Use the `verification-before-completion` skill and the completion criteria in `AGENTS.md`
- Record the final summary in the Backlog.md task; commit, push or open a merge request only when the user asks

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Stop when blocked, don't guess
- Do not switch branches without the user's approval (`AGENTS.md`, section Git)
