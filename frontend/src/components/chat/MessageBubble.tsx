import { useState } from 'react';
import type { ChatMessage } from '../../types';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { ToolCallCard } from './ToolCallCard';
import { ThinkingDisplay } from './ThinkingBlock';
import { cn } from '../shared/utils';
import { piApi } from '../../api/client';
import { useI18n } from '../../lib/i18n';
import { useUIStore } from '../../stores/uiStore';
import { User, Bot, Copy, Check, GitFork, Loader2, FileText } from 'lucide-react';

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
              const userContent = isUser ? splitUserWorkspaceReferences(block.text) : null;
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
                  ) : userContent?.references.length ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {userContent.references.map((reference) => (
                          <WorkspaceReferenceCard key={`${reference.path}:${reference.range ?? ''}`} reference={reference} />
                        ))}
                      </div>
                      {userContent.text && <p className="whitespace-pre-wrap">{userContent.text}</p>}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{block.text}</p>
                  )}
                </div>
              );
            }

            if (block.type === 'image' && block.image) {
              const image = block.image;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => openImagePreview(image)}
                  className="group/image block max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-pi-border bg-pi-bg-tertiary/70 text-left shadow-sm transition-colors hover:border-pi-accent/60"
                  title={image.fileName ?? image.mimeType}
                >
                  <img
                    src={imageDataUrl(image)}
                    alt={image.fileName ?? 'image attachment'}
                    className="max-h-[360px] max-w-full object-contain"
                    loading="lazy"
                  />
                  {(image.fileName || image.mimeType) && (
                    <div className="border-t border-pi-border/70 px-2 py-1 text-[10px] text-pi-dim">
                      <span className="line-clamp-1">{image.fileName ?? image.mimeType}</span>
                    </div>
                  )}
                </button>
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

function imageDataUrl(image: { data: string; mimeType: string }): string {
  if (image.data.startsWith('data:')) return image.data;
  return `data:${image.mimeType};base64,${image.data}`;
}

function openImagePreview(image: { data: string; mimeType: string }): void {
  window.open(imageDataUrl(image), '_blank', 'noopener,noreferrer');
}

interface WorkspaceDisplayReference {
  path: string;
  name: string;
  directory: string;
  extension: string;
  range?: string;
}

function WorkspaceReferenceCard({ reference }: { reference: WorkspaceDisplayReference }) {
  return (
    <div
      className="inline-flex max-w-full select-text items-center gap-2 rounded-2xl border border-pi-border/70 bg-pi-bg-secondary/85 px-3 py-2 shadow-sm backdrop-blur-xl"
      title={reference.range ? `${reference.path}${reference.range}` : reference.path}
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-pi-accent/20 bg-pi-accent/10 text-pi-accent shadow-inner">
        <FileText size={15} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-xs font-semibold text-pi-text">{reference.name}</span>
        <span className="block truncate text-[10px] text-pi-dim">
          {reference.directory || reference.path}
          {reference.range && <span className="font-mono"> {reference.range}</span>}
        </span>
      </span>
      {reference.extension && (
        <span className="ml-1 flex-shrink-0 rounded-full border border-pi-border/70 bg-pi-bg-tertiary px-2 py-0.5 text-[9px] font-semibold uppercase text-pi-muted">
          {reference.extension}
        </span>
      )}
    </div>
  );
}

function splitUserWorkspaceReferences(text: string): { references: WorkspaceDisplayReference[]; text: string } {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = normalized.match(/^([\s\S]*?)(?:\n{2,}([\s\S]*))?$/);
  const firstParagraph = (match?.[1] ?? '').trim();
  if (!firstParagraph.startsWith('@')) return { references: [], text };

  const references = parseReferenceParagraph(firstParagraph);
  if (references.length === 0) return { references: [], text };

  return {
    references,
    text: (match?.[2] ?? '').trimStart(),
  };
}

function parseReferenceParagraph(value: string): WorkspaceDisplayReference[] {
  const normalized = value.trim();
  const referenceStarts = normalized.match(/(^|\s)@/g) ?? [];
  const tokens = referenceStarts.length <= 1
    ? [normalized]
    : normalized.split(/\s+(?=@)/).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0 || tokens.some((token) => !token.startsWith('@'))) return [];

  const references = tokens.map((token) => parseWorkspaceReferenceToken(token.slice(1)));
  if (references.some((reference) => !reference)) return [];
  return references as WorkspaceDisplayReference[];
}

function parseWorkspaceReferenceToken(value: string): WorkspaceDisplayReference | null {
  const rangeMatch = value.match(/(:L\d+(?:-L\d+)?)$/);
  const range = rangeMatch?.[1];
  const path = (range ? value.slice(0, -range.length) : value).replace(/\\/g, '/').trim();
  if (/\s/.test(path) && !/\.[a-zA-Z0-9]{1,12}$/.test(path)) return null;
  if (!looksLikeWorkspaceReference(path)) return null;

  const name = basename(path);
  const directory = dirname(path);
  const extension = extensionFromName(name);
  return { path, name, directory, extension, range };
}

function looksLikeWorkspaceReference(path: string): boolean {
  if (!path || /[\r\n]/.test(path)) return false;
  return path.includes('/') || path.startsWith('attachment/') || /\.[a-zA-Z0-9]{1,12}$/.test(path);
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function extensionFromName(name: string): string {
  const match = name.match(/\.([a-zA-Z0-9]{1,12})$/);
  return match?.[1] ?? '';
}
