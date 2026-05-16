import { useChatStore } from '../../stores/chatStore';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { piApi } from '../../api/client';
import { useEffect } from 'react';

export function ChatView() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const messages = useChatStore((s) => (activeSessionId ? s.messagesBySession[activeSessionId] ?? [] : []));
  const isStreaming = useChatStore((s) => s.isStreaming);
  const activeSession = useChatStore((s) => s.sessions.find((ss) => ss.id === activeSessionId));

  // Reset streaming state when session changes
  useEffect(() => {
    if (activeSessionId) {
      useChatStore.getState().setStreaming(null, null);
    }
  }, [activeSessionId]);

  const handleSend = (text: string, images?: Array<{ data: string; mimeType: string }>) => {
    if (!activeSessionId) return;
    piApi.send({
      type: 'prompt',
      sessionId: activeSessionId,
      message: text,
      images,
    });
  };

  const handleStop = () => {
    if (!activeSessionId) return;
    piApi.send({ type: 'stop_generation', sessionId: activeSessionId });
  };

  if (!activeSession || !activeSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-pi-dim text-sm">Session not found</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Messages */}
      {messages.length === 0 ? (
        <WelcomeScreen
          projectName={activeSession.projectName}
          modelName={activeSession.modelId}
          onSend={handleSend}
        />
      ) : (
        <MessageList messages={messages} />
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isStreaming}
        sessionId={activeSessionId!}
      />
    </div>
  );
}
