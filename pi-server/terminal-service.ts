import { spawn as spawnPipe, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { getSession } from './mock-agent.js';
import type { WsServerMsg } from './types.js';
import type { IDisposable, IPty } from '@homebridge/node-pty-prebuilt-multiarch';

type SendMessage = (message: WsServerMsg) => void;

interface TerminalSize {
  cols?: number;
  rows?: number;
}

interface TerminalBase {
  id: string;
  sessionId: string;
  cwd: string;
  shell: string;
  backend: 'pty' | 'pipe';
}

interface PtyTerminalProcess extends TerminalBase {
  backend: 'pty';
  pty: IPty;
  disposables: IDisposable[];
}

interface PipeTerminalProcess extends TerminalBase {
  backend: 'pipe';
  child: ChildProcessWithoutNullStreams;
}

type TerminalProcess = PtyTerminalProcess | PipeTerminalProcess;

export class TerminalService {
  private readonly terminals = new Map<string, TerminalProcess>();

  constructor(private readonly sendMessage: SendMessage) {}

  async start(sessionId: string, terminalId?: string, size: TerminalSize = {}): Promise<void> {
    const session = getSession(sessionId);
    if (!session) {
      this.sendMessage({ type: 'terminal_error', sessionId, message: 'Session not found.' });
      return;
    }

    const id = sanitizeTerminalId(terminalId) || createTerminalId(sessionId);
    const existing = this.terminals.get(id);
    if (existing) {
      this.resize(id, size.cols, size.rows);
      this.sendStarted(existing);
      return;
    }

    const cwd = resolveWorkspacePath(session.projectPath);
    const ptyModule = await loadPtyModule();

    if (ptyModule) {
      try {
        const command = resolveShellCommand('pty');
        const pty = ptyModule.spawn(command.file, command.args, {
          name: 'xterm-256color',
          cols: normalizeDimension(size.cols, 100),
          rows: normalizeDimension(size.rows, 30),
          cwd,
          env: createTerminalEnv(),
          ...(process.platform === 'win32' ? { useConpty: true } : {}),
        });
        const disposables: IDisposable[] = [];
        const terminal: PtyTerminalProcess = {
          id,
          sessionId,
          cwd,
          shell: command.label,
          backend: 'pty',
          pty,
          disposables,
        };
        this.terminals.set(id, terminal);

        disposables.push(pty.onData((data) => this.sendOutput(id, data)));
        disposables.push(pty.onExit(({ exitCode, signal }) => {
          this.terminals.delete(id);
          for (const disposable of disposables) {
            disposable.dispose();
          }
          this.sendMessage({
            type: 'terminal_exited',
            terminalId: id,
            exitCode,
            signal: typeof signal === 'number' ? String(signal) : signal ?? null,
          });
        }));

        this.sendStarted(terminal);
        return;
      } catch (err) {
        this.sendMessage({
          type: 'terminal_output',
          terminalId: id,
          data: `\r\n[terminal] Native PTY unavailable, falling back to limited pipe mode: ${formatError(err)}\r\n`,
        });
      }
    }

    this.startPipeTerminal(sessionId, id, cwd);
  }

  input(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      this.sendMessage({ type: 'terminal_error', terminalId, message: 'Terminal is not running.' });
      return;
    }

    if (terminal.backend === 'pty') {
      terminal.pty.write(data);
      return;
    }

    if (!terminal.child.stdin.writable) {
      this.sendMessage({ type: 'terminal_error', terminalId, message: 'Terminal input is closed.' });
      return;
    }

    terminal.child.stdin.write(data);
  }

  resize(terminalId: string, cols?: number, rows?: number): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal || terminal.backend !== 'pty') return;

    try {
      terminal.pty.resize(normalizeDimension(cols, terminal.pty.cols), normalizeDimension(rows, terminal.pty.rows));
    } catch (err) {
      this.sendMessage({ type: 'terminal_error', terminalId, message: `Unable to resize terminal: ${formatError(err)}` });
    }
  }

  stop(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;

    if (terminal.backend === 'pty') {
      terminal.pty.kill();
    } else {
      terminal.child.kill();
    }
  }

  stopSession(sessionId: string): void {
    for (const terminal of this.terminals.values()) {
      if (terminal.sessionId === sessionId) {
        if (terminal.backend === 'pty') {
          terminal.pty.kill();
        } else {
          terminal.child.kill();
        }
      }
    }
  }

  dispose(): void {
    for (const terminal of this.terminals.values()) {
      if (terminal.backend === 'pty') {
        for (const disposable of terminal.disposables) {
          disposable.dispose();
        }
        terminal.pty.kill();
      } else {
        terminal.child.kill();
      }
    }
    this.terminals.clear();
  }

  private startPipeTerminal(sessionId: string, id: string, cwd: string): void {
    const command = resolveShellCommand('pipe');

    try {
      const child = spawnPipe(command.file, command.args, {
        cwd,
        env: createTerminalEnv(),
        windowsHide: true,
      });

      const terminal: PipeTerminalProcess = {
        id,
        sessionId,
        cwd,
        shell: command.label,
        backend: 'pipe',
        child,
      };
      this.terminals.set(id, terminal);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (data) => this.sendOutput(id, String(data)));
      child.stderr.on('data', (data) => this.sendOutput(id, String(data)));
      child.on('error', (err) => {
        this.sendMessage({
          type: 'terminal_error',
          sessionId,
          terminalId: id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
      child.on('exit', (code, signal) => {
        this.terminals.delete(id);
        this.sendMessage({
          type: 'terminal_exited',
          terminalId: id,
          exitCode: code,
          signal,
        });
      });

      this.sendStarted(terminal);
    } catch (err) {
      this.sendMessage({
        type: 'terminal_error',
        sessionId,
        terminalId: id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private sendStarted(terminal: TerminalProcess): void {
    this.sendMessage({
      type: 'terminal_started',
      sessionId: terminal.sessionId,
      terminalId: terminal.id,
      cwd: terminal.cwd,
      shell: terminal.shell,
      backend: terminal.backend,
    });
  }

  private sendOutput(terminalId: string, data: string): void {
    if (!data) return;
    this.sendMessage({ type: 'terminal_output', terminalId, data });
  }
}

let ptyLoadAttempted = false;
let cachedPtyModule: typeof import('@homebridge/node-pty-prebuilt-multiarch') | null = null;

async function loadPtyModule(): Promise<typeof import('@homebridge/node-pty-prebuilt-multiarch') | null> {
  if (ptyLoadAttempted) return cachedPtyModule;
  ptyLoadAttempted = true;
  try {
    cachedPtyModule = await import('@homebridge/node-pty-prebuilt-multiarch');
  } catch (err) {
    console.warn('[PiServer] Native PTY unavailable:', formatError(err));
    cachedPtyModule = null;
  }
  return cachedPtyModule;
}

function resolveShellCommand(mode: 'pty' | 'pipe'): { file: string; args: string[]; label: string } {
  const configured = process.env.PI_AGENT_TERMINAL_SHELL?.trim();
  if (configured) return { file: configured, args: [], label: path.basename(configured) };

  if (process.platform === 'win32') {
    if (mode === 'pty') {
      return {
        file: 'powershell.exe',
        args: ['-NoLogo', '-ExecutionPolicy', 'Bypass'],
        label: 'PowerShell',
      };
    }
    return {
      file: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoExit',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; [Console]::InputEncoding = [Text.UTF8Encoding]::UTF8',
      ],
      label: 'PowerShell',
    };
  }

  const shell = process.env.SHELL || '/bin/bash';
  return { file: shell, args: ['-l'], label: path.basename(shell) };
}

function createTerminalEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: process.env.TERM || 'xterm-256color',
    COLORTERM: process.env.COLORTERM || 'truecolor',
    FORCE_COLOR: process.env.FORCE_COLOR || '1',
  };
}

function resolveWorkspacePath(projectPath: string): string {
  const resolved = path.resolve(projectPath || process.cwd());
  try {
    if (existsSync(resolved) && statSync(resolved).isDirectory()) return resolved;
  } catch {
    // Fall through to process cwd.
  }
  return process.cwd();
}

function createTerminalId(sessionId: string): string {
  return `terminal-${sessionId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeTerminalId(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9._:-]{1,120}$/.test(trimmed) ? trimmed : null;
}

function normalizeDimension(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(2, Math.min(500, Math.floor(value)))
    : fallback;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
