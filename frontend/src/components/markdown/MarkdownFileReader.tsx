import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type UIEvent,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Check,
  Code2,
  Columns2,
  ExternalLink,
  Eye,
  FileText,
  Lock,
  RefreshCw,
  Save,
  Search,
  Unlock,
} from 'lucide-react';
import { piApi } from '../../api/client';
import type { WorkspaceReadFileResult, WorkspaceWriteFileResult } from '../../types';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import {
  applyDomSearchHighlights,
  clearDomSearchHighlights,
  getSearchSeedFromDocument,
  getSearchSeedFromTextArea,
  type TextSearchState,
} from '../../lib/textSearch';
import { SearchReplaceBar } from '../shared/SearchReplaceBar';
import { SelectionReferenceMenu, type SelectionReferenceMenuState } from '../shared/SelectionReferenceMenu';
import { cn } from '../shared/utils';
import { MarkdownRenderer } from './MarkdownRenderer';
import { isRedoShortcut, isUndoShortcut, useTextUndoHistory } from '../../hooks/useTextUndoHistory';
import {
  addWorkspaceReferenceToChat,
  textSelectionFromDocument,
  textSelectionFromTextArea,
  workspaceBasename,
  type TextSelectionReference,
} from '../../lib/selectionReference';

type MarkdownViewMode = 'preview' | 'split' | 'source';

const MARKDOWN_INDENT = '  ';

interface MarkdownFileReaderProps {
  sessionId: string;
  filePath: string;
  initialContent?: string;
  initialSize?: number;
  embedded?: boolean;
  onSaved?: (content: string, result: WorkspaceWriteFileResult) => void;
}

