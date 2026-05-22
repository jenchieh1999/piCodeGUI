# Pi Agent Agents Chatroom Optimization Plan - 2026-05-22

## 1. Goal

This plan continues the Agents Room work after the P2 model-first runner and the first Markdown readability pass.

The next goal is to make Agents Room feel less like a static demo and more like a controllable multi-agent workbench:

- The user can explicitly choose fast/deep models for a room.
- Evidence can be filtered, copied, inserted into chat, and traced back to workspace files.
- Long discussions remain readable and performant.
- The current stage-based runner can evolve into real sub-agent execution without breaking the existing room data model.

## 2. Current Gaps

### 2.1 Model Control

The server already supports `quickModel` and `deepModel` in `AgentRoomConfig`, but the desktop UI does not expose them when creating or editing a room. This causes two practical issues:

- A room may use an automatically selected model instead of the model the user expects.
- The user cannot intentionally pair a fast model for research tasks with a stronger model for synthesis and final reports.

### 2.2 Evidence Board

The Evidence Board now renders Markdown and no longer truncates content, but it still lacks task-oriented controls:

- No filter between final report, evidence, risks, claims, and counterclaims.
- No per-artifact copy action.
- No per-artifact insert-to-chat action.
- Workspace evidence does not expose source file actions clearly enough.

### 2.3 Real Sub-Agent Execution

Current execution is stage-based:

1. Moderator plan.
2. Group research.
3. Group synthesis.
4. Debate rounds.
5. Neutral review.
6. Final report.

This is useful, but not yet a true sub-agent room. In a true room, each group should have multiple sub-agents with independent tasks, outputs, failures, and dependency edges.

## 3. Immediate Implementation Scope

This round should implement low-risk, high-value improvements:

### P0-A: Room Model Selection

Add quick/deep model selectors to:

- New room dialog.
- Edit room dialog.

Behavior:

- `quickModel` is used for moderator and research-style quick tasks.
- `deepModel` is used for synthesis, debate, neutral review, and final report.
- If `deepModel` is empty, the server continues to fall back to `quickModel`.
- Existing rooms without explicit models continue to use automatic model ranking.

### P0-B: Evidence Board Operations

Add Evidence Board controls:

- Filter chips: All, Final, Evidence, Claims, Risks.
- Copy artifact content.
- Insert artifact content into the active chat.
- Open workspace source in the file panel when the artifact has a workspace citation.

Server-side workspace evidence should also emit per-file workspace citations instead of only one generic project citation.

## 4. Real Sub-Agent Optimization Plan

### P1: Sub-Agent Task Graph Schema

Extend the runner without changing the room UI contract too aggressively:

```ts
interface AgentRoomNode {
  id: string;
  group: 'left' | 'right' | 'neutral' | 'moderator';
  agentRole: 'Searcher' | 'Reader' | 'Organizer' | 'Lead' | 'Debater' | 'FactJudge' | 'RiskJudge' | 'Synthesizer';
  stage: AgentRoomStage;
  dependsOn: string[];
  purpose: 'quick' | 'deep';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
}
```

The existing `AgentRoomTaskData` can carry most of this with small additions later: `nodeId`, `dependsOn`, `retryCount`, `sourceArtifactIds`, and `error`.

### P2: Parallel Internal Group Work

For each perspective group:

- `Searcher`: find workspace/web/history candidates.
- `Reader`: summarize selected material.
- `Organizer`: deduplicate and convert summaries into evidence cards.
- `Argument Builder`: form the strongest group argument.
- `Counterargument Builder`: prepare anticipated rebuttals.
- `Lead`: produce the final group position after all dependencies complete.

Execution rule:

- Searcher/Reader/Organizer can run in parallel where dependencies allow.
- Lead must wait for all group cards.
- Debate must wait for both group Leads.

### P3: Neutral Review Sub-Team

Split the neutral group into:

- `Fact Judge`: evidence reliability and missing facts.
- `Logic Judge`: reasoning quality and contradictions.
- `Risk Judge`: cost, reversibility, failure mode.
- `Product Judge`: user impact and adoption friction.
- `Final Synthesizer`: final Markdown report.

The final report should cite the strongest artifacts from both sides and the review artifacts.

### P4: User Intervention

Add runtime controls:

- Pause room.
- Ask one group to add evidence.
- Re-run only one stage.
- Re-run only final synthesis.
- Insert a user note into the room transcript.

### P5: Checkpoint Resume

Persist node-level checkpoints:

- Completed nodes are not re-run by default.
- Running nodes become `interrupted` after server restart.
- User can resume, restart, or mark interrupted nodes as skipped.

## 5. Acceptance Checklist

This round is accepted when:

- A new Agents Room can be created with explicit quick/deep models.
- Editing an existing room can update quick/deep models.
- The created room payload stores `quickModel` and `deepModel`.
- Evidence Board can filter artifact types.
- Each artifact can be copied and inserted into chat.
- Workspace evidence can request opening its first source file in the file panel.
- Frontend typecheck and full build pass.

## 6. Progress Update - 2026-05-22

### Completed

- P0-A model selection is implemented in the new-room and edit-room dialogs.
- P0-B evidence operations are implemented: filtering, copy, insert-to-chat, and workspace source opening.
- Workspace evidence now uses per-file workspace citations when snippets are collected.
- The room runner now records task graph metadata on tasks: `nodeId`, `purpose`, `dependsOn/dependencies`, `sourceArtifactIds`, and `retryCount`.
- The UI now shows a compact task graph strip under the stage timeline so the room feels less like a black-box run.
- P2 internal group work is now represented as concrete task nodes:
  - `Searcher` and `Reader` run as the fast-model research pair.
  - `Organizer` depends on Searcher/Reader and produces organized evidence.
  - `Argument Builder` and `Counterargument Builder` run from the organized evidence.
  - `Lead` depends on both builders and becomes the group's debate-ready position.
