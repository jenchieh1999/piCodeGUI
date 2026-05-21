import { MessageSquarePlus } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { formatSelectionLineRange, type TextSelectionReference } from '../../lib/selectionReference';

export interface SelectionReferenceMenuState extends TextSelectionReference {
  x: number;
  y: number;
}

export function SelectionReferenceMenu({
  state,
  onAdd,
}: {
  state: SelectionReferenceMenuState;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  const menuLeft = typeof window === 'undefined'
    ? state.x
    : Math.min(state.x, Math.max(8, window.innerWidth - 248));
  const menuTop = typeof window === 'undefined'
    ? state.y
    : Math.min(state.y, Math.max(8, window.innerHeight - 88));
  const range = formatSelectionLineRange(state);

  return (
    <div
      className="fixed z-[130] w-60 overflow-hidden rounded-xl border border-pi-border/80 bg-pi-bg-secondary/95 p-1 shadow-2xl shadow-black/25 backdrop-blur-xl"
      style={{ left: menuLeft, top: menuTop }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        onClick={onAdd}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-pi-text transition-colors hover:bg-pi-bg-hover"
      >
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-pi-accent/10 text-pi-accent">
          <MessageSquarePlus size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t('rightPanel.addSelectedTextToChat')}</span>
          <span className="block truncate text-[10px] text-pi-dim">
            {range ?? t('rightPanel.selectedText')}
          </span>
        </span>
      </button>
    </div>
  );
}