export function MarkdownFileReader({
  sessionId,
  filePath,
  initialContent,
  initialSize,
  embedded = false,
  onSaved,
}: MarkdownFileReaderProps) {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [mode, setMode] = useState<MarkdownViewMode>('preview');
  const [splitScrollLocked, setSplitScrollLocked] = useState(true);
  const [content, setContent] = useState(initialContent ?? '');
  const [savedContent, setSavedContent] = useState(initialContent ?? '');
  const [size, setSize] = useState(initialSize ?? initialContent?.length ?? 0);
  const [loading, setLoading] = useState(!initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [replaceVisible, setReplaceVisible] = useState(false);
  const [searchSeed, setSearchSeed] = useState<{ query: string; version: number }>({ query: '', version: 0 });
  const [searchState, setSearchState] = useState<TextSearchState | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionReferenceMenuState | null>(null);
  const sourceScrollRef = useRef<HTMLTextAreaElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef<'source' | 'preview' | null>(null);
  const {
    applyChange: applyContentChange,
    undo: undoContentChange,
    redo: redoContentChange,
    resetHistory: resetContentHistory,
  } = useTextUndoHistory({ value: content, setValue: setContent, inputRef: sourceScrollRef });

  const dirty = content !== savedContent;

  const syncSplitScrollByRatio = useCallback((from: 'source' | 'preview') => {
    if (syncingScrollRef.current && syncingScrollRef.current !== from) return;

    const origin = from === 'source' ? sourceScrollRef.current : previewScrollRef.current;
    const target = from === 'source' ? previewScrollRef.current : sourceScrollRef.current;
    if (!origin || !target) return;

    const originMax = origin.scrollHeight - origin.clientHeight;
    const targetMax = target.scrollHeight - target.clientHeight;
    const ratio = originMax > 0 ? origin.scrollTop / originMax : 0;

    syncingScrollRef.current = from;
    target.scrollTop = Math.max(0, Math.min(targetMax, targetMax * ratio));
    window.requestAnimationFrame(() => {
      if (syncingScrollRef.current === from) {
        syncingScrollRef.current = null;
      }
    });
  }, []);

  const syncSplitScroll = useCallback((
    from: 'source' | 'preview',
    _event: UIEvent<HTMLTextAreaElement | HTMLDivElement>
  ) => {
    if (mode !== 'split' || !splitScrollLocked) return;
    syncSplitScrollByRatio(from);
  }, [mode, splitScrollLocked, syncSplitScrollByRatio]);

  const toggleSplitScrollLock = useCallback(() => {
    const nextLocked = !splitScrollLocked;
    setSplitScrollLocked(nextLocked);
    if (nextLocked) {
      window.requestAnimationFrame(() => syncSplitScrollByRatio('source'));
    } else {
      syncingScrollRef.current = null;
    }
  }, [splitScrollLocked, syncSplitScrollByRatio]);

  const applyFile = useCallback((file: WorkspaceReadFileResult) => {
    if (file.state !== 'ok' || file.previewType === 'image') {
      throw new Error(file.error ?? t('markdown.readFailed', { path: file.path }));
    }
    const nextContent = file.content ?? '';
    setContent(nextContent);
    resetContentHistory(nextContent);
    setSavedContent(nextContent);
    setSize(file.size);
    setError(null);
  }, [resetContentHistory, t]);

  const loadFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const file = await piApi.getWorkspaceFile(sessionId, filePath);
      applyFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [applyFile, filePath, sessionId]);

  useEffect(() => {
    if (initialContent === undefined) {
      void loadFile();
      return;
    }

    setContent(initialContent);
    resetContentHistory(initialContent);
    setSavedContent(initialContent);
    setSize(initialSize ?? initialContent.length);
    setError(null);
    setLoading(false);
  }, [filePath, initialContent, initialSize, loadFile, resetContentHistory]);

  const saveFile = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await piApi.writeWorkspaceFile(sessionId, filePath, content);
      if (result.state !== 'ok') {
        throw new Error(result.error ?? t('markdown.saveFailed', { path: result.path }));
      }
      setSavedContent(content);
      setSize(result.size);
      onSaved?.(content, result);
      window.dispatchEvent(new CustomEvent('pi:workspace-changed', { detail: { sessionId } }));
      addToast({ type: 'success', message: t('markdown.savedToast') });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      addToast({ type: 'error', message, duration: 6000 });
    } finally {
      setSaving(false);
    }
  }, [addToast, content, dirty, filePath, onSaved, saving, sessionId, t]);

  const getSelectedSearchSeed = useCallback(() => (
    getSearchSeedFromTextArea(sourceScrollRef.current) || getSearchSeedFromDocument()
  ), []);

  const openSearch = useCallback((withReplace: boolean) => {
    const query = getSelectedSearchSeed();
    if (query) {
      setSearchSeed((current) => ({ query, version: current.version + 1 }));
    }
    setSearchVisible(true);
    setReplaceVisible(withReplace);
  }, [getSelectedSearchSeed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveFile();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        openSearch(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        openSearch(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openSearch, saveFile]);

  const closeSearch = useCallback(() => {
    setSearchVisible(false);
    setSearchState(null);
  }, []);

  const showSelectionMenu = useCallback((
    event: ReactMouseEvent<HTMLElement>,
    selection: TextSelectionReference | null
  ) => {
    if (!selection) {
      setSelectionMenu(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectionMenu({
      ...selection,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const openPreviewSelectionMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    showSelectionMenu(event, textSelectionFromDocument(content, event.currentTarget));
  }, [content, showSelectionMenu]);

  const openSourceSelectionMenu = useCallback((event: ReactMouseEvent<HTMLTextAreaElement>) => {
    showSelectionMenu(event, textSelectionFromTextArea(event.currentTarget));
  }, [showSelectionMenu]);

  const addSelectionToChat = useCallback(() => {
    if (!selectionMenu) return;
    if (!selectionMenu.excerpt.trim()) {
      addToast({ type: 'warning', message: t('rightPanel.selectedTextEmpty') });
      setSelectionMenu(null);
      return;
    }

    addWorkspaceReferenceToChat({
      sessionId,
      path: filePath,
      name: workspaceBasename(filePath),
      lineStart: selectionMenu.lineStart,
      lineEnd: selectionMenu.lineEnd,
      excerpt: selectionMenu.excerpt,
      sourceKind: 'file',
    });
    addToast({ type: 'success', message: t('rightPanel.addedSelectedText') });
    setSelectionMenu(null);
  }, [addToast, filePath, selectionMenu, sessionId, t]);

  useEffect(() => {
    if (!selectionMenu) return;

    const close = () => setSelectionMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('click', close);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', close, true);
    };
  }, [selectionMenu]);

  const openStandalone = async () => {
    if (!window.piDesktop) {
      addToast({ type: 'warning', message: t('markdown.standaloneOnlyDesktop') });
      return;
    }
    try {
      await window.piDesktop.openMarkdownWindow(sessionId, filePath);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : String(err), duration: 6000 });
    }
  };

  const stats = useMemo(() => {
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const lines = content.split('\n').length;
    return t('markdown.stats', { lines, words, size: formatBytes(size) });
  }, [content, size, t]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-pi-bg">
      <div className={cn(
        'pi-reader-toolbar-material flex flex-shrink-0 items-center gap-2 border-b px-3',
        embedded ? 'h-9' : 'h-11'
      )}>
        <FileText size={14} className="flex-shrink-0 text-pi-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-pi-text">{filePath}</div>
          {!embedded && <div className="text-[10px] text-pi-dim">{stats}</div>}
        </div>

        <div className="pi-glass-control flex items-center gap-1 rounded-lg p-0.5">
          <ModeButton active={mode === 'preview'} title={t('markdown.preview')} icon={Eye} onClick={() => setMode('preview')} />
          <ModeButton active={mode === 'split'} title={t('markdown.split')} icon={Columns2} onClick={() => setMode('split')} />
          <ModeButton active={mode === 'source'} title={t('markdown.source')} icon={Code2} onClick={() => setMode('source')} />
          {mode === 'split' && (
            <>
              <span className="mx-0.5 h-4 w-px bg-pi-border/80" />
              <ModeButton
                active={splitScrollLocked}
                title={splitScrollLocked ? t('markdown.unlockSync') : t('markdown.lockSync')}
                icon={splitScrollLocked ? Lock : Unlock}
                onClick={toggleSplitScrollLock}
              />
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (!searchVisible) {
              const query = getSelectedSearchSeed();
              if (query) {
                setSearchSeed((current) => ({ query, version: current.version + 1 }));
              }
            }
            setSearchVisible((visible) => !visible);
            setReplaceVisible(false);
          }}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
            searchVisible ? 'bg-pi-selected-bg text-pi-accent' : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
          )}
          title={t('search.find')}
        >
          <Search size={13} />
        </button>
        <button
          type="button"
          onClick={() => void loadFile()}
          disabled={loading || saving}
          className="flex h-7 w-7 items-center justify-center rounded-md text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-wait disabled:opacity-50"
          title={t('markdown.reload')}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={() => void saveFile()}
          disabled={!dirty || saving || loading}
          className={cn(
            'flex h-7 items-center gap-1 rounded-md px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-45',
            dirty ? 'bg-pi-accent text-white hover:bg-pi-accent/90' : 'text-pi-success hover:bg-pi-success/10'
          )}
          title={t('markdown.saveMarkdown')}
        >
          {dirty ? <Save size={12} /> : <Check size={12} />}
          {!embedded && <span>{saving ? t('markdown.saving') : dirty ? t('markdown.save') : t('markdown.saved')}</span>}
        </button>
        {embedded && (
          <button
            type="button"
            onClick={() => void openStandalone()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
            title={t('markdown.openStandalone')}
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>

      {error && (
        <div className="flex-shrink-0 border-b border-pi-error/30 bg-pi-error/10 px-3 py-2 text-xs text-pi-error">
          {error}
        </div>
      )}

      <SearchReplaceBar
        text={content}
        onTextChange={applyContentChange}
        textInputRef={sourceScrollRef}
        visible={searchVisible}
        replaceVisible={replaceVisible}
        initialQuery={searchSeed.version > 0 ? searchSeed.query : undefined}
        initialQueryVersion={searchSeed.version}
        onClose={closeSearch}
        onReplaceVisibleChange={setReplaceVisible}
        onSearchStateChange={setSearchState}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-pi-dim">
            <RefreshCw size={14} className="animate-spin" />
            {t('markdown.loading')}
          </div>
        ) : mode === 'preview' ? (
          <MarkdownPreview
            content={content}
            emptyText={t('markdown.emptyFile')}
            searchState={searchState}
            onSelectionContextMenu={openPreviewSelectionMenu}
          />
        ) : mode === 'split' ? (
          <div className="grid h-full min-h-0 grid-cols-2 overflow-hidden">
            <MarkdownSourceEditor
              value={content}
              onChange={applyContentChange}
              onUndo={undoContentChange}
              onRedo={redoContentChange}
              scrollRef={sourceScrollRef}
              onScroll={(event) => syncSplitScroll('source', event)}
              onSelectionContextMenu={openSourceSelectionMenu}
            />
            <div className="min-h-0 min-w-0 overflow-hidden border-l border-pi-border">
              <MarkdownPreview
                content={content}
                emptyText={t('markdown.emptyFile')}
                scrollRef={previewScrollRef}
                onScroll={(event) => syncSplitScroll('preview', event)}
                searchState={searchState}
                onSelectionContextMenu={openPreviewSelectionMenu}
              />
            </div>
          </div>
        ) : (
          <MarkdownSourceEditor
            value={content}
            onChange={applyContentChange}
            onUndo={undoContentChange}
            onRedo={redoContentChange}
            scrollRef={sourceScrollRef}
            onSelectionContextMenu={openSourceSelectionMenu}
          />
        )}
      </div>

      {selectionMenu && (
        <SelectionReferenceMenu state={selectionMenu} onAdd={addSelectionToChat} />
      )}
    </div>
  );
}

function MarkdownPreview({
  content,
  emptyText,
  scrollRef,
  onScroll,
  searchState,
  onSelectionContextMenu,
}: {
  content: string;
  emptyText: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  searchState?: TextSearchState | null;
  onSelectionContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);

  const applyPreviewSearch = useCallback(() => {
    const root = localRef.current;
    if (!root) return;
    if (!searchState?.query) {
      clearDomSearchHighlights(root);
      return;
    }
    applyDomSearchHighlights(root, searchState.query, searchState.options, searchState.currentIndex);
  }, [searchState]);

  useEffect(() => {
    applyPreviewSearch();
    const root = localRef.current;
    if (!root) return;
    return () => clearDomSearchHighlights(root);
  }, [applyPreviewSearch, content]);

  return (
    <div
      ref={(node) => {
        localRef.current = node;
        if (scrollRef) {
          (scrollRef as { current: HTMLDivElement | null }).current = node;
        }
      }}
      onScroll={onScroll}
      onContextMenu={onSelectionContextMenu}
      className="pi-selectable h-full min-h-0 overflow-auto overscroll-contain px-6 py-5 text-pi-text"
    >
      <div className="mx-auto max-w-3xl">
        <MarkdownRenderer content={content || emptyText} onRendered={applyPreviewSearch} />
      </div>
    </div>
  );
}

function MarkdownSourceEditor({
  value,
  onChange,
  onUndo,
  onRedo,
  scrollRef,
  onScroll,
  onSelectionContextMenu,
}: {
  value: string;
  onChange: (value: string) => void;
  onUndo: () => boolean;
  onRedo: () => boolean;
  scrollRef?: RefObject<HTMLTextAreaElement | null>;
  onScroll?: (event: UIEvent<HTMLTextAreaElement>) => void;
  onSelectionContextMenu?: (event: ReactMouseEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <textarea
      ref={scrollRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => handleMarkdownSourceKeyDown(event, value, onChange, onUndo, onRedo)}
      onScroll={onScroll}
      onContextMenu={onSelectionContextMenu}
      spellCheck={false}
      className="block h-full min-h-0 w-full resize-none overflow-auto overscroll-contain bg-pi-bg px-4 py-3 font-mono text-[12px] leading-relaxed text-pi-tool-output outline-none selection:bg-pi-selected-bg"
    />
  );
}

function handleMarkdownSourceKeyDown(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  value: string,
  onChange: (value: string) => void,
  onUndo: () => boolean,
  onRedo: () => boolean
) {
  if (isUndoShortcut(event)) {
    event.preventDefault();
    onUndo();
    return;
  }

  if (isRedoShortcut(event)) {
    event.preventDefault();
    onRedo();
    return;
  }

  const isTabIndent = event.key === 'Tab';
  const isShortcutIndent = (event.ctrlKey || event.metaKey) && event.key === ']';
  const isShortcutOutdent = (event.ctrlKey || event.metaKey) && event.key === '[';

  if (!isTabIndent && !isShortcutIndent && !isShortcutOutdent) return;

  event.preventDefault();

  const input = event.currentTarget;
  const range = applyIndentEdit(
    value,
    input.selectionStart,
    input.selectionEnd,
    event.shiftKey || isShortcutOutdent ? 'outdent' : 'indent'
  );

  onChange(range.text);
  window.requestAnimationFrame(() => {
    input.setSelectionRange(range.selectionStart, range.selectionEnd);
  });
}

function applyIndentEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: 'indent' | 'outdent'
): { text: string; selectionStart: number; selectionEnd: number } {
  if (direction === 'indent' && selectionStart === selectionEnd) {
    return {
      text: `${value.slice(0, selectionStart)}${MARKDOWN_INDENT}${value.slice(selectionEnd)}`,
      selectionStart: selectionStart + MARKDOWN_INDENT.length,
      selectionEnd: selectionStart + MARKDOWN_INDENT.length,
    };
  }

  const blockStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const blockEnd = findIndentBlockEnd(value, selectionStart, selectionEnd);
  const block = value.slice(blockStart, blockEnd);
  const lines = block.split('\n');

  if (direction === 'indent') {
    const nextBlock = lines.map((line) => `${MARKDOWN_INDENT}${line}`).join('\n');
    const added = lines.length * MARKDOWN_INDENT.length;
    return {
      text: `${value.slice(0, blockStart)}${nextBlock}${value.slice(blockEnd)}`,
      selectionStart: selectionStart + MARKDOWN_INDENT.length,
      selectionEnd: selectionEnd + added,
    };
  }

  let cursor = blockStart;
  let removedBeforeStart = 0;
  let removedBeforeEnd = 0;
  const nextLines = lines.map((line) => {
    const removeCount = getOutdentCount(line);
    if (cursor < selectionStart) {
      removedBeforeStart += Math.min(removeCount, selectionStart - cursor);
    }
    if (cursor < selectionEnd) {
      removedBeforeEnd += Math.min(removeCount, selectionEnd - cursor);
    }
    cursor += line.length + 1;
    return line.slice(removeCount);
  });

  return {
    text: `${value.slice(0, blockStart)}${nextLines.join('\n')}${value.slice(blockEnd)}`,
    selectionStart: Math.max(blockStart, selectionStart - removedBeforeStart),
    selectionEnd: Math.max(blockStart, selectionEnd - removedBeforeEnd),
  };
}

function findIndentBlockEnd(value: string, selectionStart: number, selectionEnd: number): number {
  if (selectionStart !== selectionEnd && value[selectionEnd - 1] === '\n') {
    return selectionEnd - 1;
  }
  const nextBreak = value.indexOf('\n', selectionEnd);
  return nextBreak === -1 ? value.length : nextBreak;
}

function getOutdentCount(line: string): number {
  if (line.startsWith('\t')) return 1;
  if (line.startsWith(MARKDOWN_INDENT)) return MARKDOWN_INDENT.length;
  return line.startsWith(' ') ? 1 : 0;
}

function ModeButton({
  active,
  title,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  title: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
        active ? 'bg-pi-selected-bg text-pi-accent' : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
      )}
    >
      <Icon size={12} />
    </button>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
