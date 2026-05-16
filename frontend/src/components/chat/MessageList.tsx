import { useRef, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { ChatMessage } from '../../types';
import { MessageBubble } from './MessageBubble';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const showThinking = useSettingsStore((s) => s.showThinking);

  // Auto-scroll to bottom on new messages
  const followOutput = useCallback(
    (isAtBottom: boolean) => {
      if (isAtBottom || isStreaming) return 'smooth' as const;
      return false;
    },
    [isStreaming]
  );

  return (
    <div className="flex-1 overflow-hidden">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        followOutput={followOutput}
        itemContent={(index, message) => (
          <MessageBubble
            key={message.id}
            message={message}
            showThinking={showThinking}
          />
        )}
        className="scrollbar-thin"
        increaseViewportBy={200}
      />
    </div>
  );
}
