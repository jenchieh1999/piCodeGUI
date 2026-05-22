import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso';
import type { ChatMessage, PermissionRequest } from '../../types';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import { cn } from '../shared/utils';
import { PermissionInlineCard } from './PermissionDialog';

interface MessageListProps {
  sessionId: string;
  messages: ChatMessage[];
}

type MessageListEntry =
  | { type: 'message'; message: ChatMessage }
  | { type: 'permission'; permission: PermissionRequest & { sessionId: string } };

const clampItemIndex = (index: number, itemCount: number) =>
  Math.min(Math.max(Math.round(index), 0), Math.max(itemCount - 1, 0));

export function MessageList({ sessionId, messages }: MessageListProps) {
  const { t } = useI18n();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const topItemIndexRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const persistPositionRef = useRef<() => void>(() => {});
  const pendingPermission = useChatStore((s) => s.pendingPermission);
  const showThinking = useSettingsStore((s) => s.showThinking);
  const setChatScrollPosition = useUIStore((s) => s.setChatScrollPosition);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const inlinePermission = pendingPermission?.sessionId === sessionId ? pendingPermission : null;
  const listItems = useMemo<MessageListEntry[]>(
    () => [
      ...messages.map((message) => ({ type: 'message' as const, message })),
      ...(inlinePermission ? [{ type: 'permission' as const, permission: inlinePermission }] : []),
    ],
    [inlinePermission, messages]
  );
  const initialScrollPosition = useMemo(
    () => useUIStore.getState().chatScrollPositions[sessionId],
    [sessionId]
  );
  const initialTopMostItemIndex = useMemo(() => {
    if (listItems.length === 0) return 0;
    const lastIndex = listItems.length - 1;
    if (!initialScrollPosition || initialScrollPosition.atBottom) {
      return { index: lastIndex, align: 'end' as const };
    }
    return {
      index: clampItemIndex(initialScrollPosition.topItemIndex, listItems.length),
      align: 'start' as const,
    };
  }, [initialScrollPosition, listItems.length]);

  useEffect(() => {
    const nextAtBottom = initialScrollPosition?.atBottom ?? true;
    setIsAtBottom(nextAtBottom);
    isAtBottomRef.current = nextAtBottom;
    topItemIndexRef.current = initialScrollPosition
      ? clampItemIndex(initialScrollPosition.topItemIndex, listItems.length)
      : Math.max(listItems.length - 1, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const persistScrollPosition = useCallback(
    (updates: { topItemIndex?: number; atBottom?: boolean } = {}) => {
      if (!sessionId || listItems.length === 0) return;
      const atBottom = updates.atBottom ?? isAtBottomRef.current;
      const topItemIndex = atBottom
        ? listItems.length - 1
        : clampItemIndex(updates.topItemIndex ?? topItemIndexRef.current, listItems.length);
      setChatScrollPosition(sessionId, {
        topItemIndex,
        atBottom,
        itemCount: listItems.length,
        updatedAt: Date.now(),
      });
    },
    [listItems.length, sessionId, setChatScrollPosition]
  );

  useEffect(() => {
    persistPositionRef.current = persistScrollPosition;
  }, [persistScrollPosition]);

  useEffect(
    () => () => {
      persistPositionRef.current();
    },
    []
  );

  const followOutput = useCallback((atBottom: boolean) => {
    if (atBottom) return 'smooth' as const;
    return false;
  }, []);

  const handleRangeChanged = useCallback(
    (range: ListRange) => {
      topItemIndexRef.current = clampItemIndex(range.startIndex, listItems.length);
      persistScrollPosition({ topItemIndex: range.startIndex });
    },
    [listItems.length, persistScrollPosition]
  );

  const handleAtBottomStateChange = useCallback(
    (atBottom: boolean) => {
      setIsAtBottom(atBottom);
      isAtBottomRef.current = atBottom;
      persistScrollPosition({ atBottom });
    },
    [persistScrollPosition]
  );

  const scrollToBottom = useCallback(() => {
    if (listItems.length === 0) return;
    const lastIndex = listItems.length - 1;
    virtuosoRef.current?.scrollToIndex({
      index: lastIndex,
      align: 'end',
      behavior: 'smooth',
    });
    topItemIndexRef.current = lastIndex;
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    persistScrollPosition({ topItemIndex: lastIndex, atBottom: true });
  }, [listItems.length, persistScrollPosition]);

  useEffect(() => {
    if (!inlinePermission?.requestId) return;
    const frame = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(frame);
  }, [inlinePermission?.requestId, scrollToBottom]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-transparent">
      <Virtuoso
        key={sessionId}
        ref={virtuosoRef}
        data={listItems}
        followOutput={followOutput}
        initialTopMostItemIndex={initialTopMostItemIndex}
        rangeChanged={handleRangeChanged}
        atBottomStateChange={handleAtBottomStateChange}
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
