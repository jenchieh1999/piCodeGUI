import { create } from 'zustand';
import { piApi } from '../api/client';
import type { AgentConfig, AgentInput } from '../types';

interface AgentState {
  agents: AgentConfig[];
  loading: boolean;
  loadAgents: () => Promise<void>;
  createAgent: (input: AgentInput) => Promise<AgentConfig>;
  updateAgent: (id: string, input: AgentInput) => Promise<AgentConfig>;
  deleteAgent: (id: string) => Promise<void>;
  toggleAgent: (id: string, enabled: boolean) => Promise<void>;
}

const AGENTS_KEY = 'pi-desktop-agent-configs';

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: loadAgents(),
  loading: false,

  loadAgents: async () => {
    set({ loading: true });
    try {
      const result = await piApi.getAgents();
      saveAgents(result.agents);
      set({ agents: result.agents });
    } finally {
      set({ loading: false });
    }
  },

  createAgent: async (input) => {
    const cleaned = cleanInput(input);
    const result = await piApi.createAgent(cleaned);
    const agents = await fetchAgentsOrFallback(mergeAgent(result.agent, get().agents));
    saveAgents(agents);
    set({ agents });
    return result.agent;
  },

  updateAgent: async (id, input) => {
    const result = await piApi.updateAgent(id, cleanInput(input));
    const optimisticAgents = mergeAgent(result.agent, get().agents).map((agent) =>
      agent.id === result.agent.id
        ? agent
        : {
            ...agent,
            channelIds: agent.channelIds.filter((channelId) => !result.agent.channelIds.includes(channelId)),
          }
    );
    const agents = await fetchAgentsOrFallback(optimisticAgents);
    saveAgents(agents);
    set({ agents });
    return result.agent;
  },

  deleteAgent: async (id) => {
    await piApi.deleteAgent(id);
    const agents = get().agents.filter((agent) => agent.id !== id);
    saveAgents(agents);
    set({ agents });
  },

  toggleAgent: async (id, enabled) => {
    await get().updateAgent(id, { enabled });
  },
}));

function mergeAgent(agent: AgentConfig, agents: AgentConfig[]): AgentConfig[] {
  const exists = agents.some((item) => item.id === agent.id);
  if (!exists) return [agent, ...agents];
  return agents.map((item) => item.id === agent.id ? agent : item);
}

async function fetchAgentsOrFallback(fallback: AgentConfig[]): Promise<AgentConfig[]> {
  try {
    return (await piApi.getAgents()).agents;
  } catch {
    return fallback;
  }
}

function cleanInput(input: AgentInput): AgentInput {
  return {
    name: cleanOptional(input.name),
    description: input.description?.trim() ?? '',
    systemPrompt: input.systemPrompt?.trim() ?? '',
    enabled: input.enabled,
    modelProvider: cleanOptional(input.modelProvider),
    modelId: cleanOptional(input.modelId),
    projectPath: cleanOptional(input.projectPath),
    channelIds: dedupe(input.channelIds ?? []),
  };
}

function cleanOptional(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next || undefined;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function loadAgents(): AgentConfig[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(AGENTS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAgentLike);
  } catch {
    return [];
  }
}

function saveAgents(agents: AgentConfig[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
}

function isAgentLike(value: unknown): value is AgentConfig {
  if (!value || typeof value !== 'object') return false;
  const agent = value as Partial<AgentConfig>;
  return typeof agent.id === 'string'
    && typeof agent.name === 'string'
    && typeof agent.description === 'string'
    && typeof agent.systemPrompt === 'string'
    && typeof agent.enabled === 'boolean'
    && Array.isArray(agent.channelIds)
    && typeof agent.createdAt === 'number'
    && typeof agent.updatedAt === 'number';
}
