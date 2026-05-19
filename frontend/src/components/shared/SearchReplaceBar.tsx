import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useI18n } from '../../lib/i18n';
import {
  DEFAULT_TEXT_SEARCH_OPTIONS,
  findTextMatches,
  replaceAllTextMatches,
  replaceTextMatch,
  type TextSearchOptions,
  type TextSearchState,
} from '../../lib/textSearch';
import { cn } from './utils';

interface SearchReplaceBarProps {
  text: string;
  onTextChange: (value: string) => void;
  textInputRef?: RefObject<HTMLTextAreaElement | null>;
  visible: boolean;
  replaceVisible: boolean;
  readOnly?: boolean;
  onClose: () => void;
  onReplaceVisibleChange: (visible: boolean) => void;
  onSearchStateChange?: (state: TextSearchState) => void;
}

export function SearchReplaceBar({
  text,
  onTextChange,
  textInputRef,
  visible,
  replaceVisible,
  readOnly = false,
  onClose,
  onReplaceVisibleChange,
  onSearchStateChange,
}: SearchReplaceBarProps) {
  const { t } = useI18n();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState<TextSearchOptions>(DEFAULT_TEXT_SEARCH_OPTIONS);
  const [currentIndex, setCurrentIndex] = useState(0);

  const { matches, error } = useMemo(() => findTextMatches(text, query, options), [options, query, text]);
  const activeIndex = matches.length === 0 ? -1 : Math.min(currentIndex, matches.length - 1);

  useEffect(() => {
    if (!visible) return;
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [visible]);

  useEffect(() => {
    if (matches.length === 0) {
      if (currentIndex !== 0) setCurrentIndex(0);
      return;
    }
    if (currentIndex >= matches.length) setCurrentIndex(matches.length - 1);
  }, [currentIndex, matches.length]);

  useEffect(() => {
    onSearchStateChange?.({
      query,
      replacement,
      options,
      matches,
      currentIndex: activeIndex,
      error,
    });
  }, [activeIndex, error, matches, onSearchStateChange, options, query, replacement]);

  useEffect(() => {
    if (!visible || activeIndex < 0) return;
    const input = textInputRef?.current;
    const match = matches[activeIndex];
    if (!input || !match) return;
    input.focus();
    input.setSelectionRange(match.start, match.end);
  }, [activeIndex, matches, textInputRef, visible]);

  if (!visible) return null;

  const goNext = () => {
    if (matches.length === 0) return;
    setCurrentIndex((index) => (index + 1) % matches.length);
  };

  const goPrevious = () => {
    if (matches.length === 0) return;
    setCurrentIndex((index) => (index - 1 + matches.length) % matches.length);
  };

  const replaceCurrent = () => {
    if (readOnly || activeIndex < 0) return;
    const match = matches[activeIndex];
    if (!match) return;
    onTextChange(replaceTextMatch(text, match, query, replacement, options));
  };

  const replaceAll = () => {
    if (readOnly) return;
    const result = replaceAllTextMatches(text, query, replacement, options);
    if (result.error) return;
    onTextChange(result.text);
    setCurrentIndex(0);
  };

  const toggleOption = (key: keyof TextSearchOptions) => {
    setOptions((current) => ({ ...current, [key]: !current[key] }));
    setCurrentIndex(0);
  };

  const resultLabel = error
    ? t('search.invalid')
    : query
      ? matches.length > 0
        ? t('search.matchCount', { current: activeIndex + 1, total: matches.length })
        : t('search.noResults')
      : t('search.empty');

  return (
    <div className="flex flex-shrink-0 justify-end border-b border-pi-border bg-pi-bg-secondary/95 px-3 py-2 shadow-sm backdrop-blur">
      <div className="ml-auto flex w-full max-w-[720px] flex-col items-stretch gap-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-[360px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-pi-dim" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCurrentIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.shiftKey ? goPrevious() : goNext();
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
            placeholder={t('search.findPlaceholder')}
            className={cn(inputClass, 'pl-8 pr-20', error && 'border-pi-error/60')}
          />
          <span className={cn('absolute right-2 top-1/2 -translate-y-1/2 text-[10px]', error ? 'text-pi-error' : 'text-pi-dim')}>
            {resultLabel}
          </span>
        </div>

        <div className="pi-glass-control flex h-8 items-center rounded-md p-0.5">
          <OptionButton active={options.caseSensitive} label="Aa" title={t('search.caseSensitive')} onClick={() => toggleOption('caseSensitive')} />
          <OptionButton active={options.wholeWord} label="W" title={t('search.wholeWord')} onClick={() => toggleOption('wholeWord')} />
          <OptionButton active={options.regex} label=".*" title={t('search.regex')} onClick={() => toggleOption('regex')} />
        </div>

        <button type="button" onClick={goPrevious} disabled={matches.length === 0} className={iconButtonClass} title={t('search.previous')}>
          <ChevronUp size={14} />
        </button>
        <button type="button" onClick={goNext} disabled={matches.length === 0} className={iconButtonClass} title={t('search.next')}>
          <ChevronDown size={14} />
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={() => {
              onReplaceVisibleChange(!replaceVisible);
              window.requestAnimationFrame(() => replaceInputRef.current?.focus());
            }}
            className={cn(
              'h-8 rounded-md px-2.5 text-[11px] font-medium transition-colors',
              replaceVisible ? 'bg-pi-selected-bg text-pi-accent' : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
            )}
          >
            {t('search.replace')}
          </button>
        )}
        <button type="button" onClick={onClose} className={iconButtonClass} title={t('common.close')}>
          <X size={14} />
        </button>
      </div>

        {replaceVisible && !readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <input
            ref={replaceInputRef}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                replaceCurrent();
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
            placeholder={t('search.replacePlaceholder')}
            className={cn(inputClass, 'min-w-[220px] flex-1 sm:max-w-[360px]')}
          />
          <button type="button" onClick={replaceCurrent} disabled={matches.length === 0 || Boolean(error)} className={actionButtonClass}>
            {t('search.replace')}
          </button>
          <button type="button" onClick={replaceAll} disabled={matches.length === 0 || Boolean(error)} className={actionButtonClass}>
            {t('search.replaceAll')}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

function OptionButton({ active, label, title, onClick }: { active: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex h-7 min-w-7 items-center justify-center rounded px-1.5 font-mono text-[10px] transition-colors',
        active ? 'bg-pi-selected-bg text-pi-accent' : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
      )}
    >
      {label}
    </button>
  );
}

const inputClass = 'h-8 rounded-md border border-pi-border bg-pi-bg-tertiary px-2.5 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none';
const iconButtonClass = 'flex h-8 w-8 items-center justify-center rounded-md text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-not-allowed disabled:opacity-40';
const actionButtonClass = 'h-8 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-not-allowed disabled:opacity-40';
