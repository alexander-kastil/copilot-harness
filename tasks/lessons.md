# Lessons

## Install advice for an extension comes from the specialist's hard rules

**Pattern:** After the first sideload the main thread told the owner to run "Developer: Reload Window" before it had read `vscode-extension:specialist`, whose hard rule says a reload ends the Claude Code session running in that window. The advice was corrected two installs later.
**Rule:** Before installing or advising on an install, read the specialist's file; every install report says "open a new VS Code window", never reload, and every sideload bumps the version (`sideload.ps1 -Repo`).
**Replaces:** none

## A runtime dependency ships only when .vscodeignore allow-lists it

**Pattern:** The scaffold excluded `node_modules/**`; once the readers imported `yaml` and `jsonc-parser` the packaged extension failed at activation with "Cannot find module 'yaml'". Test temp folders (`out/test-tmp/`) and `CLAUDE.md` also landed in the VSIX.
**Rule:** Allow-list a runtime package's files in `.vscodeignore` in the same change that first imports it (as Claude Harness does), and read the folder counts of every new VSIX (`unzip -l <vsix>` or the skill's `vsix-audit.py`) before installing it.
**Replaces:** none

## A git line runs through git-flow only when it holds nothing else

**Pattern:** `rm -f x.vsix && git add -A && git commit ... && git push` ran as raw git because the flow mod leaves mixed commands untouched; the push then failed with a GitHub 500, and the mod's `git push` answered "nothing to push" while the branch stood one commit ahead.
**Rule:** Keep a commit or push command free of any other work; after a failed push check `git status -sb` before trusting the mod's answer.
**Replaces:** none

## Solution: issues from a handoff are closed by hand after each push

**Problem:** The plan's tasks were GitHub issues named in the handoff, not in the owner's prompt, so git-flow recorded none of them and closed nothing ("git-flow should close them when done").
**Solution:** After each accepted task is pushed, `gh issue close N --comment` naming the commit, what was verified and what was not; the phase issue closes once its sub-issues are closed. A GraphQL "Something went wrong" from `gh issue close` was transient both times and a retry a few seconds later closed the issue.
**Evidence:** #6 to #13 and phase #2 closed with comments on 2026-11-04.
**Reuse:** Every run over issues listed in a plan or handoff.
**Replaces:** none

## Solution: contract-first waves with the coordinator's files on disk

**Problem:** Eight Foundation issues for one extension, at most three agents, every feature touching the same message union, card list, activation function and stylesheet.
**Solution:** Before each wave the main thread wrote the contract as code (`src/shared/session-model.ts`, `src/readers/paths.ts`, `src/readers/scan-index.ts`; then `src/readers/all-sessions.ts`, `src/session-service.ts`, `HarnessPanel.onMessage`), plus a rules file per wave naming the shared files as additive-only with a re-read before each edit; the card registry takes one import line and one entry line per feature. Three named agents kept their context across waves through SendMessage.
**Evidence:** All eight issues and the overview page landed with no lost edit in the shared files; the suite grew to 65 of 65 passing.
**Reuse:** Phases #3 to #5 of this plan.
**Replaces:** none

## The isolated VS Code still reads the real %APPDATA%

**Pattern:** `isolated-vscode.ps1` swaps `USERPROFILE` and `HOME` only, so a reader of `AppData\Roaming\Code` saw the owner's real chat sessions in the "empty" test instance (useful for real-data checks, wrong for empty-state checks).
**Rule:** For an empty-state check, override `APPDATA` in the instance as well; for a real-data check, say in the report that the data is the owner's.
**Replaces:** none

## Plain CDP clicks do not reach into a webview

**Pattern:** @logs could not drive the quota entry of the credits card with CDP clicks; the round trip passed once it used the vscode-extension skill's `webview-steps.mjs` and `probe-webview.mjs`.
**Rule:** A brief that asks for a webview interaction check names those two scripts.
**Replaces:** none

## Solution: the extension icon is Claude Harness's hub with the Copilot glyph inside

**Problem:** The owner rejected the generated goggles icon: "try some thing like the claude harness icon with a copilot in the middle".
**Solution:** Hand-written SVG from `claude-harness/media/harness.svg` (four ring nodes, a hub ring) on a dark tile, the Primer Octicons `copilot-24` glyph filled white inside the hub ring, rendered with headless Chrome at 1024 and downscaled to 256; its MIT notice went into `THIRD_PARTY_NOTICES`. A first draft without the hub ring read as a skull and crossbones.
**Evidence:** "This is good take it" on the first hub version (2026-11-04).
**Reuse:** Any further icon or mark of this extension; the rule now lives in image-artist's ui-icon-marks leaf.
**Replaces:** none

## A commit through git-flow can push a peer session's unfinished manifest

**Pattern:** While the #38 session had an uncommitted `package.json` with a new version, `git add media/icon.png && git commit && git push` made the flow mod record that version change as this session's task: it pushed the peer's `package.json`, `package-lock.json` and `CHANGELOG.md` and left the staged icon out. The icon then went in by pathspec, and the peer was told.
**Rule:** While a peer session works in this checkout (skill `list-peers`), read `git show --stat HEAD` after every flow push; when a peer holds an uncommitted manifest change, ship only this session's file by pathspec and message the peer before pushing.
**Replaces:** none

