# Changelog

## [Unreleased]

## [0.2.0] - 2026-11-04

### Added

- Split Providers and Models pages: The Models and Providers pages are split, and the Overview has a "Providers" tile beside "PAYG models"
- Sessions pages and AI features: I built the Sessions page and the session detail page
- Update .vscodeignore, azure-pipelines.yml
- Update src
- Update src, test
- Update test
- Drop CLAUDE.md, add six tiles: Copilot Memory now shows as its own kind, "Copilot Memory", in the nav (global and per repository), the
- Claude Harness UI style and AI actions: The element page now opens a Copilot Memory item's url in the browser and no longer opens or
- Drop CLAUDE.md, add six tiles: Skills are now split into two kinds, and both show in the Overview tiles, the nav (global and per
- Update CLAUDE.md
- Update docs
- README feature screenshots: All 11 images are in and linked once each in README.md: the hero under # Copilot Harnes
- Update src, tasks
- AI Commit features and settings migration: Commit messages, PR messages and the one-time migration all work

### Fixed

- Claude Harness UI style and AI actions: A skill's element page now has a "Used in" tab, and the isolated VS Code check shows the fixture



## [0.2.0] - 2026-11-04

### Added

- Research on whether a VS Code extension like Claude Harness exists for GitHub Copilot, and a Copilot harness for this repo based on the Agentic Software Engineering class.
- Implementation plan as GitHub issues #1 to #37 (four phases, 32 tasks), and research on a separate Copilot Studio harness extension.
- Copilot Harness extension scaffold: webview panel with a typed message contract, vsce packaging, GitHub Actions CI, logo and a status bar item that opens the panel (#6).
- Inventory of every Copilot customization kind across the workspace, the VS Code user profile, ~/.copilot and installed plugins (#7).
- Readers for Copilot Chat debug logs and the OpenTelemetry trace database, opened read-only through node:sqlite (#9).
- Reader for VS Code chat session files across every installed VS Code variant, with incremental rescans (#8).
- Reader for Copilot CLI session state: workspace, repository, branch, models, tool, subagent and skill counts, and every usage snapshot kept raw (#10).
- CLAUDE.md for this repo: all tests, all deletes and starting and stopping processes are allowed.
- AGENTS.md pointer check like Claude Harness: a skill, agent or path named in backticks in a repo's AGENTS.md (and the files it imports) that does not exist gets a warning, a CodeLens and quick fixes (repoint to the closest name, drop the line), refreshed on save; nested AGENTS.md files and their `@` imports are checked too, and an AGENTS.md element page shows the folder it applies to and whether VS Code chat loads it under chat.useAgentsMdFile and chat.useNestedAgentsMdFiles.
- Used in tab on a skill's element page: the Copilot CLI sessions that called the skill (from its skill.invoked events), with the repository, the session, the uses and a 7-day strip; the CLI reader now keeps the skill names, not only the count.
- Kind pages and element pages in the Claude Harness style: an Overview kind tile opens a searchable, filterable list of every element of that kind, and a row, a nav item or a Recently changed item opens the element page with its summary, content, frontmatter and tools, plus Copilot CLI actions (Edit, Try it, Open Copilot in a repository).
- Setup check card: the status of chat sessions, debug logs, the trace database and Copilot CLI data, with in-card buttons that switch on the opt-in sources (#11).
- Credits card: reconciles local credit figures per source against the quota used, read from GitHub on request or typed in, and names the source of every figure (#13).
- Snapshot store: every Copilot session kept as numbers only in the extension's storage, so sessions stay listed after Copilot deletes their files, with a size cap setting (#12).
- Overview page like Claude Harness's: header with the asset and repository counts, one tile per customization kind, Last sessions, Repositories and Recently changed tabs with search, and the cards below.
- BYOK models in Copilot Chat, ported from OAI Compatible Provider for Copilot and managed through the menu "Copilot Harness: Manage BYOK Models": providers, models and keys, five API modes, import from OAI Compatible, import and export, token meter and commit message generation (#38).
- Left nav like Claude Harness's: toolbar, "Search the harness", a Copilot region with the Copilot kinds and counts, a Repositories region (open folders first, each with its Sessions and kinds, Add repo and Remove repo), region and group folds, a rail with counts (Alt+Shift+B), keyboard navigation and saved state.
- Six more Overview tiles and nav kinds read from disk: Subagents, Tools, Agentic Workflows, GitHub Actions / CI, Environment and Governance & permissions.
- Instructions in two kinds, General (copilot-instructions.md, .copilot-instructions.md, AGENTS.md at any depth, CLAUDE.md) and Stack-specific (applyTo files and the folders chat.instructionsFilesLocations names); plugin folders from chat.pluginLocations, ~/.mcp.json, a plugin's mcp.json and com.github.copilot folder, and hooks declared in an agent file are read too.
- Copilot Memory as its own kind: per repository with a GitHub remote, whether memory is switched on and a link to its Copilot Memory settings page on GitHub (the memories stay on GitHub), plus .github/copilot-memories.jsonl when present.
- Skills in two kinds: Deterministic (the folder has a scripts/ file and SKILL.md names a path under scripts/) and Orchestration (every other skill).
- Hooks installed as .github/hooks/<name>/hooks.json are read, and an *.instructions.md whose applyTo matches every file counts as General instead of Stack-specific.
- PAYG models tile in the overview's kind tiles and a PAYG models page: the BYOK providers, models and global settings with whether an API key is set (never its value), and everything the Manage BYOK Models menu does as page controls and confirm cards, keys typed in VS Code's password box.
- README.md in the root like Claude Harness's: quick start, why, the main features, one section per feature, each with a 1280 px screenshot from made-up data.
- Sessions page and session detail page like Claude Harness's: a session search with filter chips, a detail page with credits, tokens, subagent diagrams and subagent card, rows in the overview and the nav open it, and Analyze and Continue session start Copilot CLI in a terminal with a model picker.
- Billing switch in the session cost card like Claude Harness's: the session's credits as a share of a Copilot plan's monthly allowance (Pro, Pro+, Business, Enterprise) or as dollars on pay as you go, remembered in the panel and started on the plan GitHub's quota reading points to.
- Free option on the Billing switch: shows the session in AI credits, because GitHub publishes no AI-credit allowance for Copilot Free.
- Release build: azure-pipelines.yml packages the VSIX on every run and publishes it to the Visual Studio Marketplace from the deploy branch.
- Marketplace-ready package: author, homepage and issue links in package.json, and a .vscodeignore that keeps session files, tasks and the pipeline out of the VSIX.
- Plugin Hunter like Claude Harness's: a button in the Overview tab bar opens a page where Copilot CLI proposes a plugin from your skills and agents in a chat, you edit the card, and Create writes it into a marketplace folder of yours in the Copilot plugin format and installs it with `copilot plugin install`.
- Marketplace support like Claude Harness: a Marketplaces section in the nav, Marketplace health and a page per marketplace read from Copilot CLI and VS Code, Sync plugin and Sync all, rename a local marketplace, and enable, disable and uninstall a plugin, each behind a confirm card.
- Command bar on the pages, ported from Claude Harness: every command sits in a labelled box (Page, File, Model and so on), and the AI commands sit at the right end of the bar.
- Commit messages: the built-in prompt follows AI Commit's guide with an optional gitmoji setting, and a diff is cut at a file boundary at 24000 characters instead of 5000.
- Pull request messages: "Generate Pull Request Message with BYOK Model" writes a title and description from the commits and diff of the branch against its base, from the Source Control title bar and the command palette, with a prompt and a base branch setting beside the commit message settings.
- Migration of the AI Commit settings: once, the ai-commit.* provider, model, temperature, language and system prompt become a BYOK provider and model selected for commit messages, and the API key moves into SecretStorage.

### Changed

- The PAYG models page is split in two: Models (per provider, with Add models) and a new Providers page (providers, global settings, import and export), and the Overview gets a Providers tile.
- The app icon is the Claude Harness node mark with the Copilot octicon in the centre node, replacing the goggles logo.
- Last sessions shows a name on Copilot CLI rows: the session's name, or its summary when it has none, first line only.

### Fixed

- CLI reader counts a missing events.jsonl as no events, not a skipped line (#10).
- The VSIX ships its yaml and jsonc-parser runtime dependencies.

