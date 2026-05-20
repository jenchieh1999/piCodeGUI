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
  initialQuery?: string;
  initialQueryVersion?: number;
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
  initialQuery,
  initialQueryVersion = 0,
  readOnly = false,
  onClose,
  onReplaceVisibleChange,
  onSearchStateChange,
}: SearchReplaceBarProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const appliedInitialQueryVersionRef = useRef<number | null>(null);
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
    if (!visible || initialQuery === undefined) return;
    if (appliedInitialQueryVersionRef.current === initialQueryVersion) return;

    appliedInitialQueryVersionRef.current = initialQueryVersion;
    setQuery(initialQuery);
    setCurrentIndex(0);
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [initialQuery, initialQueryVersion, visible]);

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
    const searchBarHasFocus = rootRef.current?.contains(document.activeElement);
    if (!searchBarHasFocus) input.focus();
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
    <div ref={rootRef} className="pointer-events-none absolute right-3 top-12 z-30 flex justify-end">
      <div className="pointer-events-auto w-[min(650px,calc(100%_-_1.5rem))] rounded-xl border border-white/10 bg-pi-bg-secondary/82 p-2 shadow-2xl shadow-black/35 backdrop-blur-2xl">
        <div className="flex items-center gap-1.5">
          <div className="relative h-8 min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pi-dim" />
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
              className={cn(inputClass, 'pl-8 pr-[4.75rem]', error && 'border-pi-error/60 text-pi-error')}
            />
            <span className={cn('pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-1.5 text-[10px]', error ? 'text-pi-error' : 'text-pi-dim')}>
              {resultLabel}
            </span>
          </div>

          <div className="flex h-8 flex-shrink-0 items-center rounded-full border border-pi-border/60 bg-pi-bg/50 p-0.5">
            <OptionButton active={options.caseSensitive} label="Aa" title={t('search.caseSensitive')} onClick={() => toggleOption('caseSensitive')} />
            <OptionButton active={options.wholeWord} label="W" title={t('search.wholeWord')} onClick={() => toggleOption('wholeWord')} />
            <OptionButton active={options.regex} label=".*" title={t('search.regex')} onClick={() => toggleOption('regex')} />
          </div>

          <div className="flex h-8 flex-shrink-0 items-center rounded-full border border-pi-border/60 bg-pi-bg/50 p-0.5">
            <button type="button" onClick={goPrevious} disabled={matches.length === 0} className={iconButtonClass} title={t('search.previous')}>
              <ChevronUp size={13} />
            </button>
            <button type="button" onClick={goNext} disabled={matches.length === 0} className={iconButtonClass} title={t('search.next')}>
              <ChevronDown size={13} />
            </button>
          </div>

          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                onReplaceVisibleChange(!replaceVisible);
                window.requestAnimationFrame(() => replaceInputRef.current?.focus());
              }}
              className={cn(
                'h-8 flex-shrink-0 rounded-full px-3 text-[11px] font-medium transition-colors',
                replaceVisible ? 'bg-pi-accent text-white shadow-sm shadow-pi-accent/20' : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
              )}
            >
              {t('search.replace')}
            </button>
          )}
          <button type="button" onClick={onClose} className={iconButtonClass} title={t('common.close')}>
            <X size={13} />
          </button>
        </div>

        {replaceVisible && !readOnly && (
          <div className="mt-2 flex items-center gap-1.5 border-t border-pi-border/50 pt-2">
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
              className={cn(inputClass, 'min-w-0 flex-1')}
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
        'flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 font-mono text-[10px] transition-colors',
        active ? 'bg-pi-accent text-white shadow-sm shadow-pi-accent/20' : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
      )}
    >
      {label}
    </button>
  );
}

const inputClass = 'h-8 w-full rounded-full border border-pi-border/70 bg-pi-bg/65 px-3 text-xs text-pi-text shadow-inner shadow-black/10 placeholder:text-pi-dim focus:border-pi-accent/80 focus:bg-pi-bg focus:outline-none focus:ring-2 focus:ring-pi-accent/15';
const iconButtonClass = 'flex h-7 w-7 items-center justify-center rounded-full text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-not-allowed disabled:opacity-35';
const actionButtonClass = 'h-8 flex-shrink-0 rounded-full border border-pi-border/70 bg-pi-bg/55 px-3 text-[11px] font-medium text-pi-muted transition-colors hover:border-pi-accent/40 hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-not-allowed disabled:opacity-35';
