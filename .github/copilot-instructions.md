# GitHub Copilot Harness Repository

Router for this repo. Rules live one line each; the detail lives in the skill or doc that owns it.

## Project

A VS Code extension for the GitHub Copilot harness, the Copilot counterpart of Claude Harness (`integrations-at.claude-harness`). The `.github/` Copilot config is the harness this repo is built with.

```text
research/  Market research: the report and the researchers' notes
.github/   Instructions, skills, prompts, agents, hooks, CLI settings
.vscode/   MCP servers for VS Code
tasks/     todo.md for the active plan, lessons.md for recorded corrections
```

## Where the detail lives

| Surface | Detail lives in |
| ------- | --------------- |
| Why and what to build | `research/Copilot harness extension landscape.md` |
| Implementation plan | GitHub issues of this repository, skill `create-issue` |
| Harness config | `.github/skills/`, `.github/agents/`, `.github/instructions/`, `.github/prompts/` |
| Active plan and corrections | `tasks/todo.md`, `tasks/lessons.md` |

## Skills

- `.github/skills/<name>/SKILL.md` is the Copilot roster.
- Search it before any action, not only before implementing. A matching skill overrides improvisation.

## Agents

- `.github/agents/<name>.agent.md` is the Copilot roster.
- Route specialist work to the matching agent instead of doing it on the main thread.
- When the user names an agent, use exactly that one. Never substitute or downgrade.

## Hard Rules

- Issue independent tool calls, reads, searches, and subagent tasks in one parallel batch. Sequential execution of independent work is a bug.
- Whenever a subject matter specialist agent is available for the task, use it. Never do specialist work on the main thread when a matching agent exists.
- Whenever a subagent is used, even a single one, create a task ledger first and record every spawn, correction, and report in it.
- Never commit or push without an explicit request.
- Internal links are relative paths (`research/notes/cross_agent_tools.md`); anchors are `#heading-name`.
- Every code fence declares a language.
- Fix the underlying issue when a quality check fails. Never bypass with `--no-verify`.
- Clean code only: no inline comments, no explanatory remarks, no placeholder notes.
- No error handling in scripts unless asked.
- No documentation unless explicitly asked. Keep docs short (max 2 heading levels).
- Always consult Microsoft Learn MCP when implementing or fixing code.

## Working Method

- Plan before any non-trivial task (3+ steps or an architectural decision). If it goes sideways, stop and re-plan.
- Write the plan to `tasks/todo.md` as checkable items, mark them off as you go, and add a review section at the end.
- After any correction from the user, record the pattern in `tasks/lessons.md`.
- Prove it works before calling it done: run it, check the output, diff the behaviour.
- Simplest change that solves the root cause, touching only what is necessary. A typo fix is a typo-sized diff.
- Tutorial over library: clear explanations and copy-paste examples beat reusable abstractions.
- Never re-read a file you just wrote, and never re-run a command whose outcome was certain.
- Do not echo back large blocks of code or file contents unless asked.
