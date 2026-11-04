# gh-copilot-harness

## Project

Copilot Harness: a VS Code extension that does for the GitHub Copilot harness what Claude Harness (`D:\git-projects\claude-harness`) does for Claude Code.

## Where the detail lives

- Plan: GitHub issues #1 to #37 (phases #2 Foundation, #3 Editor, #4 Sessions, #5 Build with Copilot); research in `research/`.
- Layout: `src/` extension host code, `src/readers/` pure Copilot data readers (no `vscode` import), `src/shared/` types shared by host and webview, `src/webview/` the panel page and its cards.

## Harness

- Copilot's router for this repo is `.github/copilot-instructions.md`.

## Hard Rules

- All tests are allowed in this repo: the main session and every agent run any test without asking first (`npm test`, `npm run compile`, `node --test` on any test file, and the isolated VS Code checks).

## Working Method

- A finished task is committed and pushed through git-flow, which closes its GitHub issue.
