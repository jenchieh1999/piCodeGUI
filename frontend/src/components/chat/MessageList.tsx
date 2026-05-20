import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { ChatMessage, PermissionRequest } from '../../types';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useI18n } from '../../lib/i18n';
import { cn } from '../shared/utils';
import { PermissionInlineCard } from './PermissionDialog';

interface MessageListProps {
  messages: ChatMessage[];
}

type MessageListEntry =
  | { type: 'message'; message: ChatMessage }
  | { type: 'permission'; permission: PermissionRequest & { sessionId: string } };

export function MessageList({ messages }: MessageListProps) {
  const { t } = useI18n();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const pendingPermission = useChatStore((s) => s.pendingPermission);
  const showThinking = useSettingsStore((s) => s.showThinking);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const sessionId = activeSessionId ?? messages[0]?.sessionId ?? 'empty';
  const inlinePermission = pendingPermission?.sessionId === sessionId ? pendingPermission : null;
  const listItems = useMemo<MessageListEntry[]>(
    () => [
      ...messages.map((message) => ({ type: 'message' as const, message })),
      ...(inlinePermission ? [{ type: 'permission' as const, permission: inlinePermission }] : []),
    ],
    [inlinePermission, messages]
  );

  useEffect(() => {
    setIsAtBottom(true);
  }, [sessionId]);

  // Auto-scroll to bottom on new messages
  const followOutput = useCallback(
    (isAtBottom: boolean) => {
      if (isAtBottom || isStreaming) return 'smooth' as const;
      return false;
    },
    [isStreaming]
  );

  const scrollToBottom = useCallback(() => {
    if (listItems.length === 0) return;
    virtuosoRef.current?.scrollToIndex({
      index: listItems.length - 1,
      align: 'end',
      behavior: 'smooth',
    });
    setIsAtBottom(true);
  }, [listItems.length]);

  useEffect(() => {
    if (!inlinePermission?.requestId) return;
    const frame = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frame);
  }, [inlinePermission?.requestId, scrollToBottom]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-transparent">
      <Virtuoso
        ref={virtuosoRef}
        data={listItems}
        followOutput={followOutput}
        atBottomStateChange={setIsAtBottom}
        itemContent={(index, item) => {
          if (item.type === 'permission') {
            return (
              <div className="px-4 py-3">
                <div className="mx-auto max-w-3xl">
                  <PermissionInlineCard permission={item.permission} />
                </div>
              </div>
            );
          }

          return (
            <MessageBubble
              key={item.message.id}
              message={item.message}
              showThinking={showThinking}
            />
          );
        }}
        className="scrollbar-thin bg-transparent"
        style={{ height: '100%', background: 'transparent' }}
        increaseViewportBy={200}
      />

      <button
        type="button"
        aria-label={t('message.scrollToBottom')}
        title={t('message.scrollToBottom')}
        onClick={scrollToBottom}
        className={cn(
          'pi-glass-control absolute bottom-4 right-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full text-pi-muted transition-all duration-150 hover:border-pi-accent/70 hover:bg-pi-bg-hover hover:text-pi-text focus-visible:outline-pi-accent',
          isAtBottom
            ? 'pointer-events-none translate-y-2 scale-95 opacity-0'
            : 'pointer-events-auto translate-y-0 scale-100 opacity-100'
        )}
      >
        <ArrowDownToLine size={17} />
      </button>
    </div>
  );
}
