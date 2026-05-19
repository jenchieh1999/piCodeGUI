import { useRef, useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { ChatMessage } from '../../types';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useI18n } from '../../lib/i18n';
import { cn } from '../shared/utils';

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const { t } = useI18n();
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const showThinking = useSettingsStore((s) => s.showThinking);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const sessionId = messages[0]?.sessionId ?? 'empty';

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
    if (messages.length === 0) return;
    virtuosoRef.current?.scrollToIndex({
      index: messages.length - 1,
      align: 'end',
      behavior: 'smooth',
    });
    setIsAtBottom(true);
  }, [messages.length]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-transparent">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        followOutput={followOutput}
        atBottomStateChange={setIsAtBottom}
        itemContent={(index, message) => (
          <MessageBubble
            key={message.id}
            message={message}
            showThinking={showThinking}
          />
        )}
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
