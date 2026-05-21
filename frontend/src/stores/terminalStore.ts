import { create } from 'zustand';

type TerminalStatus = 'starting' | 'running' | 'exited' | 'error';
type TerminalBackend = 'pty' | 'pipe';

interface TerminalRecord {
  terminalId: string;
  sessionId?: string;
  status: TerminalStatus;
  cwd: string;
  shell: string;
  backend: TerminalBackend | null;
  output: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: string | null;
  updatedAt: number;
}

interface TerminalState {
  terminals: Record<string, TerminalRecord>;
  markStarting: (terminalId: string, sessionId: string) => void;
  markStarted: (input: {
    terminalId: string;
    sessionId: string;
    cwd: string;
    shell: string;
    backend: TerminalBackend;
  }) => void;
  appendOutput: (terminalId: string, data: string) => void;
  markExited: (terminalId: string, exitCode: number | null, signal: string | null) => void;
  markError: (terminalId: string, message: string, sessionId?: string) => void;
  clearOutput: (terminalId: string) => void;
}

const MAX_TERMINAL_BUFFER_CHARS = 220_000;

export const useTerminalStore = create<TerminalState>((set) => ({
  terminals: {},

  markStarting: (terminalId, sessionId) =>
    set((state) => ({
      terminals: {
        ...state.terminals,
        [terminalId]: {
          ...state.terminals[terminalId],
          terminalId,
          sessionId,
          status: 'starting',
          cwd: state.terminals[terminalId]?.cwd ?? '',
          shell: state.terminals[terminalId]?.shell ?? 'shell',
          backend: state.terminals[terminalId]?.backend ?? null,
          output: state.terminals[terminalId]?.output ?? '',
          error: null,
          updatedAt: Date.now(),
        },
      },
    })),

  markStarted: ({ terminalId, sessionId, cwd, shell, backend }) =>
    set((state) => ({
      terminals: {
        ...state.terminals,
        [terminalId]: {
          ...state.terminals[terminalId],
          terminalId,
          sessionId,
          status: 'running',
          cwd,
          shell,
          backend,
          output: state.terminals[terminalId]?.output ?? '',
          error: null,
          updatedAt: Date.now(),
        },
      },
    })),

  appendOutput: (terminalId, data) => {
    if (!data) return;
    set((state) => {
      const current = state.terminals[terminalId];
      const output = trimTerminalOutput(`${current?.output ?? ''}${data}`);
      return {
        terminals: {
          ...state.terminals,
          [terminalId]: {
            terminalId,
            sessionId: current?.sessionId,
            status: current?.status ?? 'running',
            cwd: current?.cwd ?? '',
            shell: current?.shell ?? 'shell',
            backend: current?.backend ?? null,
            output,
            exitCode: current?.exitCode,
            signal: current?.signal,
            error: current?.error,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  markExited: (terminalId, exitCode, signal) =>
    set((state) => {
      const current = state.terminals[terminalId];
      const exitLine = `\r\n[terminal] exited${exitCode !== null ? ` with code ${exitCode}` : ''}${signal ? ` (${signal})` : ''}\r\n`;
      return {
        terminals: {
          ...state.terminals,
          [terminalId]: {
            terminalId,
            sessionId: current?.sessionId,
            status: 'exited',
            cwd: current?.cwd ?? '',
            shell: current?.shell ?? 'shell',
            backend: current?.backend ?? null,
            output: trimTerminalOutput(`${current?.output ?? ''}${exitLine}`),
            exitCode,
            signal,
            error: null,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  markError: (terminalId, message, sessionId) =>
    set((state) => {
      const current = state.terminals[terminalId];
      const errorLine = `\r\n[terminal error] ${message}\r\n`;
      return {
        terminals: {
          ...state.terminals,
          [terminalId]: {
            terminalId,
            sessionId: sessionId ?? current?.sessionId,
            status: 'error',
            cwd: current?.cwd ?? '',
            shell: current?.shell ?? 'shell',
            backend: current?.backend ?? null,
            output: trimTerminalOutput(`${current?.output ?? ''}${errorLine}`),
            exitCode: current?.exitCode,
            signal: current?.signal,
            error: message,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  clearOutput: (terminalId) =>
    set((state) => {
      const current = state.terminals[terminalId];
      if (!current) return state;
      return {
        terminals: {
          ...state.terminals,
          [terminalId]: {
            ...current,
            output: '',
            error: null,
            updatedAt: Date.now(),
          },
        },
      };
    }),
}));

function trimTerminalOutput(output: string): string {
  if (output.length <= MAX_TERMINAL_BUFFER_CHARS) return output;
  return output.slice(output.length - MAX_TERMINAL_BUFFER_CHARS);
}
