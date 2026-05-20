import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Code2, FileText, FolderOpen, Loader2, MessageSquarePlus, Terminal as TerminalIcon, X, type LucideIcon } from 'lucide-react';
import { piApi } from '../../api/client';
import { useStandaloneRuntimeSettings } from '../../hooks/useStandaloneRuntimeSettings';
import { useI18n } from '../../lib/i18n';
import { useUIStore } from '../../stores/uiStore';
import { DesktopTitleBar } from '../desktop/DesktopTitleBar';
import { ToastContainer } from '../shared/ToastContainer';
import { cn } from '../shared/utils';
import { hasWorkspaceFileDragPayload, readWorkspaceFileDragPayload } from '../../lib/workspaceDrag';
import { MarkdownFileReader } from '../markdown/MarkdownFileReader';
import { CodeFileViewer } from '../workspace/CodeFileViewer';
import { TerminalPanel } from '../layout/RightPanel';

const STANDALONE_TAB_MIME = 'application/x-pi-agent-standalone-tab';

export function isStandaloneTabsRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('desktopView') === 'standalone-tabs';
}

export function StandaloneTabsView() {
  useStandaloneRuntimeSettings();
  const { t } = useI18n();
  const [state, setState] = useState<'booting' | 'ready' | 'error'>('booting');
  const [error, setError] = useState<string | null>(null);
  const [tabsState, setTabsState] = useState<DesktopStandaloneTabsState>({ groupId: '', tabs: [], activeTabId: null });

  useEffect(() => {
    let disposed = false;

    async function boot() {
      try {
        if (!window.piDesktop) {
          throw new Error(t('standalone.tabsOnlyDesktop'));
        }
        await piApi.configureFromDesktopShell();
        piApi.connect();
        const nextState = await window.piDesktop.getStandaloneTabs();
        if (!disposed) {
          setTabsState(nextState);
          setState('ready');
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
          setState('error');
        }
      }
    }

    const disposeTabs = window.piDesktop?.onStandaloneTabs((nextState) => {
      setTabsState(nextState);
    });

    void boot();
    return () => {
      disposed = true;
      disposeTabs?.();
      piApi.disconnect();
    };
  }, [t]);

  const activeTab = useMemo(
    () => tabsState.tabs.find((tab) => tab.id === tabsState.activeTabId) ?? tabsState.tabs[0] ?? null,
    [tabsState.activeTabId, tabsState.tabs]
  );

  const allowWorkspaceFileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasWorkspaceFileDragPayload(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const openDroppedWorkspaceFile = async (event: DragEvent<HTMLDivElement>) => {
    const payload = readWorkspaceFileDragPayload(event.dataTransfer);
    if (!payload || payload.isDirectory) return;
    event.preventDefault();
    event.stopPropagation();
    await window.piDesktop?.openWorkspaceFileTab(payload.sessionId, payload.path);
  };

  if (state === 'booting') {
    return (
      <StandaloneFrame title={t('standalone.tabsTitle')}>
        <div className="flex h-full items-center justify-center text-pi-muted">
          <Loader2 size={18} className="mr-2 animate-spin" />
          {t('standalone.tabsLoading')}
        </div>
      </StandaloneFrame>
    );
  }

  if (state === 'error') {
    return (
      <StandaloneFrame title={t('standalone.tabsTitle')}>
        <div className="flex h-full items-center justify-center px-6 text-pi-text">
          <div className="max-w-lg rounded-lg border border-pi-error/30 bg-pi-error/10 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-pi-error">
              <AlertTriangle size={16} />
              {t('standalone.tabsFailed')}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-pi-muted">{error}</p>
          </div>
        </div>
      </StandaloneFrame>
    );
  }

  return (
    <StandaloneFrame title={activeTab ? `${activeTab.title} - ${t('standalone.tabsTitle')}` : t('standalone.tabsTitle')}>
      <StandaloneTabStrip tabsState={tabsState} />
      <div className="min-h-0 flex-1 overflow-hidden" onDragOver={allowWorkspaceFileDrop} onDrop={(event) => void openDroppedWorkspaceFile(event)}>
        {tabsState.tabs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-pi-dim">
            {t('standalone.tabsEmpty')}
          </div>
        ) : (
          tabsState.tabs.map((tab) => (
            <div
              key={tab.id}
              className="h-full min-h-0 overflow-hidden"
              style={{ display: tab.id === tabsState.activeTabId ? undefined : 'none' }}
            >
              <StandaloneTabContent tab={tab} />
            </div>
          ))
        )}
      </div>
    </StandaloneFrame>
  );
}

