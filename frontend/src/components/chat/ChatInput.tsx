import { useState, useRef, useEffect, useCallback } from 'react';
import type { ImageAttachment } from '../../types';
import { piApi } from '../../api/client';
import { cn } from '../shared/utils';
import {
  Send,
  Square,
  Paperclip,
  AtSign,
  Command,
  X,
  Image as ImageIcon,
} from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string, images?: Array<{ data: string; mimeType: string }>) => void;
  onStop: () => void;
  isStreaming: boolean;
  sessionId: string;
}

export function ChatInput({ onSend, onStop, isStreaming, sessionId }: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [text]);

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, [sessionId]);

  // Detect slash command
  useEffect(() => {
    const slashMatch = text.match(/^\/(\w*)$/);
    if (slashMatch) {
      setShowSlashMenu(true);
      setSlashFilter(slashMatch[1] ?? '');
    } else {
      setShowSlashMenu(false);
    }
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    onSend(
      trimmed,
      attachments.length > 0
        ? attachments.map((a) => ({ data: a.data, mimeType: a.mimeType }))
        : undefined
    );
    setText('');
    setAttachments([]);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Close slash menu on Escape
    if (e.key === 'Escape' && showSlashMenu) {
      setShowSlashMenu(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            const data = (reader.result as string).split(',')[1];
            setAttachments((prev) => [
              ...prev,
              { data, mimeType: file.type, fileName: file.name },
            ]);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          const data = (reader.result as string).split(',')[1];
          setAttachments((prev) => [
            ...prev,
            { data, mimeType: file.type, fileName: file.name },
          ]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          const data = (reader.result as string).split(',')[1];
          setAttachments((prev) => [
            ...prev,
            { data, mimeType: file.type, fileName: file.name },
          ]);
        };
        reader.readAsDataURL(file);
      }
    }
    e.target.value = '';
  };

  // Available slash commands
  const slashCommands = [
    { cmd: '/commit', desc: 'Commit changes' },
    { cmd: '/review', desc: 'Review code' },
    { cmd: '/memory', desc: 'Manage memory' },
    { cmd: '/debug', desc: 'Debug issue' },
    { cmd: '/compact', desc: 'Compact context' },
    { cmd: '/tree', desc: 'View session tree' },
    { cmd: '/fork', desc: 'Fork session' },
    { cmd: '/new', desc: 'New session' },
  ];

  const filteredCommands = slashCommands.filter((c) =>
    c.cmd.toLowerCase().includes(slashFilter.toLowerCase())
  );

  return (
    <div className="border-t border-pi-border bg-pi-bg">
      {/* Attachment Preview */}
      {attachments.length > 0 && (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1 flex-wrap">
          {attachments.map((att, idx) => (
            <div
              key={idx}
              className="relative group w-16 h-16 rounded-md border border-pi-border overflow-hidden bg-pi-bg-tertiary"
            >
              <img
                src={`data:${att.mimeType};base64,${att.data}`}
                alt={att.fileName ?? 'attachment'}
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-pi-bg/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={10} className="text-pi-error" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Slash Command Menu */}
      {showSlashMenu && filteredCommands.length > 0 && (
        <div className="px-3 pb-1">
          <div className="border border-pi-border rounded-md bg-pi-bg-secondary overflow-hidden max-h-[200px] overflow-y-auto">
            {filteredCommands.map((cmd) => (
              <button
                key={cmd.cmd}
                onClick={() => {
                  setText(cmd.cmd + ' ');
                  setShowSlashMenu(false);
                  textareaRef.current?.focus();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-pi-bg-hover text-left"
              >
                <Command size={12} className="text-pi-accent flex-shrink-0" />
                <span className="font-mono text-pi-accent">{cmd.cmd}</span>
                <span className="text-pi-dim ml-auto">{cmd.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="flex items-end gap-2 px-3 py-2">
        {/* Attach button */}
        <button
          onClick={handleFileSelect}
          className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-pi-dim hover:text-pi-text hover:bg-pi-bg-hover transition-colors"
          title="Attach file"
        >
          <Paperclip size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Text input */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Send a message... (Enter to send, Shift+Enter for new line)"
            rows={1}
            className="w-full resize-none bg-pi-bg-tertiary border border-pi-border rounded-lg px-3 py-2
                       text-sm text-pi-text placeholder-pi-dim
                       focus:outline-none focus:border-pi-accent transition-colors
                       min-h-[40px] max-h-[200px]"
            style={{ fontFamily: 'inherit' }}
          />
          {/* @ mention hint */}
          {text.includes('@') && (
            <div className="absolute left-3 -top-5 text-[10px] text-pi-dim">
              <AtSign size={10} className="inline mr-1" />
              Type filename to reference
            </div>
          )}
        </div>

        {/* Send / Stop button */}
        {isStreaming ? (
          <button
            onClick={onStop}
            className="flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center bg-pi-error/20 text-pi-error hover:bg-pi-error/30 transition-colors"
            title="Stop generation (Ctrl+.)"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() && attachments.length === 0}
            className={cn(
              'flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors',
              text.trim() || attachments.length > 0
                ? 'bg-pi-accent text-white hover:bg-pi-accent/90'
                : 'bg-pi-bg-tertiary text-pi-dim cursor-not-allowed'
            )}
            title="Send message"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
