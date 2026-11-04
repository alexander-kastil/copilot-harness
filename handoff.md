# Handoff: GitHub Copilot harness extension (2026-11-04, 09:40)

Session `e9ff8e1a-bda3-48fe-aee4-16bd083ab74a` (started in `D:\git-projects\claude-harness`; no git flow session id seen). Repo `D:\git-projects\gh-copilot-harness`, private on GitHub as `alexander-kastil/gh-copilot-harness`, branch master, one commit `2a9c346` pushed; commit and push only when the owner says so in that message. No `package.json` yet, so no version. Tree: `CHANGELOG.md` modified (+4 lines), this handoff untracked.

## Working rules in force

- The repo has no `CLAUDE.md`; its Copilot router is `.github/copilot-instructions.md`, and the hook `.github/hooks/copilot-instructions-guard.ps1` rejects it when it breaks the six-section router shape (max 90 non-empty lines, bullets max 30 words, headings max depth 2).
- The harness was set up "based on the config from this class D:\git-classes\agentic-sw-engineering-gh": the class's `.github/` and `.vscode/` and its `.claude/rules/copilot-harness.md` (where Copilot reads each file, the CLI MCP trap) are the reference.
- Issues follow the class's `create-issue` skill (`.github/skills/create-issue/SKILL.md`): parent plus sub-issues, linked through the REST `sub_issues` endpoint.
- Agent cap the owner set for the planning task: "you can use up to 5 haiku and sonnet". A new task gets its own cap from the owner.

## Where things are

- Research: `research/Copilot harness extension landscape.md` (the answer: no extension like Claude Harness exists for Copilot; 17-row feature table; six data facts the sources disagree on) and `research/notes/` (four researchers' notes).
- Copilot Studio: `research/Copilot Studio harness extension.md`. Verdict: worth it as its own later extension, not inside this one (its data comes from Dataverse and the admin center behind a sign-in, not from local files); a reader interface in this extension leaves room for it, never a shared package.
- Plan: issue #1 "Implementation plan: a Claude Harness for GitHub Copilot", with phases #2 Foundation (#6 to #13), #3 Editor (#14 to #21), #4 Sessions (#22 to #29), #5 Build with Copilot (#30 to #37). Each task issue has a "Depends on" list and its open questions; each phase issue has the task order.
- Reference product: Claude Harness, `D:\git-projects\claude-harness` (public `alexander-kastil/claude-harness`); the issues cite its code with line anchors.

## Agents

| Handle | Agent id or name | State | What |
|---|---|---|---|
| @res-editors, @res-sessions, @res-crossagent, @res-builtin, @writer | named teammates of the old session | done, not resumable from another repo | Research and report, now in `research/` |
| @plan-found, @plan-edit, @plan-sess, @plan-build | named teammates of the old session | done, not resumable from another repo | Drafted issues #6 to #37 |
| @cs-research | named teammate of the old session | done, not resumable from another repo | Copilot Studio research, now in `research/` |

No report cron is running.

## Next steps, in order

1. Answer the open CHANGELOG question below, then fix `CHANGELOG.md` as decided. Last known: line 1 of Added is correct, lines 2 to 5 are cut-off planner report fragments.
2. Read the plan: `gh issue view 1 --repo alexander-kastil/gh-copilot-harness` and `gh api repos/alexander-kastil/gh-copilot-harness/issues/2/sub_issues --jq '.[].number'`. Last known: #1 has 4 sub-issues, each phase has 8.
3. Start with #6 (Scaffold the extension with a webview panel, packaging and CI). Its open decisions are the owner's: CI system (GitHub Actions or Azure DevOps like Claude Harness), extension name, publisher, minimum VS Code version.
4. After #6: #7, #8, #9 and #10 depend only on #6 and can run in parallel; #11, #12 and #13 wait on #8, #9 and #10.

## Known open items

- `.github/copilot/settings.json` was copied verbatim from the class: `"disableAllHooks": true` and `"model": "deepseek-ai/DeepSeek-V4.1-Flash"`, so the Copilot CLI skips the router guard hook and picks that model in this repo. `.github/agents/github-actions.agent.md` keeps the class's `model: DeepSeek V4 Flash (oaicopilot)`.
- All third-party feature claims in the research come from READMEs and Marketplace listings; nothing was installed or tested.

## Open questions for the owner (asked, no answer yet)

- "`CHANGELOG.md` has four uncommitted lines that the changelog automation added from the planners' reports, and some are cut off mid-sentence. Shall I replace them with one line and push?"

## Done outside this repo (unpublished)

- `D:\git-projects\copilot-studio-harness`, private `alexander-kastil/copilot-studio-harness`, one commit pushed: the Copilot Studio research and the same Copilot harness. Plan: issue #1 with phases #2 Foundation (#6 to #11), #3 Editor (#12 to #18), #4 Sessions (#19 to #25), #5 Build (#26 to #31).
- Decision-maker deck: https://claude.ai/artifact/KSDB6K2KGJngVp2FXH79Sy (private until shared).
- `D:\git-classes\agentic-sw-engineering-gh` was only read.
