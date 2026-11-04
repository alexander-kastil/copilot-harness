# Changelog

## [Unreleased]

### Added

- Research on whether a VS Code extension like Claude Harness exists for GitHub Copilot, and a Copilot harness for this repo based on the Agentic Software Engineering class.
- Implementation plan as GitHub issues #1 to #37 (four phases, 32 tasks), and research on a separate Copilot Studio harness extension.
- Copilot Harness extension scaffold: webview panel with a typed message contract, vsce packaging, GitHub Actions CI, logo and a status bar item that opens the panel (#6).
- Inventory of every Copilot customization kind across the workspace, the VS Code user profile, ~/.copilot and installed plugins (#7).
- Readers for Copilot Chat debug logs and the OpenTelemetry trace database, opened read-only through node:sqlite (#9).
- Reader for VS Code chat session files across every installed VS Code variant, with incremental rescans (#8).
- Reader for Copilot CLI session state: workspace, repository, branch, models, tool, subagent and skill counts, and every usage snapshot kept raw (#10).
- CLAUDE.md for this repo: all tests are allowed.

### Fixed

- Fix: CLI reader counts a missing events.jsonl as no events, not a skipped line (#10)

