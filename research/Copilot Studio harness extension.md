# Would a harness extension make sense for Copilot Studio?

Date: 2026-11-04. Question from the owner: would an extension like Claude Harness (one place to see and edit the harness, keep it lean, see from session transcripts what each part did and cost) also make sense for Copilot Studio?

## Verdict

Yes as an idea, no as part of the GitHub Copilot extension. Copilot Studio has a real harness (agent definition) and real session records, but they live in the cloud and in Dataverse, not as local files on the developer's disk. That inverts the Claude Harness architecture ("reads the transcripts already written, no hook, proxy or server"). A Copilot Studio extension would be a Dataverse and Power Platform client with its own sign-in, its own data pipeline and its own audience (makers and admins, not developers working in a repo). It should be its own, later extension, and it should not block the GitHub Copilot one. Cheapest first step: do not build anything yet, but keep the planned GitHub Copilot extension's data layer (per-part usage, never-ran lists, size and duplicate findings) provider-agnostic so a Copilot Studio source can plug in later.

## What corresponds to what

| Claude Harness | Copilot Studio |
| --- | --- |
| Harness = memory, rules, agents, skills, commands, hooks, MCP, plugins as local files | Agent definition: standard harness has topics, tools, triggers, knowledge, settings as `.mcs.yml`; GitHub Copilot harness has instructions, knowledge, tools, skills, model, connected agents, memory, edited on the Build tab; Customer Conversation harness adds sub-agents and topic skills |
| Local files edited in VS Code | Cloud objects in Dataverse. The official VS Code extension clones them to YAML and syncs them back |
| Session JSONL transcripts on disk | `conversationtranscript` table in Dataverse (and a 28-day copy in Copilot Studio storage), CSV download of the last 28 days, Monitor tab sessions list with a credits column |
| Cost from token counts and list prices | Copilot Credits per session (Monitor, History, Power Platform admin center consumption reports by environment, agent or user) |
| Never-ran lists (which agent, skill, hook fired) | Not offered; topic usage and tool use panels exist in Monitor, but per-component "never invoked" lists across a tenant do not |

## What Microsoft ships already

- **Copilot Studio extension for VS Code** (ms-CopilotStudio.vscode-copilotstudio, GA since January 2026, more than 17,000 installs per [Visual Studio Magazine](https://visualstudiomagazine.com/Articles/2026/01/22/Copilot-Studio-Extension-for-VS-Code-Goes-GA.aspx)). It clones, edits with IntelliSense and validation, previews, gets and applies changes, reattaches an agent to another environment and manages remote knowledge files ([overview](https://learn.microsoft.com/microsoft-copilot-studio/visual-studio-code-extension-overview), [sync](https://learn.microsoft.com/microsoft-copilot-studio/visual-studio-code-extension-synchronization)). It is the "edit everything in one place" half, per agent, one clone at a time. It has no transcripts, no credits, no usage, no cross-agent view. Its pages are scoped to the standard harness in their notes; I found no statement that GitHub Copilot harness agents (Build tab, skills, memory) are cloneable the same way.
- **Monitor and Evaluate tabs** in the portal: sessions, outcomes, tool use, knowledge source use, generated-answer quality, credits per session, History with a per-turn Activity panel ([monitor](https://learn.microsoft.com/microsoft-copilot-studio/agents-experience/analytics-overview)). Retention is short: 28 days in Studio, Dataverse retention configurable ([transcript controls](https://learn.microsoft.com/microsoft-copilot-studio/admin-transcript-controls)). Preview chats do not reach the Sessions list, and the Preview credits counter disagrees with History (own live observation, 2026-10-22).
- **Power Platform admin center**: capacity and Copilot Credits consumption by environment, agent or user ([capacity](https://learn.microsoft.com/power-platform/admin/manage-copilot-studio-copilot-credits-capacity)).
- **Copilot Agent Kit** (Power CAT, Power Apps and Dataverse based): Agent Inventory (tenant-wide agents, features, knowledge, auth), Agent Insights Hub (App Insights telemetry, tool execution, credits), Conversation KPIs (aggregated, kept indefinitely, Power BI samples), Conversation Analyzer (LLM prompts over transcripts), Agent Debugger (routing, variables, actions per conversation from transcript trace events), Agent Review Tool (anti-pattern checks), test automation ([overview](https://learn.microsoft.com/microsoft-copilot-studio/guidance/kit-overview)). This is the closest functional match to Claude Harness's session and hygiene side, but it is a model-driven app in a tenant, not an editor, and it needs an install, roles and flows.

## Third parties

Search found no VS Code extension that shows Copilot Studio transcripts, credits or usage. What exists: the unofficial "Copilot Studio Development Bundle" by coatsy (an extension pack, 230 installs, experimental, [Marketplace](https://marketplace.visualstudio.com/items?itemName=coatsy.copilot-studio-development-bundle)), and web services such as Openlayer that poll the ConversationTranscript table (written only after the session ends, up to about 30 minutes later). Not exhaustive: I did not crawl the Marketplace listing itself.

## What would be missing, i.e. the opening

1. One view over many agents and environments, with the agent definition and its usage side by side (the official extension is one clone at a time; the Kit is portal-only).
2. Cost attributed to a component (which topic, tool, skill or connected agent cost the credits) rather than to a session. Credits are reported per session, agent and user, so component attribution would have to be inferred from transcript trace events.
3. Never-ran and oversized lists for topics, tools, skills and knowledge sources.
4. Retention beyond 28 days without a tenant-side install: only possible by pulling Dataverse transcripts into a local cache.
5. The "continue in an agent terminal with the context filled in" step, driving GitHub Copilot or Claude Code over the cloned definition. Microsoft names this scenario itself ("agent-driven development") but ships no UI for it.

## Why it does not fit into the planned GitHub Copilot extension

- **Data source differs in kind**: Copilot reads local files and local logs; Copilot Studio needs authenticated Dataverse and Power Platform calls (the transcripts table, `bot` and `botcomponents`, admin center data), roles such as Bot Transcript Viewer, and per-environment URLs. Different security model, no offline mode, interactive sign-in.
- **Freshness and privacy**: transcripts hold end-user conversations of customers; a local cache raises compliance questions the Copilot extension never has.
- **Audience**: makers, Power Platform admins and CoE teams, many of whom do not use VS Code daily; the Kit and the admin center already serve them.
- **Moving target**: Copilot Studio has three harnesses with different definition shapes, billing and features, and the GitHub Copilot harness is still preview in places. The agent definition format of that harness is not yet documented as files.
- **Naming trap**: the "GitHub Copilot harness" in Copilot Studio is not the GitHub Copilot service. A single extension covering both would confuse users and the Marketplace listing.

## Reuse that does make sense

The planned extension's parts transfer: the sidebar-plus-editor shell, the cost and usage page, never-ran findings and hygiene findings, plan and cost views. Only the readers differ (YAML clone plus Dataverse instead of `.github` files plus VS Code logs). A shared internal reader interface in the planned extension is enough; a shared package is not needed and not wanted.

## Open points I could not settle

- Whether the GitHub Copilot harness agent definition is cloneable by the official extension (docs notes say standard harness only).
- Whether the transcripts' trace events carry per-step credit figures; a live Dataverse read of one `conversationtranscript` row would settle it (needs a sign-in, not done).
- Current install count of the official extension (17,000+ in January 2026 is the latest figure found).
