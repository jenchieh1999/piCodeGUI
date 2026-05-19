import { useState } from 'react';
import type { ChatMessage } from '../../types';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { ToolCallCard } from './ToolCallCard';
import { ThinkingDisplay } from './ThinkingBlock';
import { cn } from '../shared/utils';
import { piApi } from '../../api/client';
import { useI18n } from '../../lib/i18n';
import { useUIStore } from '../../stores/uiStore';
import { User, Bot, Copy, Check, GitFork, Loader2 } from 'lucide-react';

interface MessageBubbleProps {
  message: ChatMessage;
  showThinking: boolean;
}

export function MessageBubble({ message, showThinking }: MessageBubbleProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [forking, setForking] = useState(false);
  const addToast = useUIStore((s) => s.addToast);
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isTool = message.role === 'tool';

  const handleCopy = () => {
    const text = message.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleFork = () => {
    if (forking) return;

    setForking(true);
    const sent = piApi.send({
      type: 'session_fork',
      sessionId: message.sessionId,
      entryId: message.id,
    });

    if (!sent) {
      setForking(false);
      addToast({
        type: 'error',
        message: t('message.forkDisconnected'),
        duration: 5000,
      });
      return;
    }

    addToast({
      type: 'success',
      message: t('message.forkingToast'),
      duration: 1800,
    });
    window.setTimeout(() => setForking(false), 1600);
  };

  return (
    <div
      className={cn(
        'group/message px-4 py-3 animate-fade-in',
        isUser && 'bg-pi-bg-secondary/50',
      )}
    >
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5">
          <div
            className={cn(
              'w-5 h-5 rounded flex items-center justify-center flex-shrink-0',
              isUser ? 'bg-pi-user-msg-bg' : isAssistant ? 'bg-pi-accent/20' : 'bg-pi-tool-pending-bg'
            )}
          >
            {isUser ? (
              <User size={11} className="text-pi-user-msg-text" />
            ) : isAssistant ? (
              <Bot size={11} className="text-pi-accent" />
            ) : (
              <div className="w-2 h-2 rounded bg-pi-muted" />
            )}
          </div>
          <span className="text-[10px] font-semibold text-pi-dim uppercase tracking-wider">
            {isUser ? t('message.role.you') : isAssistant ? t('message.role.pi') : t('message.role.tool')}
          </span>
          {message.usage && (
            <span className="text-[10px] text-pi-dim ml-auto">
              {t('message.usage', {
                tokens: message.usage.input + message.usage.output,
                cost: message.usage.cost.toFixed(3),
              })}
            </span>
          )}
        </div>

        {/* Thinking Block */}
        {message.thinking && showThinking && (
          <ThinkingDisplay thinking={message.thinking} />
        )}

        {/* Content */}
        <div className="pi-selectable space-y-2 select-text cursor-text">
          {message.content.map((block, idx) => {
            if (block.type === 'text' && block.text) {
              return (
                <div
                  key={idx}
                  className={cn(
                    'text-sm leading-relaxed',
                    isUser ? 'text-pi-text' : 'text-pi-text'
                  )}
                >
                  {isAssistant ? (
                    <MarkdownRenderer content={block.text} />
                  ) : (
                    <p className="whitespace-pre-wrap">{block.text}</p>
                  )}
                </div>
              );
            }

            if (block.type === 'tool_use' && block.toolUse) {
              const toolState = message.toolCalls?.find((tool) => tool.id === block.toolUse?.id);
              return (
                <ToolCallCard
                  key={idx}
                  toolCall={{
                    id: block.toolUse.id,
                    name: block.toolUse.name,
                    args: block.toolUse.args,
                    status: toolState?.status ?? 'pending',
                    result: toolState?.result,
                  }}
                />
              );
            }

            if (block.type === 'tool_result' && block.toolResult) {
              const relatedTool = message.toolCalls?.find((tool) => tool.id === block.toolResult?.toolCallId);
              if (relatedTool) return null;
              return (
                <ToolCallCard
                  key={idx}
                  toolCall={{
                    id: block.toolResult.toolCallId,
                    name: 'tool',
                    args: {},
                    status: block.toolResult.isError ? 'error' : 'success',
                    result: block.toolResult,
                  }}
                />
              );
            }

            return null;
          })}
        </div>

        {/* Streaming cursor */}
        {message.isStreaming && (
          <span className="inline-block w-2 h-4 bg-pi-accent cursor-blink ml-0.5 align-text-bottom" />
        )}

        {/* Action bar - visible on hover for assistant messages */}
        {isAssistant && !message.isStreaming && (
          <div className={cn(
            'mt-2 flex select-none items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100',
            (copied || forking) && 'opacity-100'
          )}>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-pi-dim hover:text-pi-text hover:bg-pi-bg-hover transition-colors"
              title={t('message.copyAnswer')}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span>{copied ? t('message.copied') : t('message.copy')}</span>
            </button>
            <button
              onClick={handleFork}
              disabled={forking}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-wait disabled:opacity-70"
              title={t('message.forkAnswer')}
            >
              {forking ? <Loader2 size={11} className="animate-spin" /> : <GitFork size={11} />}
              <span>{forking ? t('message.forking') : t('message.fork')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