- P3 neutral review is now split into separate judge nodes:
  - `Fact Judge`
  - `Logic Judge`
  - `Risk Judge`
  - `Product Judge`
  - `Final Synthesizer`
- The task graph strip now keeps all task nodes visible in a horizontal scroll instead of hiding older nodes after the first dozen.
- Prompt generation now includes role-specific instructions for Searcher, Reader, Organizer, Argument Builder, Counterargument Builder, Fact Judge, Logic Judge, Risk Judge, Product Judge, and Final Synthesizer.

### Clarified UI Semantics

- `Workspace` means: search the current project/workspace files and add matching snippets to the evidence board. This path is implemented.
- `Web` means: allow future external webpage search and web evidence. This path is still planned, so the launcher marks it as pending instead of implying that real browsing is already available.

### Remaining

- P2/P3 are still model-call based inside the Pi server runner. They are now real task nodes with dependency metadata, but they are not yet isolated OS/process-level sub-agents with separate workspaces.
- The current parallelism is conservative: group Searcher/Reader pairs and neutral judges can execute concurrently, but the runner still shares one room transcript and one persisted store.
- P4 user intervention is now partially implemented:
  - Add user note to the room transcript.
  - Ask either perspective group to add supplemental evidence.
  - Re-run only the final synthesis after a final report exists.
- P4 still needs true pause/resume and targeted stage re-run controls.
- P5 checkpoint resume remains future work.

## 7. Progress Update - 2026-05-22, Runner P2/P3 Landing

### Implemented Files

- `pi-server/agent-room-service.ts`
  - Added `runAgentRoomV2` and routed new runs to it.
  - Added `completeGroupInternalWork` for group-level Searcher/Reader/Organizer/Argument/Counterargument/Lead nodes.
  - Added `completeNeutralReviewSubTeam` for Fact/Logic/Risk/Product judge nodes.
  - Added reusable `completeAgentArtifactTask` to keep future real-subagent replacement simple.
  - Preserved old runner code as a fallback reference while the new runner is validated.
- `pi-server/agent-room-prompts.ts`
  - Added role-specific prompt focus instructions.
  - Added clean Chinese task instructions so Chinese rooms no longer rely on corrupted fallback prompt labels.
- `frontend/src/components/agents-room/AgentsRoomView.tsx`
  - Task graph strip now shows all nodes through horizontal scroll.

### Acceptance Notes

- A new run should now show more granular task nodes instead of only the old coarse stages.
- Debate waits for both group Lead nodes.
- Final Synthesizer waits for all four neutral judge nodes.
- Evidence Board continues to receive artifacts from each node, so users can filter/copy/insert more intermediate reasoning.

## 8. Progress Update - 2026-05-22, P4 Intervention Landing

### Implemented

- Added a unified intervention API:
  - `POST /api/agent-rooms/:roomId/interventions`
  - Actions: `add_note`, `add_evidence`, `rerun_final`
- Added frontend intervention controls under the task graph:
  - `Add note`: stores a user note as part of the room transcript.
  - `{group} evidence`: creates an `Evidence Scout` task for the chosen perspective group.
  - `Refresh final`: creates a new final report artifact without rerunning the whole room.
- Intervention outputs reuse the existing event stream:
  - `agent_room_message_added`
  - `agent_room_task_started`
  - `agent_room_task_completed`
  - `agent_room_artifact_added`
  - `agent_room_final_report_ready`
- The room transcript now includes user notes when later model calls are generated, so interventions can steer supplemental evidence and refreshed final summaries.

### Current Limitations

- `add_evidence` and `rerun_final` are still Pi-server tasks, not isolated external sub-agent processes.
- `Refresh final` is disabled while a run is active to avoid racing with the main runner.
- True pause/resume still needs node-level checkpoint persistence and a resumable executor.

## 9. Progress Update - 2026-05-22, Web Search Landing

### Implemented

- Added a formal server-side web search adapter:
  - `pi-server/web-search-service.ts`
  - Providers: Tavily, Brave Search API, Exa
  - Default provider selection: `PI_AGENT_WEB_SEARCH_PROVIDER=auto`
- Added REST endpoints:
  - `GET /api/web-search/status`
  - `POST /api/web-search/search`
- Agents Room now runs a `Web Searcher` task during planning when `useWebSearch=true`.
- Successful web results are converted into a Markdown `Web search evidence` artifact.
- Each result is persisted as a `kind: web` citation, so the Evidence Board can trace the source URL.
- If no provider key is configured, the room creates a visible `Web search unavailable` artifact instead of silently skipping browsing.
- The launcher Web toggle is now enabled and no longer marked as pending.

### Provider Configuration

Supported environment variables:

```powershell
$env:TAVILY_API_KEY="..."
$env:BRAVE_SEARCH_API_KEY="..."
$env:EXA_API_KEY="..."
$env:PI_AGENT_WEB_SEARCH_PROVIDER="auto"
```

Pi Agent scoped aliases:

```powershell
$env:PI_AGENT_TAVILY_API_KEY="..."
$env:PI_AGENT_BRAVE_SEARCH_API_KEY="..."
$env:PI_AGENT_EXA_API_KEY="..."
```

Disable switch:

```powershell
$env:PI_AGENT_WEB_SEARCH_DISABLED="1"
```

### References

- Tavily Search API: https://docs.tavily.com/documentation/api-reference/endpoint/search
- Brave Web Search API: https://api-dashboard.search.brave.com/app/documentation/web-search/query
- Exa Search API: https://exa.ai/docs/reference/search
- Google Custom Search JSON API: https://developers.google.com/custom-search/v1/overview
