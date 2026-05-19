import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { piApi } from '../../api/client';
import { useEffect } from 'react';
import type { ChatMessage } from '../../types';
import { useSettingsStore } from '../../stores/settingsStore';

const EMPTY_MESSAGES: ChatMessage[] = [];

export function ChatView() {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const messages = useChatStore((s) => (activeSessionId ? s.messagesBySession[activeSessionId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const isStreaming = useChatStore((s) => s.isStreaming);
  const activeSession = useChatStore((s) => s.sessions.find((ss) => ss.id === activeSessionId));
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const addToast = useUIStore((s) => s.addToast);
  const chatBackgroundImage = useSettingsStore((s) => s.chatBackgroundImage);
  const chatBackgroundDim = useSettingsStore((s) => s.chatBackgroundDim);

  // Reset streaming state when session changes
  useEffect(() => {
    if (activeSessionId) {
      useChatStore.getState().setStreaming(null, null);
    }
  }, [activeSessionId]);

  const handleSend = (text: string, images?: Array<{ data: string; mimeType: string }>, displayText?: string): boolean => {
    if (!activeSessionId) return false;
    const visibleText = displayText ?? text;
    const imageNote = images?.length ? `${visibleText ? '\n\n' : ''}[${images.length} image attachment${images.length > 1 ? 's' : ''}]` : '';
    const sent = piApi.send(isStreaming
      ? {
          type: 'follow_up',
          sessionId: activeSessionId,
          message: text,
          images,
        }
      : {
          type: 'prompt',
          sessionId: activeSessionId,
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
    addUserMessage(activeSessionId, `${visibleText}${imageNote}`);
    return true;
  };

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
            <MessageList messages={messages} />
          )}
        </div>
      </div>

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
