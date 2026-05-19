import { create } from 'zustand';
import type { RuntimeInfo } from '../types';

interface ConnectionState {
  isConnected: boolean;
  reconnectAttempts: number;
  lastError: string | null;
  runtimeInfo: RuntimeInfo | null;
  setConnected: (connected: boolean) => void;
  setReconnectAttempts: (attempts: number) => void;
  setLastError: (error: string | null) => void;
  setRuntimeInfo: (runtimeInfo: RuntimeInfo | null) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  isConnected: false,
  reconnectAttempts: 0,
  lastError: null,
  runtimeInfo: null,
  setConnected: (isConnected) => set((s) => ({ isConnected, lastError: isConnected ? null : s.lastError })),
  setReconnectAttempts: (reconnectAttempts) => set({ reconnectAttempts }),
  setLastError: (lastError) => set({ lastError }),
  setRuntimeInfo: (runtimeInfo) => set({ runtimeInfo }),
}));