## Solution: preview from a clean worktree while a peer has unfinished work

**Problem:** The owner wanted to see the new icon installed while the #38 session's half-done BYOK code sat in the working tree, and `sideload.ps1` (plain or `-Snapshot`) would have packaged it.
**Solution:** `git worktree add --detach` of HEAD under `D:\claude-scratch\`, copy in only the changed file, `npm ci`, `vsce package`, `code --install-extension --force`, then `git worktree remove --force`.
**Evidence:** The owner approved the icon from that install; the peer's files stayed out of the package.
**Reuse:** Any preview install while another session edits the checkout; deterministic (to-do for `sideload.ps1 -Only` in the marketplace's vscode-extension tasks).
**Replaces:** none

## Solution: plan a third-party extension port from an inventory and the VS Code log

**Problem:** "we want to integrate the functionality of this extension in our own and make it menu driven" (oai-compatible-copilot into Copilot Harness) needed what moves, what cannot, and whether the preview API it declares blocks a sideloaded VSIX.
**Solution:** A port inventory read from the upstream source (features with files and line counts, runtime dependencies, proposals used, settings and SecretStorage keys, licence), and the proposal question settled from the window log ("CANNOT USE these API proposals 'chatProvider'" while the bridge's models still register) plus the shipped extension host code. Keys never move between extensions; settings import in place.
**Evidence:** The owner answered the plan with "implement it"; one specialist run built it (72 tests pass, a model added through the menu showed under "Copilot Harness" in the chat model picker without a reload, in an isolated VS Code). The chat request path stayed untested there because that window had no GitHub sign-in.
**Reuse:** The next port of a third-party VS Code extension into one of ours; the BYOK facts are in the github-copilot plugin's gh-copilot-byok leaves `vscode-chat` and `vscode-native`.
**Replaces:** none

## Solution: Marketplace publish parity with claude-harness needs approval, not data

**Problem:** "make sure we can publish this project to the marketplace just like D:\git-projects\claude-harness ... do you need any data from me".
**Solution:** One `vscode-extension:specialist` run copied claude-harness's `azure-pipelines.yml` (service connection `sc-vscode-marketplace`, workload identity, publishes only from `deploy` with `vsce publish --azure-credential`), added `homepage`, `bugs` and `author.email`, and excluded `.mcp.json`, `.time/**`, `tasks/**` and the pipeline file from the VSIX. The brief asked for "every piece of data or access only the owner can provide" with the exact names claude-harness uses, so the report answered the owner's question directly: no PAT, only approval to create the pipeline, authorize the connection for it and create `deploy`.
**Evidence:** `vsce package` exit 0 (one bundling warning, 176 files); `vsce ls` lists only README, LICENSE, CHANGELOG, notices, `media/`, the tokenizer asset, `out/src` and the three runtime dependencies; the diffs were read on disk. The ADO steps wait for the owner's yes.
**Reuse:** Any further extension of the `integrations-at` publisher; the playbook now says Steps 1 to 7 are per publisher.
**Replaces:** none

## A whole package.json in one read trips the lookup guard

**Pattern:** The first comparison `cat` both repos' `package.json`; this repo's BYOK settings schema alone is several hundred lines, so the call passed the agentic-orchestration guard's 20,000 characters and the next lookup was refused.
**Rule:** Compare manifests by the fields needed (`node -p "const p=require('./package.json');({version:p.version,publisher:p.publisher,repository:p.repository,homepage:p.homepage,bugs:p.bugs,scripts:p.scripts})"`), never the whole file; a wider comparison goes to the specialist or a fact gatherer.
**Replaces:** none

## Solution: the window rule held only once a guard enforced it

**Problem:** The owner asked six times in one evening for test windows at 1280 px, never full screen and without the Explorer ("enforce it!!!!"); briefs, repo `CLAUDE.md` rules and mid-run messages did not stop agents' windows opening at 2560 px with the Explorer.
**Solution:** A background guard on the main thread, harvested as the vscode-extension skill's `scripts/window-guard.mjs` (with `window-size.ps1`): every 2 seconds it restores and resizes each isolated window under `claude-scratch` to 1280 x 800 through Win32 and presses Ctrl+B only while the side bar shows the Explorer. VS Code's DevTools endpoint has no `Browser.getWindowForTarget`, closing any side bar broke the Source Control shot, and resizing the UI suite's windows would break its size tests, so it skips `uiroot`.
**Evidence:** Its log corrected windows at 2560, 1500, 1455, 971, 864 and 853 px and closed the Explorer several times; no window complaint followed after it started at 19:56.
**Reuse:** Start it at the beginning of every run that opens isolated VS Code windows; deterministic, scripted.
**Replaces:** none

## Hung agent calls with no process behind them

**Pattern:** Three times an agent's Bash call (an `npm test` to a log, a launch with `sleep 20` and `place-window.ps1`, a `Read` of an image) stayed pending 6 to 22 minutes with no process running and no output file growing.
**Rule:** When the probe shows a pending call and a process check finds nothing behind it, `TaskStop` the agent and `SendMessage` it to resume with what it was doing and to run launches in the background or under a timeout; never wait for a second tick.
**Replaces:** none
