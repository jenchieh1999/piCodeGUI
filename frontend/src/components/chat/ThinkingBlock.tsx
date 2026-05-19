import { useState } from 'react';
import type { ThinkingBlock as ThinkingBlockType } from '../../types';
import { useI18n } from '../../lib/i18n';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';

interface ThinkingDisplayProps {
  thinking: ThinkingBlockType;
}

export function ThinkingDisplay({ thinking }: ThinkingDisplayProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(thinking.isExpanded ?? false);
  const preview = thinking.content.slice(0, 120);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-pi-thinking-text hover:text-pi-muted transition-colors group"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-pi-dim" />
        ) : (
          <ChevronRight size={12} className="text-pi-dim" />
        )}
        <Brain size={12} className="text-pi-accent/60" />
        <span className="font-medium">{t('chat.thinkingTitle')}</span>
        {!expanded && (
          <span className="text-pi-dim truncate max-w-[300px] ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {preview}{thinking.content.length > 120 ? '...' : ''}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 ml-5 pl-3 border-l-2 border-pi-border-muted text-xs text-pi-thinking-text leading-relaxed whitespace-pre-wrap">
          {thinking.content}
        </div>
      )}
    </div>
  );
}
