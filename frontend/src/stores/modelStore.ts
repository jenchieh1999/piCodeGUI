import { create } from 'zustand';
import type { ModelInfo, ProviderInfo, ThinkingLevel } from '../types';

interface ModelState {
  // Current model
  currentModel: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
  setCurrentModel: (model: ModelInfo) => void;
  setThinkingLevel: (level: ThinkingLevel) => void;
  
  // Available providers & models
  providers: ProviderInfo[];
  availableModels: ModelInfo[];
  setProviders: (providers: ProviderInfo[]) => void;
  
  // Model cycling list
  scopedModels: Array<{ modelId: string; provider: string }>;
  setScopedModels: (models: Array<{ modelId: string; provider: string }>) => void;
  
  // Loading states
  isLoadingModels: boolean;
  setLoadingModels: (loading: boolean) => void;
}

export const useModelStore = create<ModelState>((set) => ({
  currentModel: null,
  thinkingLevel: 'off',
  setCurrentModel: (model) => set({ currentModel: model }),
  setThinkingLevel: (level) => set({ thinkingLevel: level }),
  
  providers: [],
  availableModels: [],
  setProviders: (providers) => {
    const models = providers.flatMap((p) => p.models);
    set({ providers, availableModels: models });
  },
  
  scopedModels: [],
  setScopedModels: (models) => set({ scopedModels: models }),
  
  isLoadingModels: false,
  setLoadingModels: (loading) => set({ isLoadingModels: loading }),
}));
