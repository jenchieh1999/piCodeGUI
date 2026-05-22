import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { MessageList } from './MessageList';
import { ChatInput, type QueuedFollowUpItem, type QueuedFollowUpDraft } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { piApi } from '../../api/client';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ChatMessage, ImageAttachment } from '../../types';
import { useSettingsStore } from '../../stores/settingsStore';
import { TerminalPanel } from '../layout/RightPanel';
import { cn } from '../shared/utils';
import { useI18n } from '../../lib/i18n';

const EMPTY_MESSAGES: ChatMessage[] = [];
const TERMINAL_DOCK_MIN_HEIGHT = 140;
const TERMINAL_DOCK_MAX_HEIGHT = 520;
type ChatInputSendMode = 'prompt' | 'steer' | 'follow_up';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function nextQueuedFollowUpId() {
  return `queued-follow-up-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ChatView() {
  const { t } = useI18n();
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const messages = useChatStore((s) => (activeSessionId ? s.messagesBySession[activeSessionId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingSessionId = useChatStore((s) => s.streamingSessionId);
  const activeSessionStatus = useChatStore((s) => (activeSessionId ? s.sessionStatuses[activeSessionId] : undefined));
  const activeSession = useChatStore((s) => s.sessions.find((ss) => ss.id === activeSessionId));
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const addToast = useUIStore((s) => s.addToast);
  const terminalDockOpen = useUIStore((s) => s.terminalDockOpen);
  const terminalDockHeight = useUIStore((s) => s.terminalDockHeight);
  const setTerminalDockHeight = useUIStore((s) => s.setTerminalDockHeight);
  const chatBackgroundImage = useSettingsStore((s) => s.chatBackgroundImage);
  const chatBackgroundDim = useSettingsStore((s) => s.chatBackgroundDim);
  const [isResizingTerminalDock, setIsResizingTerminalDock] = useState(false);
  const [queuedFollowUpsBySession, setQueuedFollowUpsBySession] = useState<Record<string, QueuedFollowUpItem[]>>({});
  const resizeStateRef = useRef({ startY: 0, startHeight: terminalDockHeight });
  const autoSendingQueuedRef = useRef(false);

  const queuedFollowUps = activeSessionId ? queuedFollowUpsBySession[activeSessionId] ?? [] : [];
  const isActiveSessionBusy = Boolean(
    activeSessionId &&
    ((isStreaming && streamingSessionId === activeSessionId) || activeSessionStatus === 'running')
  );

  // Reset streaming state when session changes
  useEffect(() => {
    if (activeSessionId) {
      useChatStore.getState().setStreaming(null, null);
    }
  }, [activeSessionId]);

  const sendToRuntime = useCallback((
    sessionId: string,
    text: string,
    images?: ImageAttachment[],
    displayText?: string,
    mode: ChatInputSendMode = 'prompt'
  ): boolean => {
    const visibleText = displayText ?? text;
    const sent = piApi.send({
      type: mode === 'follow_up' ? 'prompt' : mode,
      sessionId,
      message: text,
      images,
    });
    if (!sent) {
      addToast({
        type: 'error',
        message: 'Pi server is not connected. Please wait for reconnect or restart the local server.',
        duration: 6000,
      });
      return false;
    }
    addUserMessage(sessionId, visibleText, images);
    return true;
  }, [addToast, addUserMessage]);

  const handleSend = (
    text: string,
    images?: ImageAttachment[],
    displayText?: string,
    mode?: ChatInputSendMode,
    draft?: QueuedFollowUpDraft
  ): boolean => {
    if (!activeSessionId) return false;
    const visibleText = displayText ?? text;
    const messageType: ChatInputSendMode = mode ?? (isActiveSessionBusy ? 'follow_up' : 'prompt');

    if (isActiveSessionBusy && messageType === 'follow_up') {
      const item: QueuedFollowUpItem = {
        id: nextQueuedFollowUpId(),
        text,
        displayText: visibleText,
        images,
        draft,
        createdAt: Date.now(),
      };
      setQueuedFollowUpsBySession((current) => ({
        ...current,
        [activeSessionId]: [...(current[activeSessionId] ?? []), item],
      }));
      return true;
    }

    return sendToRuntime(activeSessionId, text, images, displayText, messageType);
  };

  const sendNextQueuedFollowUp = useCallback((sessionId: string): boolean => {
    if (autoSendingQueuedRef.current) return false;
    const next = queuedFollowUpsBySession[sessionId]?.[0];
    if (!next) return false;

    autoSendingQueuedRef.current = true;
    setQueuedFollowUpsBySession((current) => {
      const items = current[sessionId] ?? [];
      return { ...current, [sessionId]: items.slice(1) };
    });

    window.setTimeout(() => {
      const state = useChatStore.getState();
      const stillBusy = (state.isStreaming && state.streamingSessionId === sessionId) ||
        state.sessionStatuses[sessionId] === 'running';
      if (stillBusy) {
        setQueuedFollowUpsBySession((current) => ({
          ...current,
          [sessionId]: [next, ...(current[sessionId] ?? [])],
        }));
        autoSendingQueuedRef.current = false;
        return;
      }

      const sent = sendToRuntime(sessionId, next.text, next.images, next.displayText, 'prompt');
      if (!sent) {
        setQueuedFollowUpsBySession((current) => ({
          ...current,
          [sessionId]: [next, ...(current[sessionId] ?? [])],
        }));
      }
      autoSendingQueuedRef.current = false;
    }, 80);
    return true;
  }, [queuedFollowUpsBySession, sendToRuntime]);

  useEffect(() => {
    if (!activeSessionId || isActiveSessionBusy) return;
    sendNextQueuedFollowUp(activeSessionId);
  }, [activeSessionId, isActiveSessionBusy, queuedFollowUpsBySession, sendNextQueuedFollowUp]);

  const handleEditQueuedFollowUp = useCallback((id: string) => {
    if (!activeSessionId) return;
    setQueuedFollowUpsBySession((current) => ({
      ...current,
      [activeSessionId]: (current[activeSessionId] ?? []).filter((item) => item.id !== id),
    }));
  }, [activeSessionId]);

  const handleDeleteQueuedFollowUp = useCallback((id: string) => {
    if (!activeSessionId) return;
    setQueuedFollowUpsBySession((current) => ({
      ...current,
      [activeSessionId]: (current[activeSessionId] ?? []).filter((item) => item.id !== id),
    }));
  }, [activeSessionId]);

  const handleGuideQueuedFollowUp = useCallback((id: string) => {
    if (!activeSessionId) return;
    const item = queuedFollowUpsBySession[activeSessionId]?.find((queued) => queued.id === id);
    if (!item) return;

    setQueuedFollowUpsBySession((current) => ({
      ...current,
      [activeSessionId]: (current[activeSessionId] ?? []).filter((queued) => queued.id !== id),
    }));
    sendToRuntime(activeSessionId, item.text, item.images, item.displayText, isActiveSessionBusy ? 'steer' : 'prompt');
  }, [activeSessionId, isActiveSessionBusy, queuedFollowUpsBySession, sendToRuntime]);

  const handleStop = () => {
    if (!activeSessionId) return;
    const sent = piApi.send({ type: 'stop_generation', sessionId: activeSessionId });
    if (!sent) {
      addToast({
        type: 'warning',
        message: 'Pi server is not connected; local streaming state was cleared.',
        duration: 5000,
      });
      useChatStore.getState().stopStreaming(activeSessionId);
    }
  };

  const startTerminalDockResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStateRef.current = { startY: event.clientY, startHeight: terminalDockHeight };
    setIsResizingTerminalDock(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [terminalDockHeight]);

  useEffect(() => {
    if (!isResizingTerminalDock) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      const { startY, startHeight } = resizeStateRef.current;
      const viewportLimit = Math.max(TERMINAL_DOCK_MIN_HEIGHT, window.innerHeight - 260);
      const maxHeight = Math.min(TERMINAL_DOCK_MAX_HEIGHT, viewportLimit);
      setTerminalDockHeight(clamp(startHeight + startY - event.clientY, TERMINAL_DOCK_MIN_HEIGHT, maxHeight));
    };

    const stopResize = () => setIsResizingTerminalDock(false);

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
  }, [isResizingTerminalDock, setTerminalDockHeight]);

  if (!activeSession || !activeSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-pi-dim text-sm">Session not found</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-pi-bg/95">
        <ChatBackground image={chatBackgroundImage} dim={chatBackgroundDim} />

        <div className="relative z-10 flex h-full min-h-0 flex-col">
          {/* Messages */}
          {messages.length === 0 ? (
            <WelcomeScreen
              projectName={activeSession.projectName}
              modelName={activeSession.modelProvider ? `${activeSession.modelProvider}/${activeSession.modelId}` : activeSession.modelId}
              onSend={handleSend}
            />
          ) : (
            <MessageList sessionId={activeSessionId} messages={messages} />
          )}
        </div>
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isActiveSessionBusy}
        sessionId={activeSessionId!}
        queuedFollowUps={queuedFollowUps}
        onEditQueuedFollowUp={handleEditQueuedFollowUp}
        onDeleteQueuedFollowUp={handleDeleteQueuedFollowUp}
        onGuideQueuedFollowUp={handleGuideQueuedFollowUp}
      />

      {terminalDockOpen && (
        <div className="flex flex-shrink-0 flex-col border-t border-pi-border bg-pi-bg" style={{ height: terminalDockHeight }}>
          <div
            role="separator"
            aria-label={t('rightPanel.terminal.resizeDock')}
            aria-orientation="horizontal"
            tabIndex={0}
            title={t('rightPanel.terminal.resizeDockHint')}
            onPointerDown={startTerminalDockResize}
            className={cn(
              'group relative z-10 flex h-2 flex-shrink-0 cursor-row-resize touch-none items-center justify-center outline-none',
              'before:absolute before:inset-x-3 before:top-1/2 before:h-px before:-translate-y-1/2 before:rounded-full before:bg-pi-border/80 before:transition-colors',
              'after:absolute after:left-1/2 after:top-1/2 after:h-1 after:w-10 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-transparent after:transition-colors',
              'hover:before:bg-pi-accent/70 hover:after:bg-pi-accent/25 focus-visible:bg-pi-accent/10 focus-visible:before:bg-pi-accent focus-visible:after:bg-pi-accent/35',
              isResizingTerminalDock && 'bg-pi-accent/10 before:bg-pi-accent after:bg-pi-accent/40'
            )}
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            <TerminalPanel sessionId={activeSessionId} compact />
          </div>
        </div>
      )}
    </div>
  );
}

function ChatBackground({ image, dim }: { image: string; dim: number }) {
  if (!image) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: toCssUrl(image) }}
      />
      <div
        className="absolute inset-0 bg-pi-bg"
        style={{ opacity: Math.max(0, Math.min(dim, 90)) / 100 }}
      />
    </div>
  );
}

function toCssUrl(value: string): string {
  return `url("${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
}
