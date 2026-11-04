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
