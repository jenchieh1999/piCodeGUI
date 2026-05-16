import { useState, useRef } from 'react';
import type { ChatMessage } from '../../types';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { ToolCallCard } from './ToolCallCard';
import { ThinkingDisplay } from './ThinkingBlock';
import { cn } from '../shared/utils';
import { generateId } from '../shared/utils';
import { User, Bot, Copy, Check } from 'lucide-react';

interface MessageBubbleProps {
  message: ChatMessage;
  showThinking: boolean;
}

export function MessageBubble({ message, showThinking }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
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

  return (
    <div
      className={cn(
        'px-4 py-3 animate-fade-in',
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
            {isUser ? 'You' : isAssistant ? 'Pi' : 'Tool'}
          </span>
          {message.usage && (
            <span className="text-[10px] text-pi-dim ml-auto">
              {message.usage.input + message.usage.output} tokens · ${message.usage.cost.toFixed(3)}
            </span>
          )}
        </div>

        {/* Thinking Block */}
        {message.thinking && showThinking && (
          <ThinkingDisplay thinking={message.thinking} />
        )}

        {/* Content */}
        <div className="space-y-2">
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
              return (
                <ToolCallCard
                  key={idx}
                  toolCall={{
                    id: block.toolUse.id,
                    name: block.toolUse.name,
                    args: block.toolUse.args,
                    status: 'pending',
                  }}
                />
              );
            }

            if (block.type === 'tool_result' && block.toolResult) {
              return (
                <ToolCallCard
                  key={idx}
                  toolCall={{
                    id: block.toolResult.toolCallId,
                    name: '',
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
          <div className="flex items-center gap-1 mt-2 opacity-0 hover:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-pi-dim hover:text-pi-text hover:bg-pi-bg-hover transition-colors"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
