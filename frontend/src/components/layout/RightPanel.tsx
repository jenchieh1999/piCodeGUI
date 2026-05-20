import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { useModelStore } from '../../stores/modelStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { piApi } from '../../api/client';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type {
  ChatMessage,
  ModelInfo,
  RightPanelType,
  Session,
  TokenUsage,
  WorkspaceChangedFile,
  WorkspaceDiffResult,
  WorkspaceReadFileResult,
  WorkspaceStatusResult,
  WorkspaceTreeEntry,
  WorkspaceTreeResult,
  WorkspaceWriteFileResult,
  WsServerMessage,
} from '../../types';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Check,
  Code2,
  Copy,
  ExternalLink,
  File,
  Files,
  Folder,
  FolderOpen,
  FolderTree,
  GitBranch,
  GitCompare,
  MessageSquarePlus,
  PanelBottomClose,
  PanelBottomOpen,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '../shared/utils';
import { MarkdownFileReader } from '../markdown/MarkdownFileReader';
import {
  createWorkspaceFileDragPayload,
  hasWorkspaceFileDragPayload,
  readWorkspaceFileDragPayload,
  setWorkspaceFileDragData,
  type WorkspaceFileDragPayload,
} from '../../lib/workspaceDrag';

const PANEL_CONFIG: Record<RightPanelType & string, { icon: typeof GitCompare; labelKey: TranslationKey }> = {
  changes: { icon: GitCompare, labelKey: 'rightPanel.changes' },
  files: { icon: Files, labelKey: 'rightPanel.files' },
  tree: { icon: FolderTree, labelKey: 'rightPanel.sessionTree' },
  usage: { icon: Activity, labelKey: 'rightPanel.tokenUsage' },
  terminal: { icon: TerminalIcon, labelKey: 'rightPanel.terminal' },
};

interface RightPanelProps {
  type: RightPanelType;
}

type PreviewTarget = {
  kind: 'file' | 'diff';
  path: string;
};

type PreviewTab =
  | { id: string; state: 'loading'; target: PreviewTarget; title: string }
  | { id: string; state: 'file'; target: PreviewTarget; title: string; data: WorkspaceReadFileResult }
  | { id: string; state: 'diff'; target: PreviewTarget; title: string; data: WorkspaceDiffResult }
  | { id: string; state: 'error'; target: PreviewTarget; title: string; error: string };

type LineSelection = {
  start: number;
  end: number;
};

type PreviewTabCloseScope = 'current' | 'others' | 'left' | 'right' | 'all';

const STATUS_META: Record<WorkspaceChangedFile['status'], { label: string; className: string }> = {
  modified: { label: 'M', className: 'border-pi-warning/40 bg-pi-warning/10 text-pi-warning' },
  added: { label: 'A', className: 'border-pi-success/40 bg-pi-success/10 text-pi-success' },
  deleted: { label: 'D', className: 'border-pi-error/40 bg-pi-error/10 text-pi-error' },
  renamed: { label: 'R', className: 'border-pi-accent/40 bg-pi-accent/10 text-pi-accent' },
  untracked: { label: 'U', className: 'border-pi-muted/40 bg-pi-muted/10 text-pi-muted' },
  copied: { label: 'C', className: 'border-pi-accent/40 bg-pi-accent/10 text-pi-accent' },
  type_changed: { label: 'T', className: 'border-pi-muted/40 bg-pi-muted/10 text-pi-muted' },
  unknown: { label: '?', className: 'border-pi-muted/40 bg-pi-muted/10 text-pi-muted' },
};

const WORKSPACE_PREVIEW_DEFAULT_RATIO = 0.45;
const WORKSPACE_PREVIEW_MIN_RATIO = 0.22;
const WORKSPACE_PREVIEW_MAX_RATIO = 0.72;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function RightPanel({ type }: RightPanelProps) {
  const { t } = useI18n();
  const setRightPanel = useUIStore((s) => s.setRightPanel);
  const activeSessionId = useChatStore((s) => s.activeSessionId);

  if (!type) return null;

  const config = PANEL_CONFIG[type];
  const Icon = config?.icon ?? GitCompare;
  const label = config ? t(config.labelKey) : type;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center justify-between border-b border-pi-border/70 px-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={14} className="text-pi-muted flex-shrink-0" />
          <span className="text-xs font-medium text-pi-text truncate">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          {Object.entries(PANEL_CONFIG).map(([key, { icon: PIcon, labelKey }]) => {
            const itemLabel = t(labelKey);
            return (
            <button
              key={key}
              onClick={() => setRightPanel(type === key ? null : (key as RightPanelType))}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-lg border transition-colors hover:bg-pi-bg-hover',
                type === key ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-accent' : 'border-transparent text-pi-dim'
              )}
              title={itemLabel}
            >
              <PIcon size={13} />
            </button>
          );
          })}
          <div className="w-px h-4 bg-pi-border mx-1" />
          <button
            onClick={() => setRightPanel(null)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
            title={t('rightPanel.closePanel')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!activeSessionId ? (
        <PanelEmpty icon={Icon} message={t('rightPanel.openSessionToSee', { panel: label.toLowerCase() })} />
      ) : type === 'changes' || type === 'files' ? (
        <WorkspaceBrowser sessionId={activeSessionId} initialMode={type} />
      ) : type === 'tree' ? (
        <SessionTreePanel sessionId={activeSessionId} />
      ) : type === 'usage' ? (
        <UsagePanel sessionId={activeSessionId} />
      ) : type === 'terminal' ? (
        <TerminalPanel sessionId={activeSessionId} />
      ) : null}
    </div>
  );
}

export function TerminalPanel({
  sessionId,
  compact = false,
  showDockControl = true,
}: {
  sessionId: string;
  compact?: boolean;
  showDockControl?: boolean;
}) {
  const { t } = useI18n();
  const session = useChatStore((s) => s.sessions.find((item) => item.id === sessionId));
  const addToast = useUIStore((s) => s.addToast);
  const terminalDockOpen = useUIStore((s) => s.terminalDockOpen);
  const setTerminalDockOpen = useUIStore((s) => s.setTerminalDockOpen);
  const terminalId = useMemo(() => `terminal:${sessionId}`, [sessionId]);
  const terminalRecord = useTerminalStore((s) => s.terminals[terminalId]);
  const markTerminalStarting = useTerminalStore((s) => s.markStarting);
  const markTerminalError = useTerminalStore((s) => s.markError);
  const clearTerminalOutput = useTerminalStore((s) => s.clearOutput);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const status = terminalRecord?.status ?? 'starting';
  const cwd = terminalRecord?.cwd || session?.projectPath || '';
  const backend = terminalRecord?.backend ?? null;

  const writeTerminal = useCallback((value: string) => {
    terminalRef.current?.write(value);
  }, []);

  const startTerminal = useCallback(() => {
    const current = useTerminalStore.getState().terminals[terminalId];
    if (!current || current.status === 'exited' || current.status === 'error') {
      markTerminalStarting(terminalId, sessionId);
    }
    const terminal = terminalRef.current;
    const sent = piApi.send({
      type: 'terminal_start',
      sessionId,
      terminalId,
      cols: terminal?.cols,
      rows: terminal?.rows,
      replay: !current?.output,
    });
    if (!sent) {
      const message = 'Pi server is not connected; terminal cannot start.';
      markTerminalError(terminalId, message, sessionId);
      writeTerminal(`\r\n[terminal error] ${message}\r\n`);
      addToast({ type: 'error', message: 'Pi server is not connected; terminal cannot start.' });
    }
  }, [addToast, markTerminalError, markTerminalStarting, sessionId, terminalId, writeTerminal]);

  const openStandaloneTerminal = useCallback(async () => {
    if (!window.piDesktop) {
      addToast({ type: 'warning', message: t('rightPanel.terminal.standaloneOnlyDesktop') });
      return;
    }
    try {
      await window.piDesktop.openTerminalWindow(sessionId);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : String(err), duration: 6000 });
    }
  }, [addToast, sessionId, t]);

  const stopTerminal = useCallback(() => {
    piApi.send({ type: 'terminal_stop', terminalId });
  }, [terminalId]);

  const fitTerminal = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;
    try {
      fitAddon.fit();
      piApi.send({
        type: 'terminal_resize',
        terminalId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    } catch {
      // xterm fit can throw while the panel is hidden or has zero size.
    }
  }, [terminalId]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const styles = getComputedStyle(document.documentElement);
    const terminal = new XTerm({
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: 'block',
      convertEol: true,
      fontFamily: styles.getPropertyValue('--font-mono').trim() || 'JetBrains Mono, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 10000,
      theme: {
        background: '#00000000',
        foreground: styles.getPropertyValue('--pi-tool-output').trim() || '#c0c0d0',
        cursor: styles.getPropertyValue('--pi-accent').trim() || '#00aaff',
        selectionBackground: styles.getPropertyValue('--pi-selected-bg').trim() || '#2d2d38',
        black: '#000000',
        red: styles.getPropertyValue('--pi-error').trim() || '#ff4444',
        green: styles.getPropertyValue('--pi-success').trim() || '#00cc66',
        yellow: styles.getPropertyValue('--pi-warning').trim() || '#ffaa00',
        blue: styles.getPropertyValue('--pi-accent').trim() || '#00aaff',
        magenta: '#ff66cc',
        cyan: '#00ccff',
        white: styles.getPropertyValue('--pi-text').trim() || '#e0e0e8',
        brightBlack: styles.getPropertyValue('--pi-dim').trim() || '#55555a',
        brightRed: styles.getPropertyValue('--pi-error').trim() || '#ff4444',
        brightGreen: styles.getPropertyValue('--pi-success').trim() || '#00cc66',
        brightYellow: styles.getPropertyValue('--pi-warning').trim() || '#ffaa00',
        brightBlue: styles.getPropertyValue('--pi-accent').trim() || '#00aaff',
        brightMagenta: '#ff66cc',
        brightCyan: '#00ffff',
        brightWhite: '#ffffff',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const dataDisposable = terminal.onData((data) => {
      const sent = piApi.send({ type: 'terminal_input', terminalId, data });
      if (!sent) {
        const message = 'Pi server is not connected; input was not sent.';
        markTerminalError(terminalId, message, sessionId);
        terminal.write(`\r\n[terminal error] ${message}\r\n`);
      }
    });

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
        const selection = terminal.getSelection();
        if (selection) void navigator.clipboard?.writeText(selection).catch(() => undefined);
        return false;
      }
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') {
        void navigator.clipboard?.readText()
          .then((text) => {
            if (text) piApi.send({ type: 'terminal_input', terminalId, data: text });
          })
          .catch(() => undefined);
        return false;
      }
      return true;
    });

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(fitTerminal);
    });
    resizeObserver.observe(element);

    window.requestAnimationFrame(() => {
      const snapshot = useTerminalStore.getState().terminals[terminalId];
      if (snapshot?.output) {
        terminal.write(snapshot.output);
      } else {
        terminal.write('[terminal] starting...\r\n');
      }
      fitTerminal();
      terminal.focus();
      startTerminal();
    });

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fitTerminal, startTerminal, terminalId]);

  useEffect(() => {
    return piApi.onMessage((message: WsServerMessage) => {
      if (message.type === 'terminal_started' && message.terminalId === terminalId) {
        fitTerminal();
        terminalRef.current?.focus();
      }

      if (message.type === 'terminal_output' && message.terminalId === terminalId) {
        writeTerminal(message.data);
      }

      if (message.type === 'terminal_exited' && message.terminalId === terminalId) {
        writeTerminal(`\r\n[terminal] exited${message.exitCode !== null ? ` with code ${message.exitCode}` : ''}${message.signal ? ` (${message.signal})` : ''}\r\n`);
      }

      if (
        message.type === 'terminal_error'
        && (message.terminalId === terminalId || (!message.terminalId && message.sessionId === sessionId))
      ) {
        writeTerminal(`\r\n[terminal error] ${message.message}\r\n`);
      }
    });
  }, [fitTerminal, sessionId, terminalId, writeTerminal]);

  const restartTerminal = () => {
    stopTerminal();
    clearTerminalOutput(terminalId);
    terminalRef.current?.reset();
    terminalRef.current?.write('[terminal] restarting...\r\n');
    window.setTimeout(startTerminal, 180);
  };

  const statusTone =
    status === 'running'
      ? 'bg-pi-success/10 text-pi-success'
      : status === 'starting'
        ? 'bg-pi-warning/10 text-pi-warning'
        : status === 'error'
          ? 'bg-pi-error/10 text-pi-error'
          : 'bg-pi-bg-tertiary text-pi-dim';
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      <div className={cn('border-b border-pi-border/70 px-3', compact ? 'py-1.5' : 'py-2')}>
        <div className="flex items-center gap-2">
          <TerminalIcon size={13} className="text-pi-accent" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-pi-text">{session?.projectName ?? t('rightPanel.terminal')}</div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-pi-dim">{cwd || session?.projectPath || t('rightPanel.terminal.workspace')}</div>
          </div>
          <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase', statusTone)}>
            {terminalStatusLabel(status, t)}
          </span>
          {backend && (
            <span className="rounded border border-pi-border/70 bg-pi-bg-tertiary/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-pi-dim">
              {backend}
            </span>
          )}
          {showDockControl && (
            <button
              type="button"
              onClick={() => setTerminalDockOpen(!terminalDockOpen)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-lg border transition-colors hover:bg-pi-bg-hover',
                terminalDockOpen ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-accent' : 'border-pi-border/70 bg-pi-bg-tertiary/60 text-pi-dim hover:text-pi-text'
              )}
              title={terminalDockOpen ? t('rightPanel.terminal.hideDock') : t('rightPanel.terminal.showDock')}
            >
              {terminalDockOpen ? <PanelBottomClose size={13} /> : <PanelBottomOpen size={13} />}
            </button>
          )}
          <button
            type="button"
            onClick={() => void openStandaloneTerminal()}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-pi-border/70 bg-pi-bg-tertiary/60 text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
            title={t('rightPanel.terminal.openStandalone')}
          >
            <ExternalLink size={13} />
          </button>
        </div>
        <div className={cn('flex items-center gap-1', compact ? 'mt-1.5' : 'mt-2')}>
          <button
            type="button"
            onClick={() => terminalRef.current?.clear()}
            className="h-7 rounded-lg border border-pi-border/70 bg-pi-bg-tertiary/60 px-2 text-[10px] text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
          >
            {t('rightPanel.terminal.clear')}
          </button>
          <button
            type="button"
            onClick={restartTerminal}
            className="h-7 rounded-lg border border-pi-border/70 bg-pi-bg-tertiary/60 px-2 text-[10px] text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
          >
            {t('rightPanel.terminal.restart')}
          </button>
          <button
            type="button"
            onClick={() => {
              fitTerminal();
              terminalRef.current?.focus();
            }}
            className="h-7 rounded-lg border border-pi-border/70 bg-pi-bg-tertiary/60 px-2 text-[10px] text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
          >
            {t('rightPanel.terminal.fit')}
          </button>
          <button
            type="button"
            onClick={stopTerminal}
            className="ml-auto flex h-7 items-center gap-1 rounded-lg border border-pi-border/70 bg-pi-bg-tertiary/60 px-2 text-[10px] text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-error"
          >
            <Square size={10} />
            {t('rightPanel.terminal.stop')}
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="pi-xterm min-h-0 flex-1 overflow-hidden px-2 py-2"
        onMouseDown={() => terminalRef.current?.focus()}
      />

      {!compact && (
        <div className="border-t border-pi-border/70 px-3 py-2 text-[10px] text-pi-dim">
          {t('rightPanel.terminal.help')}
        </div>
      )}
    </div>
  );
}

function UsagePanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const messages = useChatStore((s) => s.getMessages(sessionId));
  const session = useChatStore((s) => s.sessions.find((item) => item.id === sessionId));
  const globalCurrentModel = useModelStore((s) => s.currentModel);
  const availableModels = useModelStore((s) => s.availableModels);
  const globalThinkingLevel = useModelStore((s) => s.thinkingLevel);
  const currentModel = useMemo(
    () => modelForSession(session, availableModels, globalCurrentModel),
    [availableModels, globalCurrentModel, session]
  );
  const thinkingLevel = session?.thinkingLevel ?? globalThinkingLevel;

  const usage = useMemo(() => {
    const total = messages.reduce<TokenUsage>((acc, message) => addUsage(acc, message.usage), zeroUsage());
    const messagesWithUsage = messages.filter((message) => message.usage);
    const toolCalls = messages.reduce((count, message) => count + (message.toolCalls?.length ?? 0), 0);
    const estimatedContext = estimateContextTokens(messages);
    const contextWindow = currentModel?.contextWindow ?? 0;
    const contextPercent = contextWindow > 0 ? Math.min(100, (estimatedContext / contextWindow) * 100) : 0;

    return {
      total,
      messagesWithUsage,
      toolCalls,
      estimatedContext,
      contextWindow,
      contextPercent,
      byRole: {
        user: messages.filter((message) => message.role === 'user').length,
        assistant: messages.filter((message) => message.role === 'assistant').length,
        tool: messages.filter((message) => message.role === 'tool').length,
      },
    };
  }, [currentModel?.contextWindow, messages]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-3 py-3 border-b border-pi-border space-y-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-pi-text truncate">{session?.title ?? t('rightPanel.currentSession')}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-pi-dim">
            <span>{currentModel ? `${currentModel.provider}/${currentModel.name}` : t('rightPanel.noModelSelected')}</span>
            <span>{t('rightPanel.thinking', { level: thinkingLevel })}</span>
          </div>
        </div>

        <div className="rounded-md border border-pi-border bg-pi-bg-secondary p-2">
          <div className="flex items-center justify-between text-[10px] text-pi-dim">
            <span>{t('rightPanel.estimatedContext')}</span>
            <span>
              {formatCompactNumber(usage.estimatedContext)}
              {usage.contextWindow > 0 ? ` / ${formatCompactNumber(usage.contextWindow)}` : ''}
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-pi-bg-tertiary overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                usage.contextPercent > 85
                  ? 'bg-pi-error'
                  : usage.contextPercent > 65
                    ? 'bg-pi-warning'
                    : 'bg-pi-accent'
              )}
              style={{ width: `${usage.contextPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3 border-b border-pi-border">
        <UsageMetric label={t('rightPanel.usage.input')} value={formatCompactNumber(usage.total.input)} />
        <UsageMetric label={t('rightPanel.usage.output')} value={formatCompactNumber(usage.total.output)} />
        <UsageMetric label={t('rightPanel.usage.cacheRead')} value={formatCompactNumber(usage.total.cacheRead)} />
        <UsageMetric label={t('rightPanel.usage.cost')} value={formatCostValue(usage.total.cost)} />
      </div>

      <div className="px-3 py-3 border-b border-pi-border">
        <div className="grid grid-cols-4 gap-2">
          <UsageMetric label={t('rightPanel.usage.turns')} value={String(usage.messagesWithUsage.length)} compact />
          <UsageMetric label={t('rightPanel.usage.tools')} value={String(usage.toolCalls)} compact />
          <UsageMetric label={t('rightPanel.usage.user')} value={String(usage.byRole.user)} compact />
          <UsageMetric label={t('rightPanel.usage.ai')} value={String(usage.byRole.assistant)} compact />
        </div>
      </div>

      <div className="px-3 py-2 text-[10px] font-semibold uppercase text-pi-dim">{t('rightPanel.usage.recent')}</div>
      {usage.messagesWithUsage.length === 0 ? (
        <PanelInline icon={Activity} message={t('rightPanel.usage.empty')} />
      ) : (
        <div className="pb-3">
          {usage.messagesWithUsage.slice(-12).reverse().map((message) => (
            <UsageMessageRow key={message.id} message={message} />
          ))}
        </div>
      )}
    </div>
  );
}

function UsageMetric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={cn('rounded-md border border-pi-border bg-pi-bg-secondary', compact ? 'p-2' : 'p-3')}>
      <div className="text-[10px] text-pi-dim truncate">{label}</div>
      <div className={cn('font-semibold text-pi-text truncate', compact ? 'text-xs mt-0.5' : 'text-sm mt-1')}>{value}</div>
    </div>
  );
}

function UsageMessageRow({ message }: { message: ChatMessage }) {
  const { t } = useI18n();
  const usage = message.usage ?? zeroUsage();
  return (
    <div className="px-3 py-2 hover:bg-pi-bg-hover transition-colors">
      <div className="flex items-center gap-2">
        <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] font-semibold uppercase text-pi-dim">
          {message.role === 'assistant' ? 'AI' : message.role}
        </span>
        <span className="text-[10px] text-pi-dim">{formatRelativeTime(message.timestamp, t)}</span>
        <span className="ml-auto text-[10px] text-pi-dim">{formatCostValue(usage.cost)}</span>
      </div>
      <div className="mt-1 text-[10px] text-pi-muted truncate">{summarizeMessage(message)}</div>
      <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-pi-dim">
        <span>{t('rightPanel.usage.in', { count: formatCompactNumber(usage.input) })}</span>
        <span>{t('rightPanel.usage.out', { count: formatCompactNumber(usage.output) })}</span>
        {usage.cacheRead > 0 && <span>{t('rightPanel.usage.cache', { count: formatCompactNumber(usage.cacheRead) })}</span>}
      </div>
    </div>
  );
}

function SessionTreePanel({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const sessions = useChatStore((s) => s.sessions);
  const messages = useChatStore((s) => s.getMessages(sessionId));
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const addToast = useUIStore((s) => s.addToast);
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);

  const session = sessions.find((item) => item.id === sessionId);
  const ancestors = useMemo(() => session ? collectAncestors(sessions, session) : [], [session, sessions]);
  const children = useMemo(
    () => sessions
      .filter((item) => item.parentSessionId === sessionId)
      .sort((a, b) => b.createdAt - a.createdAt),
    [sessionId, sessions]
  );

  const forkAt = (entryId: string) => {
    setForkingMessageId(entryId);
    const sent = piApi.send({ type: 'session_fork', sessionId, entryId });
    if (!sent) {
      setForkingMessageId(null);
      addToast({ type: 'error', message: t('rightPanel.unableForkDisconnected') });
    } else {
      window.setTimeout(() => setForkingMessageId(null), 1200);
    }
  };

  const openSession = (targetSessionId: string) => {
    setActiveSession(targetSessionId);
    setActiveView('chat');
    piApi.send({ type: 'session_tree_navigate', sessionId, targetId: targetSessionId });
  };

  if (!session) {
    return <PanelInline icon={FolderTree} message={t('rightPanel.sessionUnavailable')} tone="error" />;
  }

  return (
    <div className="min-h-0 flex-1 flex flex-col">
      <div className="border-b border-pi-border px-3 py-3 space-y-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-pi-text truncate">{session.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-pi-dim">
            <span>{t('rightPanel.checkpoints', { count: messages.length })}</span>
            <span>{t('rightPanel.forks', { count: children.length })}</span>
            {session.parentSessionId && <span>{t('rightPanel.forked')}</span>}
          </div>
        </div>

        {ancestors.length > 0 && (
          <div className="rounded-md border border-pi-border bg-pi-bg-secondary overflow-hidden">
            {ancestors.map((ancestor) => (
              <button
                key={ancestor.id}
                onClick={() => openSession(ancestor.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover transition-colors"
                title={ancestor.title}
              >
                <GitBranch size={12} className="text-pi-accent flex-shrink-0" />
                <span className="truncate">{ancestor.title}</span>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => forkAt('latest')}
          className="h-8 w-full rounded-md bg-pi-accent text-white text-xs font-medium hover:opacity-90 transition-opacity"
        >
          {t('rightPanel.forkLatest')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <PanelInline icon={FolderTree} message={t('rightPanel.noCheckpoints')} />
        ) : (
          <div className="py-2">
            {messages.map((message, index) => (
              <TimelineMessage
                key={message.id}
                message={message}
                index={index}
                isForking={forkingMessageId === message.id}
                onFork={() => forkAt(message.id)}
              />
            ))}
          </div>
        )}
      </div>

      {children.length > 0 && (
        <div className="max-h-[34%] overflow-y-auto border-t border-pi-border">
          <div className="px-3 py-2 text-[10px] font-semibold uppercase text-pi-dim">{t('rightPanel.forksSection')}</div>
          <div className="pb-2">
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => openSession(child.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-pi-bg-hover transition-colors"
                title={child.title}
              >
                <GitBranch size={13} className="text-pi-accent flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-pi-text truncate">{child.title}</div>
                  <div className="text-[10px] text-pi-dim truncate">
                    {formatRelativeTime(child.createdAt, t)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineMessage({
  message,
  index,
  isForking,
  onFork,
}: {
  message: ChatMessage;
  index: number;
  isForking: boolean;
  onFork: () => void;
}) {
  const { t } = useI18n();
  const summary = summarizeMessage(message);
  const roleLabel = message.role === 'assistant'
    ? t('rightPanel.usage.ai')
    : message.role === 'user'
      ? t('rightPanel.usage.user')
      : message.role;

  return (
    <div className="group relative px-3 py-2 hover:bg-pi-bg-hover/60 transition-colors">
      <div className="absolute left-[22px] top-8 bottom-0 w-px bg-pi-border group-last:hidden" />
      <div className="flex items-start gap-2">
        <div className={cn(
          'relative z-10 mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center text-[9px] font-semibold',
          message.role === 'assistant'
            ? 'border-pi-accent/50 bg-pi-accent/10 text-pi-accent'
            : 'border-pi-success/50 bg-pi-success/10 text-pi-success'
        )}>
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-semibold text-pi-dim">{roleLabel}</span>
            <span className="text-[10px] text-pi-dim">{formatRelativeTime(message.timestamp, t)}</span>
            {message.isStreaming && <span className="text-[10px] text-pi-warning">{t('rightPanel.streaming')}</span>}
          </div>
          <div className="mt-0.5 text-xs text-pi-muted leading-relaxed line-clamp-3">{summary}</div>
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {message.toolCalls.slice(0, 4).map((tool) => (
                <span key={tool.id} className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] font-mono text-pi-dim">
                  {tool.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onFork}
          disabled={isForking}
          className="opacity-0 group-hover:opacity-100 h-7 px-2 rounded-md border border-pi-border text-[10px] text-pi-muted hover:text-pi-text hover:bg-pi-bg-tertiary disabled:opacity-50 transition-all"
          title={t('rightPanel.forkFromCheckpoint')}
        >
          {isForking ? t('rightPanel.forking') : t('rightPanel.fork')}
        </button>
      </div>
    </div>
  );
}

function WorkspaceBrowser({ sessionId, initialMode }: { sessionId: string; initialMode: 'changes' | 'files' }) {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [mode, setMode] = useState<'changes' | 'files'>(initialMode);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<WorkspaceStatusResult | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [treeByPath, setTreeByPath] = useState<Record<string, WorkspaceTreeResult>>({});
  const [treeLoadingByPath, setTreeLoadingByPath] = useState<Record<string, boolean>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['']));
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([]);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [selectedRangeByTab, setSelectedRangeByTab] = useState<Record<string, LineSelection | undefined>>({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [busyChangeKey, setBusyChangeKey] = useState<string | null>(null);
  const splitAreaRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef({ startY: 0, startPreviewRatio: WORKSPACE_PREVIEW_DEFAULT_RATIO });
  const [previewHeightRatio, setPreviewHeightRatio] = useState(WORKSPACE_PREVIEW_DEFAULT_RATIO);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const [revealedFilePath, setRevealedFilePath] = useState<string | null>(null);
  const [scrollTargetPath, setScrollTargetPath] = useState<string | null>(null);
  const workspaceOpenRequest = useUIStore((s) => s.workspaceOpenRequest);
  const lastWorkspaceOpenRequestRef = useRef<number | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const setClampedPreviewHeightRatio = useCallback((value: number) => {
    setPreviewHeightRatio(clamp(value, WORKSPACE_PREVIEW_MIN_RATIO, WORKSPACE_PREVIEW_MAX_RATIO));
  }, []);

  const startPreviewResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (workspaceCollapsed || previewCollapsed) return;
    event.preventDefault();
    resizeStateRef.current = {
      startY: event.clientY,
      startPreviewRatio: previewHeightRatio,
    };
    setIsResizingPreview(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [previewCollapsed, previewHeightRatio, workspaceCollapsed]);

  const handlePreviewResizeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (workspaceCollapsed || previewCollapsed) return;

    const step = event.shiftKey ? 0.08 : 0.04;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setClampedPreviewHeightRatio(previewHeightRatio + step);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setClampedPreviewHeightRatio(previewHeightRatio - step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setClampedPreviewHeightRatio(WORKSPACE_PREVIEW_MIN_RATIO);
    } else if (event.key === 'End') {
      event.preventDefault();
      setClampedPreviewHeightRatio(WORKSPACE_PREVIEW_MAX_RATIO);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      setClampedPreviewHeightRatio(WORKSPACE_PREVIEW_DEFAULT_RATIO);
    }
  }, [previewCollapsed, previewHeightRatio, setClampedPreviewHeightRatio, workspaceCollapsed]);

  useEffect(() => {
    if (!isResizingPreview) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      const height = splitAreaRef.current?.getBoundingClientRect().height ?? 0;
      if (height <= 0) return;

      const { startY, startPreviewRatio } = resizeStateRef.current;
      const deltaRatio = (event.clientY - startY) / height;
      setClampedPreviewHeightRatio(startPreviewRatio - deltaRatio);
    };

    const stopResize = () => {
      setIsResizingPreview(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [isResizingPreview, setClampedPreviewHeightRatio]);

  const loadStatus = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setStatusLoading(true);
    }
    setStatusError(null);
    try {
      setStatus(await piApi.getWorkspaceStatus(sessionId));
      setLastRefreshedAt(Date.now());
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!options?.silent) {
        setStatusLoading(false);
      }
    }
  }, [sessionId]);

  const loadTree = useCallback(async (path = '') => {
    setTreeLoadingByPath((prev) => ({ ...prev, [path]: true }));
    try {
      const tree = await piApi.getWorkspaceTree(sessionId, path);
      setTreeByPath((prev) => ({ ...prev, [path]: tree }));
    } catch (err) {
      setTreeByPath((prev) => ({
        ...prev,
        [path]: {
          state: 'error',
          path,
          entries: [],
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      setTreeLoadingByPath((prev) => ({ ...prev, [path]: false }));
    }
  }, [sessionId]);

  useEffect(() => {
    setStatus(null);
    setStatusError(null);
    setTreeByPath({});
    setExpandedPaths(new Set(['']));
    setPreviewTabs([]);
    setActivePreviewId(null);
    setSelectedRangeByTab({});
    setRevealedFilePath(null);
    setScrollTargetPath(null);
    void loadStatus();
    void loadTree('');
  }, [sessionId, loadStatus, loadTree]);

  const refresh = () => {
    void loadStatus();
    if (mode === 'files') {
      void loadTree('');
    }
  };

  useEffect(() => {
    const handleWorkspaceChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId && detail.sessionId !== sessionId) return;
      void loadStatus();
    };

    window.addEventListener('pi:workspace-changed', handleWorkspaceChanged);
    return () => window.removeEventListener('pi:workspace-changed', handleWorkspaceChanged);
  }, [loadStatus, sessionId]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void loadStatus({ silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadStatus]);

  const openPreview = async (target: PreviewTarget) => {
    const tabId = previewTabId(target);
    setPreviewCollapsed(false);
    setActivePreviewId(tabId);
    setPreviewTabs((tabs) => {
      if (tabs.some((tab) => tab.id === tabId)) return tabs;
      return [...tabs, { id: tabId, state: 'loading', target, title: previewTitle(target) }];
    });

    try {
      if (target.kind === 'diff') {
        const data = await piApi.getWorkspaceDiff(sessionId, target.path);
        setPreviewTabs((tabs) => upsertPreviewTab(tabs, { id: tabId, state: 'diff', target, title: previewTitle(target), data }));
      } else {
        const data = await piApi.getWorkspaceFile(sessionId, target.path);
        setPreviewTabs((tabs) => upsertPreviewTab(tabs, { id: tabId, state: 'file', target, title: previewTitle(target), data }));
      }
    } catch (err) {
      setPreviewTabs((tabs) => upsertPreviewTab(tabs, {
        id: tabId,
        state: 'error',
        target,
        title: previewTitle(target),
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const revealWorkspaceFile = useCallback(async (path: string) => {
    const normalizedPath = normalizeWorkspaceFilePath(path);
    if (!normalizedPath) return;

    const parentPaths = parentWorkspacePaths(normalizedPath);
    setMode('files');
    setQuery('');
    setWorkspaceCollapsed(false);
    setPreviewCollapsed(false);
    setRevealedFilePath(normalizedPath);
    setScrollTargetPath(normalizedPath);
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      next.add('');
      for (const parentPath of parentPaths) {
        next.add(parentPath);
      }
      return next;
    });

    await Promise.all(['', ...parentPaths].map((parentPath) => loadTree(parentPath)));
    void openPreview({ kind: 'file', path: normalizedPath });
  }, [loadTree]);

  useEffect(() => {
    if (!workspaceOpenRequest || workspaceOpenRequest.sessionId !== sessionId) return;
    if (lastWorkspaceOpenRequestRef.current === workspaceOpenRequest.id) return;
    lastWorkspaceOpenRequestRef.current = workspaceOpenRequest.id;
    void revealWorkspaceFile(workspaceOpenRequest.path);
  }, [revealWorkspaceFile, sessionId, workspaceOpenRequest?.id, workspaceOpenRequest?.path, workspaceOpenRequest?.sessionId]);

  const activePreview = useMemo(
    () => previewTabs.find((tab) => tab.id === activePreviewId) ?? previewTabs.at(-1) ?? null,
    [activePreviewId, previewTabs]
  );
  const activeSelection = activePreview ? selectedRangeByTab[activePreview.id] : undefined;

  const closePreviewTab = (tabId: string) => {
    setPreviewTabs((tabs) => {
      const index = tabs.findIndex((tab) => tab.id === tabId);
      const next = tabs.filter((tab) => tab.id !== tabId);
      if (activePreviewId === tabId) {
        const fallback = next[Math.max(0, index - 1)] ?? next[0] ?? null;
        setActivePreviewId(fallback?.id ?? null);
      }
      return next;
    });
    setSelectedRangeByTab((current) => {
      const copy = { ...current };
      delete copy[tabId];
      return copy;
    });
  };

  const closePreviewTabs = (scope: PreviewTabCloseScope, tabId: string) => {
    setPreviewTabs((tabs) => {
      const index = tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return tabs;

      let next: PreviewTab[];
      if (scope === 'all') {
        next = [];
      } else if (scope === 'others') {
        next = tabs.filter((tab) => tab.id === tabId);
      } else if (scope === 'left') {
        next = tabs.slice(index);
      } else if (scope === 'right') {
        next = tabs.slice(0, index + 1);
      } else {
        next = tabs.filter((tab) => tab.id !== tabId);
      }

      const nextIds = new Set(next.map((tab) => tab.id));
      setSelectedRangeByTab((current) => {
        const kept: Record<string, LineSelection | undefined> = {};
        for (const [id, selection] of Object.entries(current)) {
          if (nextIds.has(id)) kept[id] = selection;
        }
        return kept;
      });

      setActivePreviewId((current) => {
        if (next.length === 0) return null;
        if (current && nextIds.has(current)) return current;
        if (scope === 'others') return tabId;
        return next[Math.min(index, next.length - 1)]?.id ?? next[0]?.id ?? null;
      });

      return next;
    });
  };

  const handleLineClick = (tab: PreviewTab, lineNumber: number, event: MouseEvent<HTMLButtonElement>) => {
    setSelectedRangeByTab((current) => {
      const previous = current[tab.id];
      if (event.shiftKey && previous) {
        return {
          ...current,
          [tab.id]: {
            start: Math.min(previous.start, lineNumber),
            end: Math.max(previous.end, lineNumber),
          },
        };
      }

      if (previous?.start === lineNumber && previous.end === lineNumber) {
        return { ...current, [tab.id]: undefined };
      }

      return { ...current, [tab.id]: { start: lineNumber, end: lineNumber } };
    });
  };

  const toggleTreePath = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        if (!treeByPath[path]) {
          void loadTree(path);
        }
      }
      return next;
    });
  };

  const filteredChanges = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const files = status?.changedFiles ?? [];
    if (!normalized) return files;
    return files.filter((file) =>
      file.path.toLowerCase().includes(normalized) ||
      file.oldPath?.toLowerCase().includes(normalized) ||
      file.status.toLowerCase().includes(normalized)
    );
  }, [query, status?.changedFiles]);

  const copyPreviewPath = async () => {
    if (!activePreview) return;
    try {
      await navigator.clipboard.writeText(activePreview.target.path);
      addToast({ type: 'success', message: t('rightPanel.pathCopied') });
    } catch {
      addToast({ type: 'error', message: t('rightPanel.copyPathFailed') });
    }
  };

  const addPreviewToChat = () => {
    if (!activePreview) return;

    window.dispatchEvent(new CustomEvent('pi:add-workspace-reference', {
      detail: {
        sessionId,
        path: activePreview.target.path,
        name: activePreview.target.path.split('/').pop() ?? activePreview.target.path,
      },
    }));
    addToast({ type: 'success', message: t('rightPanel.addedFileReference') });
  };

  const addSelectionToChat = () => {
    if (!activePreview || !activeSelection) return;
    const excerpt = excerptFromPreview(activePreview, activeSelection);
    if (!excerpt.trim()) {
      addToast({ type: 'warning', message: t('rightPanel.selectedLinesEmpty') });
      return;
    }

    window.dispatchEvent(new CustomEvent('pi:add-workspace-reference', {
      detail: {
        sessionId,
        path: activePreview.target.path,
        name: activePreview.target.path.split('/').pop() ?? activePreview.target.path,
        lineStart: activeSelection.start,
        lineEnd: activeSelection.end,
        excerpt,
        sourceKind: activePreview.target.kind,
      },
    }));
    addToast({ type: 'success', message: t('rightPanel.addedSelectedLines') });
  };

  const openActivePreviewStandalone = async () => {
    if (!activePreview) return;
    if (!window.piDesktop) {
      addToast({ type: 'warning', message: t('rightPanel.standaloneOnlyDesktop') });
      return;
    }

    try {
      await window.piDesktop.openWorkspaceFileWindow(sessionId, activePreview.target.path);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : String(err), duration: 6000 });
    }
  };

  const refreshTreeAroundPaths = useCallback(async (paths: string[]) => {
    const pathsToLoad = new Set<string>(['']);
    for (const itemPath of paths) {
      const normalizedPath = normalizeWorkspaceFilePath(itemPath);
      const parentPath = immediateParentWorkspacePath(normalizedPath);
      if (parentPath) pathsToLoad.add(parentPath);
      for (const ancestorPath of parentWorkspacePaths(normalizedPath)) {
        pathsToLoad.add(ancestorPath);
      }
    }
    await Promise.all(Array.from(pathsToLoad).map((path) => loadTree(path)));
  }, [loadTree]);

  const removePreviewTabsForPath = useCallback((workspacePath: string) => {
    const normalizedPath = normalizeWorkspaceFilePath(workspacePath);
    if (!normalizedPath) return;

    setPreviewTabs((tabs) => {
      const removedIds = new Set<string>();
      const next = tabs.filter((tab) => {
        const affected = isWorkspacePathWithin(tab.target.path, normalizedPath);
        if (affected) removedIds.add(tab.id);
        return !affected;
      });

      if (removedIds.size > 0) {
        setSelectedRangeByTab((current) => {
          const kept: Record<string, LineSelection | undefined> = {};
          for (const [id, selection] of Object.entries(current)) {
            if (!removedIds.has(id)) kept[id] = selection;
          }
          return kept;
        });
        setActivePreviewId((current) => {
          if (!current || !removedIds.has(current)) return current;
          return next.at(-1)?.id ?? null;
        });
      }

      return next;
    });
  }, []);

  const addWorkspaceEntryToChat = (entry: WorkspaceTreeEntry) => {
    if (entry.isDirectory) {
      addToast({ type: 'warning', message: t('rightPanel.folderReferenceUnsupported') });
      return;
    }

    window.dispatchEvent(new CustomEvent('pi:add-workspace-reference', {
      detail: {
        sessionId,
        path: entry.path,
        name: entry.name,
      },
    }));
    addToast({ type: 'success', message: t('rightPanel.addedFileReference') });
  };

  const copyWorkspaceEntryPath = async (entry: WorkspaceTreeEntry) => {
    try {
      await navigator.clipboard.writeText(entry.path);
      addToast({ type: 'success', message: t('rightPanel.pathCopied') });
    } catch {
      addToast({ type: 'error', message: t('rightPanel.copyPathFailed') });
    }
  };

  const revealWorkspacePathInExplorer = async (workspacePath: string) => {
    if (!window.piDesktop) {
      addToast({ type: 'warning', message: t('rightPanel.standaloneOnlyDesktop') });
      return;
    }

    try {
      const workspace = await piApi.getWorkspaceStatus(sessionId);
      if (workspace.state !== 'ok') {
        throw new Error(workspace.error ?? t('rightPanel.workspaceMissing'));
      }
      const result = await window.piDesktop.revealWorkspacePath(workspace.workDir, workspacePath);
      if (!result.ok) {
        throw new Error(result.error ?? t('rightPanel.revealInExplorerFailed'));
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: t('rightPanel.revealInExplorerFailedWithMessage', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    }
  };

  const openWorkspaceEntryStandalone = async (entry: WorkspaceTreeEntry) => {
    if (entry.isDirectory) {
      addToast({ type: 'warning', message: t('rightPanel.folderStandaloneUnsupported') });
      return;
    }
    if (!window.piDesktop) {
      addToast({ type: 'warning', message: t('rightPanel.standaloneOnlyDesktop') });
      return;
    }

    try {
      await window.piDesktop.openWorkspaceFileWindow(sessionId, entry.path);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : String(err), duration: 6000 });
    }
  };

  const detachWorkspaceEntryStandalone = async (entry: WorkspaceTreeEntry, screenPoint?: { x: number; y: number }) => {
    if (entry.isDirectory) {
      addToast({ type: 'warning', message: t('rightPanel.folderStandaloneUnsupported') });
      return;
    }
    if (!window.piDesktop) {
      addToast({ type: 'warning', message: t('rightPanel.standaloneOnlyDesktop') });
      return;
    }

    try {
      if (window.piDesktop.openWorkspaceFileDetachedWindow) {
        await window.piDesktop.openWorkspaceFileDetachedWindow(sessionId, entry.path, screenPoint);
      } else {
        await window.piDesktop.openWorkspaceFileWindow(sessionId, entry.path);
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : String(err), duration: 6000 });
    }
  };

  const deleteWorkspaceEntry = async (entry: WorkspaceTreeEntry) => {
    const confirmed = window.confirm(t('rightPanel.fileDeleteConfirm', { path: entry.path }));
    if (!confirmed) return;

    try {
      const result = await piApi.deleteWorkspacePath(sessionId, entry.path);
      if (result.state !== 'ok') {
        throw new Error(result.error ?? t('rightPanel.fileDeleteFailed'));
      }

      removePreviewTabsForPath(entry.path);
      setRevealedFilePath((current) => current && isWorkspacePathWithin(current, entry.path) ? null : current);
      await refreshTreeAroundPaths([entry.path]);
      void loadStatus({ silent: true });
      window.dispatchEvent(new CustomEvent('pi:workspace-changed', { detail: { sessionId } }));
      addToast({ type: 'success', message: t('rightPanel.fileDeleted') });
    } catch (err) {
      addToast({
        type: 'error',
        message: t('rightPanel.fileOperationFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    }
  };

  const moveWorkspaceEntry = async (payload: WorkspaceFileDragPayload, targetDirectory: string) => {
    if (payload.sessionId !== sessionId) return;

    try {
      const result = await piApi.moveWorkspacePath(sessionId, payload.path, targetDirectory);
      if (result.state !== 'ok') {
        throw new Error(result.error ?? t('rightPanel.fileMoveFailed'));
      }

      removePreviewTabsForPath(payload.path);
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.add('');
        const normalizedTarget = normalizeWorkspaceFilePath(targetDirectory);
        if (normalizedTarget) next.add(normalizedTarget);
        for (const parentPath of parentWorkspacePaths(result.targetPath)) {
          next.add(parentPath);
        }
        return next;
      });
      setRevealedFilePath(result.targetPath);
      setScrollTargetPath(result.targetPath);
      await refreshTreeAroundPaths([payload.path, targetDirectory, result.targetPath]);
      void loadStatus({ silent: true });
      window.dispatchEvent(new CustomEvent('pi:workspace-changed', { detail: { sessionId } }));
      addToast({ type: 'success', message: t('rightPanel.fileMoved') });
    } catch (err) {
      addToast({
        type: 'error',
        message: t('rightPanel.fileOperationFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    }
  };

  const handleMarkdownSaved = (tab: PreviewTab, content: string, result: WorkspaceWriteFileResult) => {
    if (tab.state !== 'file') return;
    setPreviewTabs((tabs) => tabs.map((item) => {
      if (item.id !== tab.id || item.state !== 'file') return item;
      return {
        ...item,
        data: {
          ...item.data,
          state: 'ok',
          previewType: 'text',
          content,
          size: result.size,
          truncated: false,
          readBytes: result.size,
        },
      };
    }));
    void loadStatus({ silent: true });
  };

  const applyChangeAction = async (file: WorkspaceChangedFile, action: 'accept' | 'discard') => {
    if (action === 'discard') {
      const confirmed = window.confirm(t('rightPanel.discardChangeConfirm', { path: file.path }));
      if (!confirmed) return;
    }

    const key = changedFileKey(file);
    setBusyChangeKey(`${action}:${key}`);
    try {
      const result = await piApi.applyWorkspaceChange(sessionId, {
        action,
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
      });
      if (result.state !== 'ok') {
        throw new Error(result.error ?? t('rightPanel.changeOperationUnknownError'));
      }

      setStatus(result.statusResult ?? await piApi.getWorkspaceStatus(sessionId));
      setLastRefreshedAt(Date.now());
      addToast({
        type: 'success',
        message: action === 'accept' ? t('rightPanel.acceptedChange') : t('rightPanel.discardedChange'),
      });

      const activeTarget = activePreview?.target;
      if (activeTarget && (activeTarget.path === file.path || activeTarget.path === file.oldPath)) {
        void openPreview(activeTarget);
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: t('rightPanel.changeOperationFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    } finally {
      setBusyChangeKey(null);
    }
  };

  const workspacePanelStyle = workspaceCollapsed
    ? undefined
    : previewCollapsed
      ? { flex: '1 1 0%' }
      : { flex: `1 1 ${(1 - previewHeightRatio) * 100}%` };
  const previewPanelStyle = previewCollapsed
    ? undefined
    : workspaceCollapsed
      ? { flex: '1 1 0%' }
      : { flex: `0 0 ${previewHeightRatio * 100}%` };
  const showPreviewResizeHandle = !workspaceCollapsed && !previewCollapsed;

  return (
    <div className="min-h-0 flex-1 flex flex-col">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-pi-border">
        <button
          onClick={() => setMode('changes')}
          className={cn(
            'h-7 px-2 rounded-md text-xs font-medium transition-colors',
            mode === 'changes' ? 'bg-pi-selected-bg text-pi-accent' : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
          )}
        >
          {t('rightPanel.changes')}
        </button>
        <button
          onClick={() => {
            setMode('files');
            if (!treeByPath['']) void loadTree('');
          }}
          className={cn(
            'h-7 px-2 rounded-md text-xs font-medium transition-colors',
            mode === 'files' ? 'bg-pi-selected-bg text-pi-accent' : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
          )}
        >
          {t('rightPanel.files')}
        </button>
        <button
          onClick={refresh}
          className="ml-auto w-7 h-7 rounded-md flex items-center justify-center text-pi-dim hover:text-pi-text hover:bg-pi-bg-hover transition-colors"
          title={t('rightPanel.refreshWorkspace')}
        >
          <RefreshCw size={13} className={statusLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div ref={splitAreaRef} className="min-h-0 flex-1 flex flex-col">
        <div
          className={cn(
            'min-h-0 overflow-hidden flex flex-col bg-pi-bg',
            workspaceCollapsed ? 'flex-shrink-0' : 'min-h-[128px]'
          )}
          style={workspacePanelStyle}
        >
          <WorkspaceSummary
            status={status}
            loading={statusLoading}
            autoRefresh={autoRefresh}
            lastRefreshedAt={lastRefreshedAt}
            collapsed={workspaceCollapsed}
            onToggleCollapse={() => setWorkspaceCollapsed((value) => !value)}
            onToggleAutoRefresh={() => setAutoRefresh((value) => !value)}
          />

          {!workspaceCollapsed && (
            <>
              <div className="px-3 py-2 border-b border-pi-border">
                <label className="flex items-center gap-2 h-8 px-2 rounded-md bg-pi-bg-tertiary border border-pi-border focus-within:border-pi-accent transition-colors">
                  <Search size={13} className="text-pi-dim flex-shrink-0" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={mode === 'changes' ? t('rightPanel.filterChanged') : t('rightPanel.filterVisible')}
                    className="pi-embedded-input min-w-0 flex-1 bg-transparent outline-none text-xs text-pi-text placeholder-pi-dim"
                  />
                  {query && (
                    <button
                      onClick={() => setQuery('')}
                      className="w-5 h-5 rounded flex items-center justify-center text-pi-dim hover:text-pi-text"
                      title={t('rightPanel.clearFilter')}
                    >
                      <X size={12} />
                    </button>
                  )}
                </label>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {mode === 'changes' ? (
                  <ChangesList
                    status={status}
                    loading={statusLoading}
                    error={statusError}
                    files={filteredChanges}
                    busyChangeKey={busyChangeKey}
                    onOpen={(path) => void openPreview({ kind: isMarkdownFile(path) ? 'file' : 'diff', path })}
                    onAccept={(file) => void applyChangeAction(file, 'accept')}
                    onDiscard={(file) => void applyChangeAction(file, 'discard')}
                  />
                ) : (
                  <FilesTree
                    sessionId={sessionId}
                    root={treeByPath['']}
                    treeByPath={treeByPath}
                    loadingByPath={treeLoadingByPath}
                    expandedPaths={expandedPaths}
                    query={query}
                    revealedPath={revealedFilePath}
                    scrollTargetPath={scrollTargetPath}
                    onToggle={toggleTreePath}
                    onOpen={(path) => {
                      setRevealedFilePath(path);
                      void openPreview({ kind: 'file', path });
                    }}
                    onScrollTargetSettled={(path) => {
                      setScrollTargetPath((current) => current === path ? null : current);
                    }}
                    onMove={(payload, targetDirectory) => void moveWorkspaceEntry(payload, targetDirectory)}
                    onAddToChat={addWorkspaceEntryToChat}
                    onOpenStandalone={(entry) => void openWorkspaceEntryStandalone(entry)}
                    onDetachStandalone={(entry, screenPoint) => void detachWorkspaceEntryStandalone(entry, screenPoint)}
                    onRevealInExplorer={(entry) => void revealWorkspacePathInExplorer(entry.path)}
                    onCopyPath={(entry) => void copyWorkspaceEntryPath(entry)}
                    onDelete={(entry) => void deleteWorkspaceEntry(entry)}
                  />
                )}
              </div>
            </>
          )}
        </div>

        {showPreviewResizeHandle && (
          <div
            role="separator"
            aria-label={t('rightPanel.resizePreview')}
            aria-orientation="horizontal"
            aria-valuemin={Math.round(WORKSPACE_PREVIEW_MIN_RATIO * 100)}
            aria-valuemax={Math.round(WORKSPACE_PREVIEW_MAX_RATIO * 100)}
            aria-valuenow={Math.round(previewHeightRatio * 100)}
            tabIndex={0}
            title={t('rightPanel.dragResizePreview')}
            onPointerDown={startPreviewResize}
            onKeyDown={handlePreviewResizeKeyDown}
            onDoubleClick={() => setPreviewHeightRatio(WORKSPACE_PREVIEW_DEFAULT_RATIO)}
            className={cn(
              'group relative z-10 flex h-2 flex-shrink-0 cursor-row-resize touch-none items-center justify-center outline-none',
              'before:absolute before:inset-x-3 before:top-1/2 before:h-px before:-translate-y-1/2 before:rounded-full before:bg-pi-border/80 before:transition-colors',
              'after:absolute after:left-1/2 after:top-1/2 after:h-1 after:w-10 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-transparent after:transition-colors',
              'hover:before:bg-pi-accent/70 hover:after:bg-pi-accent/25 focus-visible:bg-pi-accent/10 focus-visible:before:bg-pi-accent focus-visible:after:bg-pi-accent/35',
              isResizingPreview && 'bg-pi-accent/10 before:bg-pi-accent after:bg-pi-accent/40'
            )}
          />
        )}

        <div
          className={cn(
            'min-h-0 overflow-hidden flex flex-col border-t border-pi-border bg-pi-bg',
            previewCollapsed ? 'flex-shrink-0' : 'min-h-[148px]'
          )}
          style={previewPanelStyle}
        >
          {!previewCollapsed && (
            <PreviewTabs
              tabs={previewTabs}
              activeId={activePreview?.id ?? null}
              onActivate={setActivePreviewId}
              onClose={closePreviewTab}
              onCloseTabs={closePreviewTabs}
              onRevealInExplorer={(path) => void revealWorkspacePathInExplorer(path)}
            />
          )}
          <PreviewHeader
            tab={activePreview}
            selection={activeSelection}
            collapsed={previewCollapsed}
            showStandalone={Boolean(activePreview && !(activePreview.state === 'file' && isMarkdownFile(activePreview.data.path, activePreview.data.language)))}
            onToggleCollapse={() => setPreviewCollapsed((value) => !value)}
            onCopyPath={copyPreviewPath}
            onAddToChat={addPreviewToChat}
            onAddSelection={addSelectionToChat}
            onOpenStandalone={openActivePreviewStandalone}
          />
          {!previewCollapsed && (
            <div className="min-h-0 flex flex-1 flex-col overflow-hidden">
              <PreviewContent
                sessionId={sessionId}
                tab={activePreview}
                selection={activeSelection}
                onLineClick={handleLineClick}
                onMarkdownSaved={handleMarkdownSaved}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChangesList({
  status,
  loading,
  error,
  files,
  busyChangeKey,
  onOpen,
  onAccept,
  onDiscard,
}: {
  status: WorkspaceStatusResult | null;
  loading: boolean;
  error: string | null;
  files: WorkspaceChangedFile[];
  busyChangeKey: string | null;
  onOpen: (path: string) => void;
  onAccept: (file: WorkspaceChangedFile) => void;
  onDiscard: (file: WorkspaceChangedFile) => void;
}) {
  const { t } = useI18n();
  if (loading && !status) return <PanelInline icon={RefreshCw} message={t('rightPanel.loadingWorkspace')} spinning />;
  if (error) return <PanelInline icon={GitCompare} message={error} tone="error" />;
  if (status?.state === 'missing_workdir') return <PanelInline icon={Folder} message={status.error ?? t('rightPanel.workspaceMissing')} tone="error" />;
  if (status?.state === 'not_git_repo') return <PanelInline icon={GitCompare} message={t('rightPanel.notGitRepo')} />;
  if (!status) return <PanelInline icon={GitCompare} message={t('rightPanel.statusUnavailable')} />;
  if (files.length === 0) return <PanelInline icon={GitCompare} message={t('rightPanel.noChangedFiles')} />;

  return (
    <div className="py-1">
      {files.map((file) => {
        const fileKey = changedFileKey(file);
        const busyAction = busyChangeKey?.endsWith(`:${fileKey}`)
          ? (busyChangeKey.split(':', 1)[0] as 'accept' | 'discard')
          : null;
        return (
          <ChangedFileRow
            key={fileKey}
            file={file}
            busyAction={busyAction}
            onOpen={onOpen}
            onAccept={onAccept}
            onDiscard={onDiscard}
          />
        );
      })}
    </div>
  );
}

function WorkspaceSummary({
  status,
  loading,
  autoRefresh,
  lastRefreshedAt,
  collapsed,
  onToggleCollapse,
  onToggleAutoRefresh,
}: {
  status: WorkspaceStatusResult | null;
  loading: boolean;
  autoRefresh: boolean;
  lastRefreshedAt: number | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onToggleAutoRefresh: () => void;
}) {
  const { t } = useI18n();
  if (!status) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex min-h-10 w-full items-center gap-2 border-b border-pi-border bg-pi-bg-secondary/60 px-3 py-2 text-left transition-colors hover:bg-pi-bg-hover/70"
        title={collapsed ? t('rightPanel.expandWorkspace') : t('rightPanel.collapseWorkspace')}
      >
        {collapsed ? <ChevronRight size={13} className="text-pi-dim" /> : <ChevronDown size={13} className="text-pi-dim" />}
        <GitBranch size={12} className="text-pi-accent flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-pi-text">{t('rightPanel.workspace')}</span>
        {loading && <RefreshCw size={12} className="animate-spin text-pi-dim" />}
      </button>
    );
  }

  const changedCount = status.changedFiles.length;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggleCollapse}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggleCollapse();
        }
      }}
      className="cursor-pointer border-b border-pi-border bg-pi-bg-secondary/60 px-3 py-2 transition-colors hover:bg-pi-bg-hover/70"
      title={collapsed ? t('rightPanel.expandWorkspace') : t('rightPanel.collapseWorkspace')}
    >
      <div className="flex items-center gap-2 min-w-0">
        {collapsed ? <ChevronRight size={13} className="text-pi-dim" /> : <ChevronDown size={13} className="text-pi-dim" />}
        <GitBranch size={12} className="text-pi-accent flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs text-pi-text">
          {status.repoName ?? t('rightPanel.workspace')}
          {status.branch ? <span className="text-pi-dim"> / {status.branch}</span> : null}
        </span>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-medium',
            changedCount > 0 ? 'bg-pi-warning/10 text-pi-warning' : 'bg-pi-success/10 text-pi-success'
          )}
        >
          {t('rightPanel.changedCount', { count: changedCount })}
        </span>
      </div>
      {!collapsed && (
        <div className="mt-1 flex items-center gap-2 text-[10px] text-pi-dim">
          <span className="truncate">{status.workDir}</span>
          {lastRefreshedAt && <span className="ml-auto flex-shrink-0">{formatRelativeTime(lastRefreshedAt, t)}</span>}
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleAutoRefresh();
            }}
            className={cn(
              'rounded px-1.5 py-0.5 transition-colors flex-shrink-0',
              autoRefresh ? 'bg-pi-accent/10 text-pi-accent' : 'bg-pi-bg-tertiary text-pi-dim hover:text-pi-text'
            )}
            title={t('rightPanel.toggleAutoRefresh')}
          >
            {loading ? t('rightPanel.syncing') : autoRefresh ? t('rightPanel.auto') : t('rightPanel.manual')}
          </button>
        </div>
      )}
    </div>
  );
}

function ChangedFileRow({
  file,
  busyAction,
  onOpen,
  onAccept,
  onDiscard,
}: {
  file: WorkspaceChangedFile;
  busyAction: 'accept' | 'discard' | null;
  onOpen: (path: string) => void;
  onAccept: (file: WorkspaceChangedFile) => void;
  onDiscard: (file: WorkspaceChangedFile) => void;
}) {
  const { t } = useI18n();
  const meta = STATUS_META[file.status];
  const isBusy = Boolean(busyAction);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(file.path);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(file.path)}
      onKeyDown={handleKeyDown}
      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-pi-bg-hover transition-colors group outline-none focus-visible:bg-pi-selected-bg"
      title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
    >
      <span className={cn('w-5 h-5 rounded border flex items-center justify-center text-[10px] font-semibold flex-shrink-0', meta.className)}>
        {meta.label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-pi-text truncate group-hover:text-pi-accent transition-colors">{file.path}</div>
        {file.oldPath && <div className="text-[10px] text-pi-dim truncate">{t('rightPanel.fromPath', { path: file.oldPath })}</div>}
      </div>
      {(file.additions > 0 || file.deletions > 0) && (
        <div className="flex items-center gap-1 text-[10px] font-mono flex-shrink-0">
          <span className="text-pi-success">+{file.additions}</span>
          <span className="text-pi-error">-{file.deletions}</span>
        </div>
      )}
      <div className="ml-1 flex flex-shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          disabled={isBusy}
          onClick={(event) => {
            event.stopPropagation();
            onAccept(file);
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-pi-border/70 bg-pi-bg-secondary/80 text-pi-dim shadow-sm transition-colors hover:border-pi-success/50 hover:bg-pi-success/10 hover:text-pi-success disabled:cursor-not-allowed disabled:opacity-60"
          title={t('rightPanel.acceptChange')}
        >
          {busyAction === 'accept' ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
        </button>
        <button
          type="button"
          disabled={isBusy}
          onClick={(event) => {
            event.stopPropagation();
            onDiscard(file);
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-pi-border/70 bg-pi-bg-secondary/80 text-pi-dim shadow-sm transition-colors hover:border-pi-error/50 hover:bg-pi-error/10 hover:text-pi-error disabled:cursor-not-allowed disabled:opacity-60"
          title={t('rightPanel.discardChange')}
        >
          {busyAction === 'discard' ? <RefreshCw size={12} className="animate-spin" /> : <RotateCcw size={12} />}
        </button>
      </div>
    </div>
  );
}

function FilesTree({
  sessionId,
  root,
  treeByPath,
  loadingByPath,
  expandedPaths,
  query,
  revealedPath,
  scrollTargetPath,
  onToggle,
  onOpen,
  onScrollTargetSettled,
  onMove,
  onAddToChat,
  onOpenStandalone,
  onDetachStandalone,
  onRevealInExplorer,
  onCopyPath,
  onDelete,
}: {
  sessionId: string;
  root?: WorkspaceTreeResult;
  treeByPath: Record<string, WorkspaceTreeResult>;
  loadingByPath: Record<string, boolean>;
  expandedPaths: Set<string>;
  query: string;
  revealedPath: string | null;
  scrollTargetPath: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onScrollTargetSettled: (path: string) => void;
  onMove: (payload: WorkspaceFileDragPayload, targetDirectory: string) => void;
  onAddToChat: (entry: WorkspaceTreeEntry) => void;
  onOpenStandalone: (entry: WorkspaceTreeEntry) => void;
  onDetachStandalone: (entry: WorkspaceTreeEntry, screenPoint?: { x: number; y: number }) => void;
  onRevealInExplorer: (entry: WorkspaceTreeEntry) => void;
  onCopyPath: (entry: WorkspaceTreeEntry) => void;
  onDelete: (entry: WorkspaceTreeEntry) => void;
}) {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: WorkspaceTreeEntry } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;

    const close = () => setContextMenu(null);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  if (loadingByPath[''] && !root) return <PanelInline icon={RefreshCw} message={t('rightPanel.loadingFiles')} spinning />;
  if (!root) return <PanelInline icon={FolderTree} message={t('rightPanel.fileTreeUnavailable')} />;
  if (root.state === 'missing') return <PanelInline icon={Folder} message={t('rightPanel.workspaceFolderMissing')} tone="error" />;
  if (root.state === 'error') return <PanelInline icon={Folder} message={root.error ?? t('rightPanel.unableLoadFiles')} tone="error" />;
  if (root.entries.length === 0) return <PanelInline icon={FolderOpen} message={t('rightPanel.noFilesFound')} />;

  const handleRootDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasWorkspaceFileDragPayload(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleRootDrop = (event: DragEvent<HTMLDivElement>) => {
    const payload = readWorkspaceFileDragPayload(event.dataTransfer);
    if (!payload || payload.sessionId !== sessionId) return;
    event.preventDefault();
    event.stopPropagation();
    onMove(payload, '');
  };

  return (
    <div className="py-1" onDragOver={handleRootDragOver} onDrop={handleRootDrop}>
      <TreeEntries
        sessionId={sessionId}
        entries={root.entries}
        treeByPath={treeByPath}
        loadingByPath={loadingByPath}
        expandedPaths={expandedPaths}
        query={query.trim().toLowerCase()}
        revealedPath={revealedPath}
        scrollTargetPath={scrollTargetPath}
        depth={0}
        onToggle={onToggle}
        onOpen={onOpen}
        onScrollTargetSettled={onScrollTargetSettled}
        onMove={onMove}
        onAddToChat={onAddToChat}
        onOpenStandalone={onOpenStandalone}
        onDetachStandalone={onDetachStandalone}
        onContextMenu={(event, entry) => {
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({ x: event.clientX, y: event.clientY, entry });
        }}
      />
      {contextMenu && typeof document !== 'undefined' && createPortal(
        <WorkspaceFileContextMenu
          state={contextMenu}
          onOpen={(entry) => {
            setContextMenu(null);
            entry.isDirectory ? onToggle(entry.path) : onOpen(entry.path);
          }}
          onAddToChat={(entry) => {
            setContextMenu(null);
            onAddToChat(entry);
          }}
          onOpenStandalone={(entry) => {
            setContextMenu(null);
            onOpenStandalone(entry);
          }}
          onRevealInExplorer={(entry) => {
            setContextMenu(null);
            onRevealInExplorer(entry);
          }}
          onCopyPath={(entry) => {
            setContextMenu(null);
            onCopyPath(entry);
          }}
          onDelete={(entry) => {
            setContextMenu(null);
            onDelete(entry);
          }}
        />,
        document.body
      )}
    </div>
  );
}

function TreeEntries({
  sessionId,
  entries,
  treeByPath,
  loadingByPath,
  expandedPaths,
  query,
  revealedPath,
  scrollTargetPath,
  depth,
  onToggle,
  onOpen,
  onScrollTargetSettled,
  onMove,
  onAddToChat,
  onOpenStandalone,
  onDetachStandalone,
  onContextMenu,
}: {
  sessionId: string;
  entries: WorkspaceTreeEntry[];
  treeByPath: Record<string, WorkspaceTreeResult>;
  loadingByPath: Record<string, boolean>;
  expandedPaths: Set<string>;
  query: string;
  revealedPath: string | null;
  scrollTargetPath: string | null;
  depth: number;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onScrollTargetSettled: (path: string) => void;
  onMove: (payload: WorkspaceFileDragPayload, targetDirectory: string) => void;
  onAddToChat: (entry: WorkspaceTreeEntry) => void;
  onOpenStandalone: (entry: WorkspaceTreeEntry) => void;
  onDetachStandalone: (entry: WorkspaceTreeEntry, screenPoint?: { x: number; y: number }) => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>, entry: WorkspaceTreeEntry) => void;
}) {
  const { t } = useI18n();
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const visible = entries.filter((entry) => !query || entry.path.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query) || entry.isDirectory);

  return (
    <>
      {visible.map((entry) => {
        const expanded = expandedPaths.has(entry.path);
        const childTree = treeByPath[entry.path];
        const loading = loadingByPath[entry.path];
        const Icon = entry.isDirectory ? (expanded ? FolderOpen : Folder) : File;
        const revealed = revealedPath === entry.path;
        const dropTarget = dropTargetPath === entry.path;

        return (
          <div key={entry.path}>
            <button
              draggable
              ref={(node) => {
                if (node && scrollTargetPath === entry.path) {
                  window.requestAnimationFrame(() => {
                    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    onScrollTargetSettled(entry.path);
                  });
                }
              }}
              onClick={() => entry.isDirectory ? onToggle(entry.path) : onOpen(entry.path)}
              onContextMenuCapture={(event) => onContextMenu(event, entry)}
              onDragStart={(event) => {
                setWorkspaceFileDragData(
                  event.dataTransfer,
                  createWorkspaceFileDragPayload(sessionId, entry)
                );
              }}
              onDragEnd={(event) => {
                if (event.dataTransfer.dropEffect !== 'none') return;
                if (entry.isDirectory || !window.piDesktop || !shouldDetachWorkspaceDrag(event)) return;
                onDetachStandalone(entry, { x: event.screenX, y: event.screenY });
              }}
              onDragOver={(event) => {
                if (!hasWorkspaceFileDragPayload(event.dataTransfer)) return;
                if (!entry.isDirectory) {
                  event.stopPropagation();
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'move';
                setDropTargetPath(entry.path);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                setDropTargetPath((current) => current === entry.path ? null : current);
              }}
              onDrop={(event) => {
                const payload = readWorkspaceFileDragPayload(event.dataTransfer);
                if (!payload || payload.sessionId !== sessionId) return;
                if (!entry.isDirectory) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                setDropTargetPath(null);
                if (isWorkspacePathWithin(entry.path, payload.path)) return;
                onMove(payload, entry.path);
              }}
              className={cn(
                'group w-full flex items-center gap-1.5 h-7 pr-2 text-left text-xs transition-colors',
                dropTarget && 'bg-pi-accent/10 text-pi-accent ring-1 ring-inset ring-pi-accent/40',
                revealed
                  ? 'bg-pi-selected-bg text-pi-accent ring-1 ring-inset ring-pi-accent/35'
                  : 'text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover'
              )}
              style={{ paddingLeft: 8 + depth * 14 }}
              title={entry.path}
            >
              {entry.isDirectory ? (
                expanded ? <ChevronDown size={12} className="text-pi-dim" /> : <ChevronRight size={12} className="text-pi-dim" />
              ) : (
                <span className="w-3" />
              )}
              <Icon size={13} className={entry.isDirectory ? 'text-pi-accent flex-shrink-0' : 'text-pi-dim flex-shrink-0'} />
              <span className="truncate">{entry.name}</span>
              {!entry.isDirectory && (
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onAddToChat(entry);
                  }}
                  className="ml-auto hidden h-5 w-5 items-center justify-center rounded text-pi-dim hover:bg-pi-bg-tertiary hover:text-pi-accent group-hover:flex"
                  title={t('rightPanel.addToChat')}
                >
                  <MessageSquarePlus size={11} />
                </span>
              )}
              {loading && <RefreshCw size={10} className="animate-spin text-pi-dim ml-auto" />}
            </button>
            {entry.isDirectory && expanded && childTree?.state === 'ok' && (
              <TreeEntries
                sessionId={sessionId}
                entries={childTree.entries}
                treeByPath={treeByPath}
                loadingByPath={loadingByPath}
                expandedPaths={expandedPaths}
                query={query}
                revealedPath={revealedPath}
                scrollTargetPath={scrollTargetPath}
                depth={depth + 1}
                onToggle={onToggle}
                onOpen={onOpen}
                onScrollTargetSettled={onScrollTargetSettled}
                onMove={onMove}
                onAddToChat={onAddToChat}
                onOpenStandalone={onOpenStandalone}
                onDetachStandalone={onDetachStandalone}
                onContextMenu={onContextMenu}
              />
            )}
            {entry.isDirectory && expanded && childTree?.state === 'error' && (
              <div className="px-3 py-1 text-[10px] text-pi-error" style={{ paddingLeft: 24 + depth * 14 }}>
                {childTree.error ?? t('rightPanel.unableLoadFolder')}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function WorkspaceFileContextMenu({
  state,
  onOpen,
  onAddToChat,
  onOpenStandalone,
  onRevealInExplorer,
  onCopyPath,
  onDelete,
}: {
  state: { x: number; y: number; entry: WorkspaceTreeEntry };
  onOpen: (entry: WorkspaceTreeEntry) => void;
  onAddToChat: (entry: WorkspaceTreeEntry) => void;
  onOpenStandalone: (entry: WorkspaceTreeEntry) => void;
  onRevealInExplorer: (entry: WorkspaceTreeEntry) => void;
  onCopyPath: (entry: WorkspaceTreeEntry) => void;
  onDelete: (entry: WorkspaceTreeEntry) => void;
}) {
  const { t } = useI18n();
  const menuLeft = typeof window === 'undefined'
    ? state.x
    : Math.min(state.x, Math.max(8, window.innerWidth - 232));
  const menuTop = typeof window === 'undefined'
    ? state.y
    : Math.min(state.y, Math.max(8, window.innerHeight - 236));
  const entry = state.entry;

  return (
    <div
      className="fixed z-[110] w-56 overflow-hidden rounded-lg border border-pi-border bg-pi-bg-secondary/95 py-1 shadow-2xl shadow-black/30 backdrop-blur-xl"
      style={{ left: menuLeft, top: menuTop }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <WorkspaceFileMenuButton icon={entry.isDirectory ? FolderOpen : File} label={t('rightPanel.fileMenu.open')} onClick={() => onOpen(entry)} />
      <WorkspaceFileMenuButton
        icon={MessageSquarePlus}
        label={t('rightPanel.fileMenu.addToChat')}
        disabled={entry.isDirectory}
        onClick={() => onAddToChat(entry)}
      />
      <WorkspaceFileMenuButton
        icon={ExternalLink}
        label={t('rightPanel.fileMenu.openStandalone')}
        disabled={entry.isDirectory}
        onClick={() => onOpenStandalone(entry)}
      />
      <WorkspaceFileMenuButton
        icon={FolderOpen}
        label={t('rightPanel.fileMenu.revealInExplorer')}
        onClick={() => onRevealInExplorer(entry)}
      />
      <div className="my-1 h-px bg-pi-border/70" />
      <WorkspaceFileMenuButton icon={Copy} label={t('rightPanel.fileMenu.copyPath')} onClick={() => onCopyPath(entry)} />
      <WorkspaceFileMenuButton icon={Trash2} label={t('rightPanel.fileMenu.delete')} tone="danger" onClick={() => onDelete(entry)} />
    </div>
  );
}

function WorkspaceFileMenuButton({
  icon: Icon,
  label,
  disabled = false,
  tone = 'normal',
  onClick,
}: {
  icon: typeof File;
  label: string;
  disabled?: boolean;
  tone?: 'normal' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        tone === 'danger'
          ? 'text-pi-error hover:bg-pi-error/10'
          : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
      )}
    >
      <Icon size={13} className="flex-shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function PreviewTabs({
  tabs,
  activeId,
  onActivate,
  onClose,
  onCloseTabs,
  onRevealInExplorer,
}: {
  tabs: PreviewTab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseTabs: (scope: PreviewTabCloseScope, id: string) => void;
  onRevealInExplorer: (path: string) => void;
}) {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;

    const close = () => setContextMenu(null);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  if (tabs.length === 0) return null;

  const menuIndex = contextMenu ? tabs.findIndex((tab) => tab.id === contextMenu.tabId) : -1;
  const menuLeft = contextMenu
    ? typeof window === 'undefined'
      ? contextMenu.x
      : Math.min(contextMenu.x, Math.max(8, window.innerWidth - 188))
    : 0;
  const menuTop = contextMenu
    ? typeof window === 'undefined'
      ? contextMenu.y
      : Math.min(contextMenu.y, Math.max(8, window.innerHeight - 184))
    : 0;
  const runTabAction = (scope: PreviewTabCloseScope) => {
    if (!contextMenu) return;
    onCloseTabs(scope, contextMenu.tabId);
    setContextMenu(null);
  };
  const revealContextTab = () => {
    if (!contextMenu) return;
    const tab = tabs.find((item) => item.id === contextMenu.tabId);
    if (!tab) return;
    onRevealInExplorer(tab.target.path);
    setContextMenu(null);
  };

  return (
    <>
      <div className="h-8 flex items-center gap-1 px-2 border-b border-pi-border overflow-x-auto flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onActivate(tab.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onActivate(tab.id);
              setContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
            }}
            className={cn(
              'group h-6 max-w-[180px] flex items-center gap-1.5 rounded px-2 text-[10px] border transition-colors',
              activeId === tab.id
                ? 'border-pi-accent/40 bg-pi-selected-bg text-pi-accent'
                : 'border-transparent text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
            )}
            title={tab.target.path}
          >
            {tab.target.kind === 'diff' ? <GitCompare size={11} /> : <File size={11} />}
            <span className="truncate">{tab.title}</span>
            <span
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded opacity-60 hover:bg-pi-bg-tertiary hover:text-pi-error group-hover:opacity-100"
              title={t('rightPanel.closePreview')}
            >
              <X size={10} />
            </span>
          </button>
        ))}
      </div>

      {contextMenu && menuIndex >= 0 && (
        <div
          className="fixed z-50 w-44 overflow-hidden rounded-md border border-pi-border bg-pi-bg-secondary py-1 shadow-xl"
          style={{ left: menuLeft, top: menuTop }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <PreviewTabMenuButton label={t('rightPanel.fileMenu.revealInExplorer')} onClick={revealContextTab} />
          <div className="my-1 h-px bg-pi-border" />
          <PreviewTabMenuButton label={t('common.close')} onClick={() => runTabAction('current')} />
          <PreviewTabMenuButton label={t('common.closeOthers')} disabled={tabs.length <= 1} onClick={() => runTabAction('others')} />
          <PreviewTabMenuButton label={t('common.closeTabsLeft')} disabled={menuIndex === 0} onClick={() => runTabAction('left')} />
          <PreviewTabMenuButton label={t('common.closeTabsRight')} disabled={menuIndex === tabs.length - 1} onClick={() => runTabAction('right')} />
          <div className="my-1 h-px bg-pi-border" />
          <PreviewTabMenuButton label={t('common.closeAll')} disabled={tabs.length === 0} tone="danger" onClick={() => runTabAction('all')} />
        </div>
      )}
    </>
  );
}

function PreviewTabMenuButton({
  label,
  disabled = false,
  tone = 'normal',
  onClick,
}: {
  label: string;
  disabled?: boolean;
  tone?: 'normal' | 'danger';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full px-3 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        tone === 'danger'
          ? 'text-pi-error hover:bg-pi-error/10'
          : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
      )}
    >
      {label}
    </button>
  );
}

function PreviewHeader({
  tab,
  selection,
  collapsed,
  showStandalone,
  onToggleCollapse,
  onCopyPath,
  onAddToChat,
  onAddSelection,
  onOpenStandalone,
}: {
  tab: PreviewTab | null;
  selection?: LineSelection;
  collapsed: boolean;
  showStandalone: boolean;
  onToggleCollapse: () => void;
  onCopyPath: () => void;
  onAddToChat: () => void;
  onAddSelection: () => void;
  onOpenStandalone: () => void;
}) {
  const { t } = useI18n();
  const target = tab?.target ?? null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggleCollapse}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggleCollapse();
        }
      }}
      className="h-9 flex items-center gap-2 px-3 border-b border-pi-border flex-shrink-0 cursor-pointer transition-colors hover:bg-pi-bg-hover/70"
      title={collapsed ? t('rightPanel.expandPreview') : t('rightPanel.collapsePreview')}
    >
      {collapsed ? <ChevronRight size={13} className="text-pi-dim flex-shrink-0" /> : <ChevronDown size={13} className="text-pi-dim flex-shrink-0" />}
      <Code2 size={13} className="text-pi-dim flex-shrink-0" />
      <span className="text-xs font-medium text-pi-text truncate">
        {target ? target.path : t('rightPanel.preview')}
      </span>
      {target && (
        <>
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-pi-bg-tertiary text-pi-dim uppercase">
            {target.kind === 'diff' ? t('rightPanel.kind.diff') : t('rightPanel.kind.file')}
          </span>
          {selection && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onAddSelection();
              }}
              className="h-6 px-2 rounded flex items-center gap-1 text-[10px] text-pi-accent bg-pi-accent/10 hover:bg-pi-accent/20 transition-colors"
              title={t('rightPanel.addSelectedLinesToChat')}
            >
              <MessageSquarePlus size={11} />
              <span>{formatLineRange(selection)}</span>
            </button>
          )}
          <button
            onClick={(event) => {
              event.stopPropagation();
              onAddToChat();
            }}
            className="w-6 h-6 rounded flex items-center justify-center text-pi-dim hover:text-pi-text hover:bg-pi-bg-hover transition-colors"
            title={t('rightPanel.addToChat')}
          >
            <MessageSquarePlus size={12} />
          </button>
          {showStandalone && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onOpenStandalone();
              }}
              className="w-6 h-6 rounded flex items-center justify-center text-pi-dim hover:text-pi-text hover:bg-pi-bg-hover transition-colors"
              title={t('rightPanel.openStandalone')}
            >
              <ExternalLink size={12} />
            </button>
          )}
          <button
            onClick={(event) => {
              event.stopPropagation();
              onCopyPath();
            }}
            className="w-6 h-6 rounded flex items-center justify-center text-pi-dim hover:text-pi-text hover:bg-pi-bg-hover transition-colors"
            title={t('rightPanel.copyPath')}
          >
            <Copy size={12} />
          </button>
        </>
      )}
    </div>
  );
}

function PreviewContent({
  sessionId,
  tab,
  selection,
  onLineClick,
  onMarkdownSaved,
}: {
  sessionId: string;
  tab: PreviewTab | null;
  selection?: LineSelection;
  onLineClick: (tab: PreviewTab, lineNumber: number, event: MouseEvent<HTMLButtonElement>) => void;
  onMarkdownSaved: (tab: PreviewTab, content: string, result: WorkspaceWriteFileResult) => void;
}) {
  const { t } = useI18n();
  if (!tab) {
    return <PanelInline icon={Code2} message={t('rightPanel.selectPreview')} />;
  }
  if (tab.state === 'loading') {
    return <PanelInline icon={RefreshCw} message={t('rightPanel.loadingPreview')} spinning />;
  }
  if (tab.state === 'error') {
    return <PanelInline icon={Code2} message={tab.error} tone="error" />;
  }
  if (tab.state === 'diff') {
    const data = tab.data;
    if (data.state === 'not_git_repo') return <PanelInline icon={GitCompare} message={t('rightPanel.diffOnlyGit')} />;
    if (data.state !== 'ok') return <PanelInline icon={GitCompare} message={data.error ?? t('rightPanel.unableLoadDiff')} tone="error" />;
    if (!data.diff?.trim()) return <PanelInline icon={GitCompare} message={t('rightPanel.noDiff')} />;
    return <CodePreview value={data.diff} mode="diff" selection={selection} onLineClick={(line, event) => onLineClick(tab, line, event)} />;
  }

  const data = tab.data;
  if (data.state === 'missing') return <PanelInline icon={File} message={t('rightPanel.fileMissing')} tone="error" />;
  if (data.state === 'binary') return <PanelInline icon={File} message={t('rightPanel.binaryPreviewUnavailable')} />;
  if (data.state === 'too_large') return <PanelInline icon={File} message={t('rightPanel.fileTooLarge', { size: formatBytes(data.size) })} />;
  if (data.state === 'error') return <PanelInline icon={File} message={data.error ?? t('rightPanel.unableLoadFile')} tone="error" />;
  if (data.previewType === 'image' && data.dataUrl) {
    return (
      <div className="flex-1 overflow-auto p-3">
        <img src={data.dataUrl} alt={data.path} className="max-w-full rounded-md border border-pi-border bg-pi-bg-tertiary" />
      </div>
    );
  }
  if (isMarkdownFile(data.path, data.language)) {
    return (
      <MarkdownFileReader
        sessionId={sessionId}
        filePath={data.path}
        initialContent={data.content ?? ''}
        initialSize={data.size}
        embedded
        onSaved={(content, result) => onMarkdownSaved(tab, content, result)}
      />
    );
  }
  return (
    <CodePreview
      value={data.content ?? ''}
      mode="file"
      truncated={data.truncated}
      size={data.size}
      selection={selection}
      onLineClick={(line, event) => onLineClick(tab, line, event)}
    />
  );
}

function CodePreview({
  value,
  mode,
  truncated,
  size,
  selection,
  onLineClick,
}: {
  value: string;
  mode: 'file' | 'diff';
  truncated?: boolean;
  size?: number;
  selection?: LineSelection;
  onLineClick: (lineNumber: number, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useI18n();
  const lines = value.split('\n');
  return (
    <div className="flex-1 overflow-auto bg-pi-bg">
      <pre className="min-w-max py-2 text-[11px] leading-[1.55] font-mono">
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const added = mode === 'diff' && line.startsWith('+') && !line.startsWith('+++');
          const removed = mode === 'diff' && line.startsWith('-') && !line.startsWith('---');
          const hunk = mode === 'diff' && line.startsWith('@@');
          const selected = Boolean(selection && lineNumber >= selection.start && lineNumber <= selection.end);
          return (
            <div
              key={index}
              className={cn(
                'grid grid-cols-[42px_1fr] gap-2 px-3',
                added && 'bg-pi-success/10 text-pi-success',
                removed && 'bg-pi-error/10 text-pi-error',
                hunk && 'bg-pi-accent/10 text-pi-accent',
                !added && !removed && !hunk && 'text-pi-tool-output hover:bg-pi-bg-hover/50',
                selected && 'bg-pi-selected-bg text-pi-text'
              )}
            >
              <button
                onClick={(event) => onLineClick(lineNumber, event)}
                className={cn(
                  'select-none text-right text-pi-dim hover:text-pi-accent cursor-pointer',
                  selected && 'text-pi-accent font-semibold'
                )}
                title={t('rightPanel.selectLineHint')}
              >
                {lineNumber}
              </button>
              <span className="whitespace-pre pr-4">{line || ' '}</span>
            </div>
          );
        })}
      </pre>
      {truncated && (
        <div className="sticky bottom-0 border-t border-pi-border bg-pi-bg-secondary px-3 py-2 text-[11px] text-pi-dim">
          {t('rightPanel.previewTruncated', { read: formatBytes(1024 * 1024), size: formatBytes(size ?? 0) })}
        </div>
      )}
    </div>
  );
}

function PanelInline({ icon: Icon, message, tone = 'muted', spinning = false }: { icon: typeof GitCompare; message: string; tone?: 'muted' | 'error'; spinning?: boolean }) {
  return (
    <div className={cn('h-full flex flex-col items-center justify-center px-4 py-8 gap-2 text-center', tone === 'error' ? 'text-pi-error' : 'text-pi-dim')}>
      <Icon size={22} strokeWidth={1.5} className={spinning ? 'animate-spin' : ''} />
      <p className="text-xs leading-relaxed">{message}</p>
    </div>
  );
}

function PanelEmpty({ icon: Icon, message }: { icon: typeof GitCompare; message: string }) {
  return (
    <div className="flex-1">
      <PanelInline icon={Icon} message={message} />
    </div>
  );
}

function PanelComingSoon({ icon: Icon, title, message }: { icon: typeof GitCompare; title: string; message: string }) {
  return (
    <div className="flex-1 p-4">
      <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-pi-dim">
        <Icon size={26} strokeWidth={1.4} />
        <h3 className="text-xs font-semibold text-pi-muted">{title}</h3>
        <p className="text-xs leading-relaxed max-w-[260px]">{message}</p>
      </div>
    </div>
  );
}

function collectAncestors(sessions: Session[], session: Session): Session[] {
  const byId = new Map(sessions.map((item) => [item.id, item]));
  const ancestors: Session[] = [];
  const seen = new Set<string>();
  let current = session;

  while (current.parentSessionId && !seen.has(current.parentSessionId)) {
    seen.add(current.parentSessionId);
    const parent = byId.get(current.parentSessionId);
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }

  return ancestors;
}

function summarizeMessage(message: ChatMessage): string {
  const text = message.content
    .map((part) => {
      if (part.type === 'text') return part.text ?? '';
      if (part.type === 'tool_use') return `[tool: ${part.toolUse?.name ?? 'tool'}]`;
      if (part.type === 'tool_result') return part.toolResult?.isError ? '[tool error]' : '[tool result]';
      if (part.type === 'thinking') return part.thinking?.content ?? '';
      if (part.type === 'image') return `[image: ${part.image?.fileName ?? part.image?.mimeType ?? 'image'}]`;
      return '';
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text) return text.length > 240 ? `${text.slice(0, 240)}...` : text;
  if (message.thinking?.content) return message.thinking.content.slice(0, 240);
  if (message.toolCalls?.length) return message.toolCalls.map((tool) => `[tool: ${tool.name}]`).join(' ');
  return '(empty checkpoint)';
}

function previewTabId(target: PreviewTarget): string {
  return `${target.kind}:${target.path}`;
}

function changedFileKey(file: WorkspaceChangedFile): string {
  return `${file.status}:${file.path}:${file.oldPath ?? ''}`;
}

function normalizeWorkspaceFilePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function immediateParentWorkspacePath(filePath: string): string {
  const parts = normalizeWorkspaceFilePath(filePath).split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function parentWorkspacePaths(filePath: string): string[] {
  const parts = normalizeWorkspaceFilePath(filePath).split('/').filter(Boolean);
  const parents: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    parents.push(parts.slice(0, index).join('/'));
  }
  return parents;
}

function isWorkspacePathWithin(candidatePath: string, containerPath: string): boolean {
  const candidate = normalizeWorkspaceFilePath(candidatePath);
  const container = normalizeWorkspaceFilePath(containerPath);
  if (!candidate || !container) return candidate === container;
  return candidate === container || candidate.startsWith(`${container}/`);
}

function isDragEndOutsideWindow(event: DragEvent<HTMLElement>): boolean {
  if (typeof window === 'undefined') return false;
  const left = window.screenX;
  const top = window.screenY;
  const right = left + window.outerWidth;
  const bottom = top + window.outerHeight;
  return event.screenX < left || event.screenX > right || event.screenY < top || event.screenY > bottom;
}

function shouldDetachWorkspaceDrag(event: DragEvent<HTMLElement>): boolean {
  if (isDragEndOutsideWindow(event)) return true;
  if (typeof window === 'undefined') return false;

  const { clientX, clientY } = event;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;

  const edgePadding = 1;
  return (
    clientX <= edgePadding ||
    clientY <= edgePadding ||
    clientX >= window.innerWidth - edgePadding ||
    clientY >= window.innerHeight - edgePadding
  );
}

function previewTitle(target: PreviewTarget): string {
  const name = target.path.split('/').filter(Boolean).pop() ?? target.path;
  return target.kind === 'diff' ? `${name} diff` : name;
}

function isMarkdownFile(filePath: string, language?: string): boolean {
  if (language === 'markdown') return true;
  return /\.(md|markdown|mdx)$/i.test(filePath);
}

function upsertPreviewTab(tabs: PreviewTab[], nextTab: PreviewTab): PreviewTab[] {
  if (tabs.some((tab) => tab.id === nextTab.id)) {
    return tabs.map((tab) => (tab.id === nextTab.id ? nextTab : tab));
  }
  return [...tabs, nextTab];
}

function excerptFromPreview(tab: PreviewTab, selection: LineSelection): string {
  const value =
    tab.state === 'file'
      ? tab.data.content ?? ''
      : tab.state === 'diff'
        ? tab.data.diff ?? ''
        : '';

  const lines = value.split('\n');
  return lines.slice(selection.start - 1, selection.end).join('\n');
}

function formatLineRange(selection: LineSelection): string {
  return selection.start === selection.end ? `L${selection.start}` : `L${selection.start}-L${selection.end}`;
}

function terminalStatusLabel(status: 'starting' | 'running' | 'exited' | 'error', t: (key: TranslationKey, values?: Record<string, string | number>) => string): string {
  if (status === 'starting') return t('rightPanel.terminal.status.starting');
  if (status === 'running') return t('rightPanel.terminal.status.running');
  if (status === 'exited') return t('rightPanel.terminal.status.exited');
  return t('rightPanel.terminal.status.error');
}

function zeroUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function addUsage(total: TokenUsage, usage: TokenUsage | undefined): TokenUsage {
  if (!usage) return total;
  return {
    input: total.input + usage.input,
    output: total.output + usage.output,
    cacheRead: total.cacheRead + usage.cacheRead,
    cacheWrite: total.cacheWrite + usage.cacheWrite,
    cost: total.cost + usage.cost,
  };
}

function modelForSession(session: Session | undefined, models: ModelInfo[], fallback: ModelInfo | null): ModelInfo | null {
  if (!session) return fallback;
  const provider = session.modelProvider;
  return models.find((model) => model.id === session.modelId && (!provider || model.provider === provider))
    ?? models.find((model) => model.id === session.modelId)
    ?? fallback;
}

function estimateContextTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((total, message) => {
    const text = message.content.map((part) => {
      if (part.type === 'text') return part.text ?? '';
      if (part.type === 'thinking') return part.thinking?.content ?? '';
      if (part.type === 'image') return `[image: ${part.image?.fileName ?? part.image?.mimeType ?? 'image'}]`;
      if (part.type === 'tool_use') return JSON.stringify(part.toolUse?.args ?? {});
      if (part.type === 'tool_result') return part.toolResult?.content ?? '';
      return '';
    }).join('\n');
    return total + text.length + (message.thinking?.content.length ?? 0);
  }, 0);

  return Math.ceil(chars / 4);
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatCostValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value < 0.01) return '<$0.01';
  return `$${value.toFixed(2)}`;
}

function formatRelativeTime(timestamp: number, t: (key: TranslationKey, values?: Record<string, string | number>) => string): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return t('time.justNow');
  if (diff < 3_600_000) return t('time.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('time.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  return t('time.daysAgo', { count: Math.floor(diff / 86_400_000) });
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