function StandaloneTabStrip({ tabsState }: { tabsState: DesktopStandaloneTabsState }) {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
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

  const activateTab = async (tabId: string) => {
    await window.piDesktop?.activateStandaloneTab(tabId);
  };

  const closeTab = async (tabId: string) => {
    await window.piDesktop?.closeStandaloneTab(tabId);
  };

  const dragTab = (event: DragEvent<HTMLDivElement>, tab: DesktopStandaloneTab) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(STANDALONE_TAB_MIME, JSON.stringify({ tabId: tab.id, groupId: tabsState.groupId }));
    event.dataTransfer.setData('text/plain', tab.title);
    void activateTab(tab.id);
  };

  const detachTab = async (event: DragEvent<HTMLDivElement>, tab: DesktopStandaloneTab) => {
    if (event.dataTransfer.dropEffect === 'move') return;
    await window.piDesktop?.detachStandaloneTab(tab.id, {
      x: event.screenX,
      y: event.screenY,
      sourceGroupId: tabsState.groupId,
    });
  };

  const allowTabDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(STANDALONE_TAB_MIME) && !hasWorkspaceFileDragPayload(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = hasWorkspaceFileDragPayload(event.dataTransfer) ? 'copy' : 'move';
  };

  const moveDroppedTab = async (event: DragEvent<HTMLDivElement>) => {
    const filePayload = readWorkspaceFileDragPayload(event.dataTransfer);
    if (filePayload && !filePayload.isDirectory) {
      event.preventDefault();
      await window.piDesktop?.openWorkspaceFileTab(filePayload.sessionId, filePayload.path);
      return;
    }

    const raw = event.dataTransfer.getData(STANDALONE_TAB_MIME);
    if (!raw || !tabsState.groupId) return;

    event.preventDefault();
    try {
      const payload = JSON.parse(raw) as { tabId?: string };
      if (payload.tabId) {
        await window.piDesktop?.moveStandaloneTab(payload.tabId, tabsState.groupId);
      }
    } catch {
      // Ignore foreign drag payloads.
    }
  };

  const contextTab = contextMenu ? tabsState.tabs.find((tab) => tab.id === contextMenu.tabId) ?? null : null;
  const contextTabIndex = contextTab ? tabsState.tabs.findIndex((tab) => tab.id === contextTab.id) : -1;
  const contextMenuLeft = contextMenu
    ? typeof window === 'undefined'
      ? contextMenu.x
      : Math.min(contextMenu.x, Math.max(8, window.innerWidth - 220))
    : 0;
  const contextMenuTop = contextMenu
    ? typeof window === 'undefined'
      ? contextMenu.y
      : Math.min(contextMenu.y, Math.max(8, window.innerHeight - 188))
    : 0;

  const addTabToChat = async (tab: DesktopStandaloneTab) => {
    if (!tab.filePath) return;

    try {
      const accepted = await window.piDesktop?.addWorkspaceReference({
        sessionId: tab.sessionId,
        path: tab.filePath,
        name: tab.title,
        sourceKind: 'file',
      });

      if (!accepted) {
        throw new Error(t('rightPanel.standaloneOnlyDesktop'));
      }

      addToast({ type: 'success', message: t('rightPanel.addedFileReference') });
    } catch (err) {
      addToast({
        type: 'error',
        message: t('rightPanel.fileOperationFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    } finally {
      setContextMenu(null);
    }
  };

  const revealTabInExplorer = async (tab: DesktopStandaloneTab) => {
    if (!tab.filePath) return;

    try {
      const workspace = await piApi.getWorkspaceStatus(tab.sessionId);
      if (workspace.state !== 'ok') {
        throw new Error(workspace.error ?? t('rightPanel.workspaceMissing'));
      }

      const result = await window.piDesktop?.revealWorkspacePath(workspace.workDir, tab.filePath);
      if (!result?.ok) {
        throw new Error(result?.error ?? t('rightPanel.revealInExplorerFailed'));
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: t('rightPanel.revealInExplorerFailedWithMessage', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    } finally {
      setContextMenu(null);
    }
  };

  return (
    <>
      <div
        className="flex h-10 flex-shrink-0 items-end border-b border-pi-border bg-pi-bg-secondary/80 px-2"
        title={t('standalone.tabsDragHint')}
        onDragOver={allowTabDrop}
        onDrop={(event) => void moveDroppedTab(event)}
      >
        <div className="scrollbar-none flex min-w-0 flex-1 items-end gap-1 overflow-x-auto" role="tablist">
          {tabsState.tabs.map((tab) => {
            const active = tab.id === tabsState.activeTabId;
            const Icon = tab.type === 'terminal' ? TerminalIcon : tab.type === 'markdown' ? FileText : Code2;

            return (
              <div
                key={tab.id}
                draggable
                onDragStart={(event) => dragTab(event, tab)}
                onDragEnd={(event) => void detachTab(event, tab)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void activateTab(tab.id);
                  setContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
                }}
                className={cn(
                  'group flex h-8 min-w-[148px] max-w-[260px] cursor-grab items-center gap-2 rounded-t-lg border px-2 text-left text-xs transition-colors active:cursor-grabbing',
                  active
                    ? 'border-pi-accent/40 border-b-pi-bg bg-pi-accent/10 text-pi-accent shadow-sm shadow-black/20'
                    : 'border-transparent border-b-pi-border bg-transparent text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
                )}
                title={tab.filePath ?? tab.title}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => void activateTab(tab.id)}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 text-left focus:outline-none"
                >
                  <Icon size={12} className={cn('flex-shrink-0', active ? 'text-pi-accent' : 'text-pi-dim')} />
                  <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTab(tab.id);
                  }}
                  className={cn(
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-error',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                  title={t('common.close')}
                  aria-label={t('common.close')}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {contextMenu && contextTab && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[120] w-52 overflow-hidden rounded-lg border border-pi-border bg-pi-bg-secondary/95 py-1 shadow-2xl shadow-black/30 backdrop-blur-xl"
          style={{ left: contextMenuLeft, top: contextMenuTop }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <StandaloneTabMenuButton
            icon={MessageSquarePlus}
            label={t('rightPanel.fileMenu.addToChat')}
            disabled={!contextTab.filePath}
            onClick={() => void addTabToChat(contextTab)}
          />
          <StandaloneTabMenuButton
            icon={FolderOpen}
            label={t('rightPanel.fileMenu.revealInExplorer')}
            disabled={!contextTab.filePath}
            onClick={() => void revealTabInExplorer(contextTab)}
          />
          <div className="my-1 h-px bg-pi-border/70" />
          <StandaloneTabMenuButton
            icon={X}
            label={t('common.close')}
            onClick={() => {
              setContextMenu(null);
              void closeTab(contextTab.id);
            }}
          />
          <StandaloneTabMenuButton
            icon={X}
            label={t('common.closeOthers')}
            disabled={tabsState.tabs.length <= 1}
            onClick={() => {
              setContextMenu(null);
              tabsState.tabs
                .filter((tab) => tab.id !== contextTab.id)
                .forEach((tab) => void closeTab(tab.id));
            }}
          />
          <StandaloneTabMenuButton
            icon={X}
            label={t('common.closeTabsLeft')}
            disabled={contextTabIndex <= 0}
            onClick={() => {
              setContextMenu(null);
              tabsState.tabs
                .slice(0, contextTabIndex)
                .forEach((tab) => void closeTab(tab.id));
            }}
          />
          <StandaloneTabMenuButton
            icon={X}
            label={t('common.closeTabsRight')}
            disabled={contextTabIndex < 0 || contextTabIndex >= tabsState.tabs.length - 1}
            onClick={() => {
              setContextMenu(null);
              tabsState.tabs
                .slice(contextTabIndex + 1)
                .forEach((tab) => void closeTab(tab.id));
            }}
          />
        </div>,
        document.body
      )}
    </>
  );
}

function StandaloneTabMenuButton({
  icon: Icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-not-allowed disabled:opacity-45"
    >
      <Icon size={13} className="flex-shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function StandaloneTabContent({ tab }: { tab: DesktopStandaloneTab }) {
  if (tab.type === 'terminal') {
    return <TerminalPanel sessionId={tab.sessionId} showDockControl={false} />;
  }

  if (tab.type === 'markdown' && tab.filePath) {
    return <MarkdownFileReader sessionId={tab.sessionId} filePath={tab.filePath} />;
  }

  if (tab.type === 'workspace-file' && tab.filePath) {
    return <CodeFileViewer sessionId={tab.sessionId} filePath={tab.filePath} />;
  }

  return null;
}

function StandaloneFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pi-shell flex h-screen w-screen flex-col text-pi-text">
      <DesktopTitleBar title={title} showMenus={false} />
      <div className="min-h-0 flex flex-1 flex-col overflow-hidden">{children}</div>
      <ToastContainer />
    </div>
  );
}
