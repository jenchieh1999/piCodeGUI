# Pi Agent Agents Chatroom P2 Progress - 2026-05-21

## Summary

This update moves Agent Room from the P1 mock-only runner to a P2 model-first execution chain with local fallback. The goal is to make the feature useful with real configured models while keeping the whole room flow stable when no model, API key, or network path is available.

## Implemented

### Model Completion Layer

Added `pi-server/agent-room-model-service.ts`.

- Uses the existing Pi Agent `AuthStorage`, `ModelRegistry`, and `@earendil-works/pi-ai complete` path.
- Supports `quick` and `deep` routing.
- Supports room-level `quickModel` and `deepModel`.
- Supports environment overrides:
  - `PI_AGENT_ROOM_QUICK_PROVIDER`
  - `PI_AGENT_ROOM_QUICK_MODEL`
  - `PI_AGENT_ROOM_DEEP_PROVIDER`
  - `PI_AGENT_ROOM_DEEP_MODEL`
  - existing `PI_AGENT_FAST_PROVIDER`
  - existing `PI_AGENT_FAST_MODEL`
- Normalizes Zhipu/Z.ai/BigModel `glm-*` model IDs to lowercase, including `glm-5.1`.
- Returns provider, model ID, generated text, and token usage.

### Prompt Templates

Added `pi-server/agent-room-prompts.ts`.

- Moderator prompt for problem framing and plan.
- Researcher prompt for left/right evidence cards.
- Lead prompt for group synthesis.
- Debater prompt for round-based response.
- Neutral review prompt for fact, risk, and reversibility judgment.
- Final report prompt for decision-ready markdown output.
- Automatically asks for Simplified Chinese or English based on the user question.

### Agent Room Runner

Reworked `pi-server/agent-room-service.ts`.

- Replaced `runMockAgentRoom` with `runAgentRoom`.
- Every stage now tries model generation first:
  - Moderator plan.
  - Left/right research cards.
  - Left/right lead summaries.
  - Multi-round debate.
  - Neutral risk review.
  - Final report.
- If model calls fail, the run falls back to readable local text and still completes.
- If the error is clearly "no configured model/auth/API key", the run stops retrying model calls for later stages.
- Final run usage now accumulates real model token usage; fallback-only runs record zero usage.
- Artifacts can now cite `model` as their source kind.
- Old mojibake mock text was replaced by readable Chinese/English fallback text.

### Workspace Evidence Bridge

Added the first P3 bridge into the P2 runner.

- If a room has `sessionId` and `useWorkspaceSearch` enabled, Agent Room now searches the active workspace for likely relevant files.
- It reads small text snippets from selected files and creates a `工作区证据摘录` artifact.
- The workspace artifact is added before left/right research, so model prompts can use it as context.
- Workspace evidence is clearly marked as local snippets, not final verified facts.

### Evidence Board Source Badges

Updated `frontend/src/components/agents-room/AgentsRoomView.tsx`.

- Artifact cards now show a compact source badge.
- Model-generated artifacts show `provider/model`.
- Local fallback artifacts show `Fallback`.
- Workspace evidence shows `Workspace`.

### Type Changes

- `pi-server/types.ts`
  - `AgentRoomCitationData.kind` now supports `model`.
- `frontend/src/types/index.ts`
  - `AgentRoomCitation.kind` now supports `model`.

## Verification

- `npm.cmd run typecheck`: passed.
- `npm.cmd run build:server`: passed.
- `npm.cmd run build:frontend`: passed.

## Remaining P2/P3 Work

1. Add a UI for selecting quick/deep models per Agent Room.
2. Show model/fallback source badges in the Evidence Board.
3. Upgrade workspace search from filename-based snippets to content-aware retrieval and ranking.
4. Split each group into Searcher, Reader, Organizer, and Lead sub-agents.
5. Add checkpoint resume, budget preview, and external-search permission cards.
6. Add a smoke test for creating a room, starting a run, receiving a final report, and cancelling a run.
